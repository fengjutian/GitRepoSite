import { describe, expect, it } from 'vitest';
import { parseRepositoryUrl } from '@/lib/github/url';
import { RepoSiteError } from '@/lib/errors';

describe('parseRepositoryUrl', () => {
  it('accepts a canonical repository URL', () => {
    const ref = parseRepositoryUrl('https://github.com/owner/repo');
    expect(ref.owner).toBe('owner');
    expect(ref.repo).toBe('repo');
    expect(ref.ref).toBeUndefined();
  });

  it('adds the https scheme when missing', () => {
    expect(parseRepositoryUrl('github.com/owner/repo').owner).toBe('owner');
  });

  it('strips the .git suffix and trailing slashes', () => {
    expect(parseRepositoryUrl('https://github.com/owner/repo.git').repo).toBe('repo');
    expect(parseRepositoryUrl('https://github.com/owner/repo/').repo).toBe('repo');
  });

  it('accepts a branch reference', () => {
    const ref = parseRepositoryUrl('https://github.com/owner/repo/tree/main');
    expect(ref.ref).toBe('main');
  });

  it('rejects other hosts', () => {
    expect(() => parseRepositoryUrl('https://gitlab.com/owner/repo')).toThrow(RepoSiteError);
    expect(() => parseRepositoryUrl('https://github.com.evil.com/owner/repo')).toThrow(RepoSiteError);
  });

  it('rejects non https URLs', () => {
    expect(() => parseRepositoryUrl('http://github.com/owner/repo')).toThrow(RepoSiteError);
  });

  it('rejects credentials and ports', () => {
    expect(() => parseRepositoryUrl('https://user:pass@github.com/owner/repo')).toThrow(RepoSiteError);
    expect(() => parseRepositoryUrl('https://github.com:8443/owner/repo')).toThrow(RepoSiteError);
  });

  it('rejects paths that are not owner/repository', () => {
    expect(() => parseRepositoryUrl('https://github.com/owner')).toThrow(RepoSiteError);
    expect(() => parseRepositoryUrl('https://github.com/owner/repo/blob/main/README.md')).toThrow(RepoSiteError);
  });

  it('rejects empty and oversized input', () => {
    expect(() => parseRepositoryUrl('')).toThrow(RepoSiteError);
    expect(() => parseRepositoryUrl(`https://github.com/owner/${'a'.repeat(600)}`)).toThrow(RepoSiteError);
  });

  it('normalizes traversal segments instead of honouring them', () => {
    // The URL parser resolves "..", so the request can never escape the owner/repo pair.
    const ref = parseRepositoryUrl('https://github.com/../etc/repo');
    expect(ref.owner).toBe('etc');
    expect(ref.repo).toBe('repo');
    expect(() => parseRepositoryUrl('https://github.com/owner/repo/../../../etc')).toThrow(RepoSiteError);
    expect(() => parseRepositoryUrl('https://github.com/owner%2F..%2Fetc/repo')).toThrow(RepoSiteError);
  });
});
