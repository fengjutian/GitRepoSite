import { describe, expect, it } from 'vitest';
import { auditRepository, loadRepository } from '@/lib/pipeline';
import { generateSite } from '@/lib/site/generator';
import { packageSite } from '@/lib/export/zip';

const REPOSITORY = 'https://github.com/vitejs/vite';

describe('repository integration', () => {
  it('loads, audits and generates a site for a public repository', async () => {
    const content = await loadRepository(REPOSITORY, {
      targetLanguage: 'zh-CN',
      maxDocuments: 8,
      maxImages: 10,
    });

    expect(content.metadata.repositoryUrl).toContain('github.com');
    expect(content.metadata.sourceCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(content.documents.length).toBeGreaterThan(0);
    expect(content.documents[0]!.slug).toBe('readme');
    expect(content.license.status).toBe('detected');

    const report = await auditRepository(content);
    expect(report.blockingCount).toBe(0);

    const site = await generateSite({
      metadata: content.metadata,
      documents: content.documents,
      assets: content.assets,
      binaryAssets: content.binaryAssets,
      language: 'zh-CN',
    });

    const names = site.files.map((file) => file.path);
    expect(names).toContain('index.html');
    expect(names).toContain('404.html');
    expect(names).toContain('docs/readme.html');
    expect(names).toContain('llms.txt');
    expect(names).toContain('llms-full.txt');
    expect(names).toContain('sitemap.xml');
    expect(names).toContain('ai/manifest.json');

    const index = site.files.find((file) => file.path === 'index.html')!.content;
    expect(index).toContain(content.metadata.name);

    const zip = await packageSite(site.files);
    expect(zip.fileCount).toBe(site.files.length);
    expect(zip.fileNames).toContain('index.html');

    const suspicious = /(sk-[A-Za-z0-9]{16,}|Authorization:|api[_-]?key\s*[:=]|DEEPSEEK_API_KEY|MINIMAX_API_KEY)/i;
    for (const file of site.files) {
      const text = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content);
      expect(suspicious.test(text), `secret like content in ${file.path}`).toBe(false);
    }
  }, 120_000);
});
