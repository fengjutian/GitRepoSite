import { describe, expect, it } from 'vitest';
import { RepoSiteError } from '@/lib/errors';
import {
  dirnameOf,
  isExcludedPath,
  isImagePath,
  isMarkdownPath,
  normalizeRepoPath,
  pathToSlug,
  resolveRelativePath,
} from '@/lib/github/paths';

describe('normalizeRepoPath', () => {
  it('normalizes redundant segments', () => {
    expect(normalizeRepoPath('./docs//guide.md')).toBe('docs/guide.md');
  });

  it('rejects directory traversal', () => {
    expect(() => normalizeRepoPath('../secrets')).toThrow(RepoSiteError);
    expect(() => normalizeRepoPath('docs/../../etc/passwd')).toThrow(RepoSiteError);
  });

  it('rejects absolute and drive paths', () => {
    expect(() => normalizeRepoPath('/etc/passwd')).toThrow(RepoSiteError);
    expect(() => normalizeRepoPath('C:/Windows/system.ini')).toThrow(RepoSiteError);
  });

  it('rejects backslashes and control characters', () => {
    expect(() => normalizeRepoPath('docs\\guide.md')).toThrow(RepoSiteError);
    expect(() => normalizeRepoPath('docs/gu\u0000ide.md')).toThrow(RepoSiteError);
  });
});

describe('resolveRelativePath', () => {
  it('resolves a relative reference against the document directory', () => {
    expect(resolveRelativePath('docs', './img/logo.png')).toBe('docs/img/logo.png');
    expect(resolveRelativePath('docs/guide', '../assets/logo.png')).toBe('docs/assets/logo.png');
  });

  it('rejects references that escape the repository root', () => {
    expect(() => resolveRelativePath('docs', '../../etc/passwd')).toThrow(RepoSiteError);
  });

  it('rejects absolute URLs and fragments', () => {
    expect(() => resolveRelativePath('docs', 'https://example.com/a.png')).toThrow(RepoSiteError);
    expect(() => resolveRelativePath('docs', '#anchor')).toThrow(RepoSiteError);
  });
});

describe('path helpers', () => {
  it('detects excluded directories', () => {
    expect(isExcludedPath('node_modules/pkg/index.js')).toBe(true);
    expect(isExcludedPath('docs/index.md')).toBe(false);
  });

  it('detects image and markdown files', () => {
    expect(isImagePath('assets/logo.PNG')).toBe(true);
    expect(isImagePath('assets/logo.txt')).toBe(false);
    expect(isMarkdownPath('docs/readme.md')).toBe(true);
  });

  it('computes directory names and slugs', () => {
    expect(dirnameOf('docs/guide/intro.md')).toBe('docs/guide');
    expect(dirnameOf('README.md')).toBe('');
    expect(pathToSlug('docs/Getting-Started.md')).toBe('docs/getting-started');
  });
});
