import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadRepository, auditRepository } from '@/lib/pipeline';
import { generateSite } from '@/lib/site/generator';
import { packageSite } from '@/lib/export/zip';
import { RepoSiteError } from '@/lib/errors';

const REPO = 'https://github.com/vitejs/vite';

describe('repository integration', () => {
  it('loads, audits and generates a site for a public repository', async () => {
    let content;
    try {
      content = await loadRepository(REPO, {
        targetLanguage: 'zh-CN',
        maxDocuments: 4,
        maxImages: 4,
      });
    } catch (error) {
      // The public GitHub API allows only 60 requests per hour without a token.
      if (error instanceof RepoSiteError && error.code === 'GITHUB_RATE_LIMIT') {
        console.warn('跳过集成测试：GitHub API 速率限制已用尽。');
        return;
      }
      throw error;
    }
    expect(content.metadata.sourceCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(content.documents.length).toBeGreaterThan(0);
    expect(content.documents[0]!.slug).toBe('readme');

    const report = await auditRepository(content);
    if (report.blockingCount > 0) {
      console.log(JSON.stringify(report.issues.filter((i) => i.severity === 'blocking'), null, 1));
    }
    expect(report.blockingCount).toBe(0);

    const site = await generateSite({
      metadata: content.metadata,
      documents: content.documents,
      assets: content.assets,
      binaryAssets: content.binaryAssets,
      repositoryPaths: content.repositoryPaths,
      language: 'zh-CN',
    });
    const paths = site.files.map((f) => f.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('llms.txt');
    expect(paths).toContain('llms-full.txt');
    expect(paths).toContain('sitemap.xml');
    expect(paths).toContain('ai/manifest.json');
    expect(paths).toContain('docs/readme.html');

    // Real repositories link to directories, licences and workflow files constantly.
    // Those must become pinned repository links instead of dead relative paths.
    const sha = content.metadata.sourceCommitSha;
    const readmeMarkdown = site.files.find((f) => f.path === 'markdown/readme.md')!.content as string;
    expect(readmeMarkdown).not.toMatch(/\]\(packages\/vite\)/);
    expect(readmeMarkdown).toContain(`https://github.com/vitejs/vite/blob/${sha}/LICENSE`);

    const zip = await packageSite(site.files);
    expect(zip.fileCount).toBe(site.files.length);
    expect(zip.fileNames).toContain('index.html');

    const outDir = new URL('../.tmp/generated-site/', import.meta.url);
    await mkdir(outDir, { recursive: true });
    for (const file of site.files) {
      const target = new URL(file.path, outDir);
      await mkdir(new URL('.', target), { recursive: true });
      await writeFile(target, typeof file.content === 'string' ? file.content : Buffer.from(file.content));
    }
  }, 120_000);
});
