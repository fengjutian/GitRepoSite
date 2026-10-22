import { RepoSiteError } from '../errors';

export interface RepositoryRef {
  owner: string;
  repo: string;
  /** Optional branch/tag/sha requested by the user. */
  ref?: string;
}

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const REF_PATTERN = /^[A-Za-z0-9._\-/]{1,200}$/;

/**
 * Parses a public GitHub repository URL. Only github.com is accepted; the result is
 * never used as a raw HTTP target, only as owner/repo/ref for the fixed GitHub API host.
 */
export function parseRepositoryUrl(input: string): RepositoryRef {
  const raw = (input ?? '').trim();
  if (!raw) {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '请输入公开 GitHub 仓库地址。');
  }
  if (raw.length > 500) {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '仓库地址过长。');
  }
  if (/[\s<>"'`\\]/.test(raw)) {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '仓库地址包含非法字符。');
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '无法解析仓库地址。');
  }

  if (url.protocol !== 'https:') {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '仅支持 https 开头的 GitHub 仓库地址。');
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '仅支持 github.com 上的公开仓库。');
  }
  if (url.username || url.password || url.port) {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '仓库地址包含不支持的部分。');
  }

  const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment);
  if (segments.length < 2) {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '仓库地址需要包含 owner/repository。');
  }

  const owner = segments[0]!;
  let repo = segments[1]!;
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', 'owner 或 repository 名称格式不正确。');
  }

  let ref: string | undefined;
  if (segments.length > 2) {
    const kind = segments[2]!.toLowerCase();
    if (kind !== 'tree' || segments.length !== 4) {
      throw new RepoSiteError('INVALID_REPOSITORY_URL', '仅支持仓库首页或 /tree/<ref> 形式的地址。');
    }
    const candidate = segments[3]!;
    if (!REF_PATTERN.test(candidate)) {
      throw new RepoSiteError('INVALID_REPOSITORY_URL', '分支或标签名称格式不正确。');
    }
    ref = candidate;
  }

  return ref ? { owner, repo, ref } : { owner, repo };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new RepoSiteError('INVALID_REPOSITORY_URL', '仓库地址包含无法解码的字符。');
  }
}

export function buildRepositoryUrl(ref: RepositoryRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

export function buildRepositorySlug(ref: RepositoryRef): string {
  return `${ref.owner}/${ref.repo}`;
}
