import { RepoSiteError } from '../errors';
import type { RepositoryRef } from './url';

/** The only host the app is ever allowed to talk to for repository data. */
export const GITHUB_API_ORIGIN = 'https://api.github.com';

export interface GitHubClientOptions {
  fetchImpl?: typeof fetch;
  /** Optional token, only used server-side to raise the rate limit. Never sent to browsers. */
  token?: string;
  userAgent?: string;
  maxRetries?: number;
  requestTimeoutMs?: number;
}

export interface RepositoryMetadata {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  homepage: string | null;
  defaultBranch: string;
  language: string | null;
  topics: string[];
  stars: number;
  license: { spdxId: string | null; name: string | null } | null;
  archived: boolean;
  pushedAt: string | null;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  size: number;
  sha: string;
}

export interface TreeResult {
  entries: TreeEntry[];
  truncated: boolean;
}

export interface ReadmeFile {
  path: string;
  content: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class GitHubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly userAgent: string;
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;

  constructor(options: GitHubClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.token = options.token;
    this.userAgent = options.userAgent ?? 'RepoSite/1.1 (+https://github.com)';
    this.maxRetries = options.maxRetries ?? 2;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getRepository(ref: RepositoryRef): Promise<RepositoryMetadata> {
    const data = await this.request<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
    );
    return {
      id: Number(data.id ?? 0),
      name: String(data.name ?? ref.repo),
      fullName: String(data.full_name ?? `${ref.owner}/${ref.repo}`),
      description: typeof data.description === 'string' ? data.description : null,
      htmlUrl: String(data.html_url ?? `https://github.com/${ref.owner}/${ref.repo}`),
      homepage: typeof data.homepage === 'string' ? data.homepage : null,
      defaultBranch: String(data.default_branch ?? 'main'),
      language: typeof data.language === 'string' ? data.language : null,
      topics: Array.isArray(data.topics) ? (data.topics as string[]).slice(0, 30) : [],
      stars: Number(data.stargazers_count ?? 0),
      license:
        data.license && typeof data.license === 'object'
          ? {
              spdxId: (data.license as Record<string, unknown>).spdx_id
                ? String((data.license as Record<string, unknown>).spdx_id)
                : null,
              name: (data.license as Record<string, unknown>).name
                ? String((data.license as Record<string, unknown>).name)
                : null,
            }
          : null,
      archived: Boolean(data.archived),
      pushedAt: typeof data.pushed_at === 'string' ? data.pushed_at : null,
    };
  }

  /** Resolves the immutable commit SHA used to pin every file read of a task. */
  async resolveCommitSha(ref: RepositoryRef): Promise<string> {
    if (ref.ref && /^[0-9a-f]{7,40}$/i.test(ref.ref)) {
      return ref.ref.toLowerCase();
    }
    const data = await this.request<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/commits/${encodeURIComponent(
        ref.ref ?? 'HEAD',
      )}`,
    );
    const sha = typeof data.sha === 'string' ? data.sha : '';
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new RepoSiteError('GITHUB_ERROR', '无法解析提交 SHA。');
    }
    return sha;
  }

  async getTree(ref: RepositoryRef, commitSha: string): Promise<TreeResult> {
    const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/trees/${commitSha}`;
    const data = await this.request<Record<string, unknown>>(`${base}?recursive=1`);
    let entries = toTreeEntries(data.tree);
    let truncated = Boolean(data.truncated);

    if (truncated) {
      // GitHub truncates very large trees: fall back to per-directory reads.
      const topLevel = entries.filter((entry) => entry.type === 'tree');
      const merged = new Map(entries.map((entry) => [entry.path, entry]));
      for (const directory of topLevel.slice(0, 60)) {
        const sub = await this.request<Record<string, unknown>>(
          `${base}/${encodeURIComponent(directory.path)}?recursive=1`,
        );
        for (const entry of toTreeEntries(sub.tree)) {
          if (!merged.has(entry.path)) merged.set(entry.path, entry);
        }
        if (!sub.truncated) truncated = false;
      }
      entries = [...merged.values()];
    }

    return { entries, truncated };
  }

  async getReadme(ref: RepositoryRef, commitSha: string): Promise<ReadmeFile | null> {
    try {
      const data = await this.request<Record<string, unknown>>(
        `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/readme?ref=${commitSha}`,
      );
      const content = typeof data.content === 'string' ? data.content : '';
      const encoding = typeof data.encoding === 'string' ? data.encoding : 'base64';
      const path = typeof data.path === 'string' ? data.path : 'README.md';
      if (encoding !== 'base64') {
        throw new RepoSiteError('GITHUB_ERROR', '不支持的 README 编码。');
      }
      return { path, content: decodeBase64(content) };
    } catch (error) {
      if (error instanceof RepoSiteError && error.code === 'GITHUB_ERROR' && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getBlobBytes(ref: RepositoryRef, blobSha: string): Promise<Uint8Array> {
    const data = await this.request<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/blobs/${blobSha}`,
    );
    const content = typeof data.content === 'string' ? data.content : '';
    const encoding = typeof data.encoding === 'string' ? data.encoding : 'base64';
    if (encoding === 'utf-8') {
      return new TextEncoder().encode(content);
    }
    if (encoding !== 'base64') {
      throw new RepoSiteError('GITHUB_ERROR', '不支持的文件编码。');
    }
    return base64ToBytes(content);
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${GITHUB_API_ORIGIN}${path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const headers: Record<string, string> = {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': this.userAgent,
        };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;

        const response = await this.fetchImpl(url, { headers, signal: controller.signal });
        const status = response.status;
        if (status === 404) {
          throw new RepoSiteError('GITHUB_ERROR', 'GitHub 未找到该资源（仓库可能不存在或不是公开仓库）。', {
            status: 404,
          });
        }
        if (status === 401 || status === 403 || status === 429) {
          const remaining = response.headers.get('x-ratelimit-remaining');
          if (remaining === '0' || status === 429) {
            throw new RepoSiteError('GITHUB_RATE_LIMIT', 'GitHub API 调用频率超限，请稍后重试。');
          }
          throw new RepoSiteError('GITHUB_ERROR', 'GitHub 拒绝了本次请求。', { status: 502 });
        }
        if (response.status >= 500) {
          lastError = new RepoSiteError('GITHUB_ERROR', `GitHub 服务异常 (${response.status})。`);
          await delay(300 * (attempt + 1));
          continue;
        }
        if (!response.ok) {
          throw new RepoSiteError('GITHUB_ERROR', `GitHub 请求失败 (${response.status})。`);
        }
        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof RepoSiteError) throw error;
        lastError = error;
        if (attempt === this.maxRetries) break;
        await delay(300 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof RepoSiteError
      ? lastError
      : new RepoSiteError('GITHUB_ERROR', '读取 GitHub 仓库失败，请检查网络或仓库地址。');
  }
}

function toTreeEntries(value: unknown): TreeEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: TreeEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.path !== 'string' || typeof raw.sha !== 'string') continue;
    entries.push({
      path: raw.path,
      mode: String(raw.mode ?? '100644'),
      type: (raw.type === 'tree' || raw.type === 'commit' ? raw.type : 'blob') as TreeEntry['type'],
      size: Number(raw.size ?? 0),
      sha: raw.sha,
    });
  }
  return entries;
}

export function decodeBase64(input: string): string {
  return new TextDecoder().decode(base64ToBytes(input));
}

export function base64ToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
