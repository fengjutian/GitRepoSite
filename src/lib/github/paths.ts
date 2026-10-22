import { RepoSiteError } from '../errors';

const EXCLUDED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.svg',
  '.apng',
]);

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);

/**
 * Normalizes a repository path to a safe POSIX relative path.
 * Rejects traversal, absolute paths, backslashes and control characters.
 */
export function normalizeRepoPath(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) {
    throw new RepoSiteError('INVALID_PATH', '路径不能为空。');
  }
  if (raw.includes('\\')) {
    throw new RepoSiteError('INVALID_PATH', `路径不允许使用反斜杠: ${raw}`);
  }
  if (raw.includes('\0') || /[\u0000-\u001f]/.test(raw)) {
    throw new RepoSiteError('INVALID_PATH', '路径包含非法控制字符。');
  }
  if (raw.startsWith('/')) {
    throw new RepoSiteError('PATH_TRAVERSAL', `不允许使用绝对路径: ${raw}`);
  }
  if (/^[A-Za-z]:/.test(raw)) {
    throw new RepoSiteError('PATH_TRAVERSAL', `不允许使用驱动器路径: ${raw}`);
  }

  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      throw new RepoSiteError('PATH_TRAVERSAL', `不允许使用目录穿越: ${raw}`);
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    throw new RepoSiteError('INVALID_PATH', '路径不能为空。');
  }
  return segments.join('/');
}

/** Resolves a relative reference (e.g. "./img/a.png") against the directory of a document. */
export function resolveRelativePath(baseDir: string, reference: string): string {
  const ref = reference.trim();
  if (!ref) {
    throw new RepoSiteError('INVALID_PATH', '引用路径不能为空。');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//') || ref.startsWith('#')) {
    throw new RepoSiteError('INVALID_PATH', `引用不是仓库内相对路径: ${reference}`);
  }
  const base = baseDir ? baseDir.split('/').filter(Boolean) : [];
  const combined = [...base, ...ref.split('/')].filter((part) => part !== '' && part !== '.');

  const stack: string[] = [];
  for (const part of combined) {
    if (part === '..') {
      if (stack.length === 0) {
        throw new RepoSiteError('PATH_TRAVERSAL', `引用超出仓库根目录: ${reference}`);
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (stack.length === 0) {
    throw new RepoSiteError('INVALID_PATH', `引用路径无效: ${reference}`);
  }
  return normalizeRepoPath(stack.join('/'));
}

export function dirnameOf(path: string): string {
  const normalized = normalizeRepoPath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

export function basenameOf(path: string): string {
  // Tolerates references that are not valid repository paths (e.g. "../img/a.png").
  const normalized = (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export function extensionOf(path: string): string {
  const name = basenameOf(path).toLowerCase();
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index);
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path));
}

export function isExcludedPath(path: string): boolean {
  return path.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

/** Converts a repository path into a stable, URL-safe document slug. */
export function pathToSlug(path: string): string {
  const normalized = normalizeRepoPath(path);
  const withoutExtension = normalized.replace(/\.(md|markdown|mdx)$/i, '');
  const slug = withoutExtension
    .split('/')
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('/');
  return slug || 'index';
}

export function slugToTitle(slug: string): string {
  const last = slug.split('/').pop() ?? slug;
  const cleaned = last.replace(/[-_]+/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
