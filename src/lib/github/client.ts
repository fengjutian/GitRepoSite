import { RepoSiteError } from '../errors';
import type { RepositoryRef } from './url';

/** The only host the app is ever allowed to talk to for repository data. */
export const GITHUB_API_ORIGIN = 'https://api.github.com';

/**
 * Public content host used for pinned file reads.
 *
 * `raw.githubusercontent.com` serves the exact bytes of a commit without being
 * metered against the REST API quota, so reading a whole repository costs 3 API
 * calls instead of 3 + one call per file. That is the difference between
 * "one repository per hour" and "one repository per day" without a token.
 */
export const GITHUB_RAW_ORIGIN = 'https://raw.githubusercontent.com';

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

/** How long repository metadata may be reused before it is fetched again. */
const METADATA_TTL_MS = 5 * 60 * 1000;

/** How long a resolved ref may be reused; a branch tip moves over time. */
const COMMIT_TTL_MS = 60 * 1000;

/** Upper bound for the in-memory caches. */
const CACHE_LIMIT = 64;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache for the three metered API calls of a read task.
 *
 * The cached values are public repository data, so sharing them inside one
 * runtime is safe. The tree is keyed by the commit SHA and therefore immutable;
 * metadata and ref resolution expire on their own.
 */
const metadataCache = new Map<string, CacheEntry<RepositoryMetadata>>();
const commitCache = new Map<string, CacheEntry<string>>();
const treeCache = new Map<string, CacheEntry<TreeResult>>();

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

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
    const key = `${ref.owner}/${ref.repo}`;
    const cached = cacheGet(metadataCache, key);
    if (cached) return cached;
    const data = await this.request<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
    );
    const metadata: RepositoryMetadata = {
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
    cacheSet(metadataCache, key, metadata, METADATA_TTL_MS);
    return metadata;
  }

  /** Resolves the immutable commit SHA used to pin every file read of a task. */
  async resolveCommitSha(ref: RepositoryRef): Promise<string> {
    if (ref.ref && /^[0-9a-f]{7,40}$/i.test(ref.ref)) {
      return ref.ref.toLowerCase();
    }
    const key = `${ref.owner}/${ref.repo}@${ref.ref ?? 'HEAD'}`;
    const cached = cacheGet(commitCache, key);
    if (cached) return cached;
    const data = await this.request<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/commits/${encodeURIComponent(
        ref.ref ?? 'HEAD',
      )}`,
    );
    const sha = typeof data.sha === 'string' ? data.sha : '';
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new RepoSiteError('GITHUB_ERROR', '无法解析提交 SHA。');
    }
    cacheSet(commitCache, key, sha, COMMIT_TTL_MS);
    return sha;
  }

  async getTree(ref: RepositoryRef, commitSha: string): Promise<TreeResult> {
    const cacheKey = `${ref.owner}/${ref.repo}@${commitSha}`;
    const cached = cacheGet(treeCache, cacheKey);
    if (cached) return cached;
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

    const result = { entries, truncated };
    // A commit tree never changes, so it is safe to keep it for the session.
    cacheSet(treeCache, cacheKey, result, Number.MAX_SAFE_INTEGER);
    return result;
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

  /**
   * Reads one file of a pinned commit.
   *
   * The content host is tried first because it is not metered against the REST
   * API quota; the blob endpoint stays available as a fallback for the rare case
   * where the content host cannot serve a path.
   */
  async getFileBytes(
    ref: RepositoryRef,
    commitSha: string,
    path: string,
    blobSha?: string,
  ): Promise<Uint8Array> {
    const url =
      `${GITHUB_RAW_ORIGIN}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}` +
      `/${commitSha}/${encodePathSegments(path)}`;
    try {
      const response = await this.send(url, {
        source: 'content',
        // No Authorization header here on purpose: the content host answers CORS
        // preflight requests with 403, so a token would break the request.
        headers: {},
        notFoundMessage: `仓库中不存在该文件：${path}`,
      });
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof RepoSiteError && error.status === 404 && blobSha) {
        return this.getBlobBytes(ref, blobSha);
      }
      throw error;
    }
  }

  private async request<T>(path: string): Promise<T> {
    const response = await this.send(`${GITHUB_API_ORIGIN}${path}`, {
      source: 'api',
      headers: this.apiHeaders(),
      notFoundMessage: 'GitHub 未找到该资源（仓库可能不存在或不是公开仓库）。',
    });
    return (await response.json()) as T;
  }

  private apiHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.userAgent,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private async send(
    url: string,
    options: { source: 'api' | 'content'; headers: Record<string, string>; notFoundMessage: string },
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(url, { headers: options.headers, signal: controller.signal });
        const status = response.status;
        if (status === 404) {
          throw new RepoSiteError('GITHUB_ERROR', options.notFoundMessage, { status: 404 });
        }
        if (status === 401 || status === 403 || status === 429) {
          const remaining = response.headers.get('x-ratelimit-remaining');
          if (remaining === '0' || status === 429) {
            throw new RepoSiteError('GITHUB_RATE_LIMIT', this.rateLimitMessage(response, options.source), {
              status: 429,
              details: { resetAt: resetAtEpochMs(response) },
            });
          }
          if (options.source === 'content') {
            throw new RepoSiteError('GITHUB_ERROR', 'GitHub 内容服务拒绝了本次请求，请稍后重试。', {
              status: 502,
            });
          }
          throw new RepoSiteError('GITHUB_ERROR', 'GitHub 拒绝了本次请求。', { status: 502 });
        }
        if (status >= 500) {
          lastError = new RepoSiteError('GITHUB_ERROR', `GitHub 服务异常 (${status})。`);
          await delay(300 * (attempt + 1));
          continue;
        }
        if (!response.ok) {
          throw new RepoSiteError('GITHUB_ERROR', `GitHub 请求失败 (${status})。`);
        }
        return response;
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

  /** Turns the rate limit headers into something the user can act on. */
  private rateLimitMessage(response: Response, source: 'api' | 'content'): string {
    if (source === 'content') {
      return 'GitHub 内容服务触发了限流，请稍后重试。';
    }
    const limit = Number(response.headers.get('x-ratelimit-limit') ?? '');
    const resetAt = resetAtEpochMs(response);
    const parts: string[] = [];
    if (Number.isFinite(limit) && limit > 60) {
      parts.push(`GitHub API 调用频率超限（当前配额 ${limit} 次/小时）。`);
    } else {
      parts.push('GitHub API 调用频率超限（未使用 Token 时每个 IP 每小时只有 60 次）。');
    }
    if (resetAt) parts.push(`配额将于 ${formatClock(resetAt)} 恢复。`);
    parts.push('填写 GitHub Token 可把配额提升到 5000 次/小时。');
    return parts.join('');
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

/** Encodes a repository path segment by segment, keeping the slashes intact. */
function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function resetAtEpochMs(response: Response): number | undefined {
  const reset = response.headers.get('x-ratelimit-reset');
  if (!reset) return undefined;
  const seconds = Number(reset);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return seconds * 1000;
}

function formatClock(epochMs: number): string {
  const date = new Date(epochMs);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
