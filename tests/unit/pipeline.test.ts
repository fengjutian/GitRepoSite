import { describe, expect, it } from 'vitest';
import { loadRepository } from '@/lib/pipeline';
import { RepoSiteError } from '@/lib/errors';
import type { GitHubClient, TreeEntry } from '@/lib/github/client';

const SHA = 'c'.repeat(40);

const TREE: TreeEntry[] = [
  { path: 'README.md', mode: '100644', type: 'blob', size: 40, sha: '1'.repeat(40) },
  { path: 'LICENSE', mode: '100644', type: 'blob', size: 20, sha: '2'.repeat(40) },
  { path: 'docs/guide.md', mode: '100644', type: 'blob', size: 60, sha: '3'.repeat(40) },
  { path: 'docs/img/logo.png', mode: '100644', type: 'blob', size: 8, sha: '4'.repeat(40) },
];

const FILES: Record<string, string> = {
  'README.md': '# Demo\n\nRead the [guide](docs/guide.md).\n',
  LICENSE: 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy.',
  'docs/guide.md': '# Guide\n\n![logo](img/logo.png)\n',
  'docs/img/logo.png': 'PNGDATA',
};

interface FileRead {
  path: string;
  commitSha: string;
}

function createFakeClient(reads: FileRead[]): GitHubClient {
  const client = {
    async getRepository() {
      return {
        id: 1,
        name: 'demo',
        fullName: 'owner/demo',
        description: 'A demo repository',
        htmlUrl: 'https://github.com/owner/demo',
        homepage: null,
        defaultBranch: 'main',
        language: 'TypeScript',
        topics: [],
        stars: 0,
        license: null,
        archived: false,
        pushedAt: null,
      };
    },
    async resolveCommitSha() {
      return SHA;
    },
    async getTree() {
      return { entries: TREE, truncated: false };
    },
    async getFileBytes(
      _ref: { owner: string; repo: string },
      commitSha: string,
      path: string,
    ) {
      reads.push({ path, commitSha });
      const content = FILES[path];
      if (content === undefined) throw new Error(`unexpected read: ${path}`);
      return new TextEncoder().encode(content);
    },
  };
  return client as unknown as GitHubClient;
}

describe('loadRepository', () => {
  it('reads every file from the pinned commit through the content channel', async () => {
    const reads: FileRead[] = [];
    const content = await loadRepository('https://github.com/owner/demo', {
      targetLanguage: 'zh-CN',
      client: createFakeClient(reads),
    });

    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.commitSha).toBe(SHA);
    }
    expect(reads.map((read) => read.path)).toContain('docs/guide.md');
    expect(reads.map((read) => read.path)).toContain('docs/img/logo.png');
  });

  it('builds the document model and copies the referenced image', async () => {
    const content = await loadRepository('https://github.com/owner/demo', {
      targetLanguage: 'zh-CN',
      client: createFakeClient([]),
    });

    expect(content.documents.map((document) => document.slug)).toEqual(['readme', 'docs/guide']);
    expect(content.documents.every((document) => document.sourceCommitSha === SHA)).toBe(true);

    const copied = content.assets.filter((asset) => asset.handling === 'copied');
    expect(copied).toHaveLength(1);
    expect(copied[0]!.sourcePath).toBe('docs/img/logo.png');
    expect(copied[0]!.outputPath).toMatch(/^assets\/images\/.+\.png$/);
    expect(content.binaryAssets.get(copied[0]!.outputPath!)).toBeInstanceOf(Uint8Array);
  });

  it('detects the license from the repository file', async () => {
    const content = await loadRepository('https://github.com/owner/demo', {
      targetLanguage: 'zh-CN',
      client: createFakeClient([]),
    });

    expect(content.license.status).toBe('detected');
    expect(content.license.identifier).toBe('MIT');
    expect(content.license.sourcePath).toBe('LICENSE');
  });

  it('collects every file and directory path for link resolution', async () => {
    const content = await loadRepository('https://github.com/owner/demo', {
      targetLanguage: 'zh-CN',
      client: createFakeClient([]),
    });

    expect(content.repositoryPaths).toContain('docs');
    expect(content.repositoryPaths).toContain('docs/img');
    expect(content.repositoryPaths).toContain('docs/guide.md');
  });

  it('keeps the task alive when a single image cannot be read', async () => {
    const base = createFakeClient([]);
    const failing = {
      ...base,
      async getFileBytes(
        ref: { owner: string; repo: string },
        commitSha: string,
        path: string,
        blobSha?: string,
      ) {
        if (path === 'docs/img/logo.png') {
          throw new RepoSiteError('GITHUB_ERROR', '仓库中不存在该文件', { status: 404 });
        }
        return base.getFileBytes(ref, commitSha, path, blobSha);
      },
    } as unknown as GitHubClient;

    const content = await loadRepository('https://github.com/owner/demo', {
      targetLanguage: 'zh-CN',
      client: failing,
    });

    expect(content.documents).toHaveLength(2);
    const skipped = content.assets.filter((asset) => asset.handling === 'skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.auditStatus).toBe('warning');
  });
});
