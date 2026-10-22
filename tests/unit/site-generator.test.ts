import { describe, expect, it } from 'vitest';
import { generateSite } from '@/lib/site/generator';
import type { AssetRecord, DocumentPage, ProjectMetadata } from '@/lib/schema';

const metadata: ProjectMetadata = {
  name: 'demo <script>alert(1)</script>',
  description: 'A demo project',
  repositoryUrl: 'https://github.com/owner/demo',
  sourceCommitSha: 'b'.repeat(40),
  targetLanguage: 'zh-CN',
  generatedAt: '2026-01-01T00:00:00.000Z',
  topics: ['cli'],
  license: { status: 'detected', identifier: 'MIT', sourcePath: 'LICENSE' },
};

const documents: DocumentPage[] = [
  {
    slug: 'docs/guide',
    title: 'Guide',
    contentMarkdown: '# Guide\n\n![logo](../assets/logo.png)\n\n[other](./other.md)',
    sourcePath: 'docs/guide.md',
    sourceCommitSha: 'b'.repeat(40),
    origin: 'repository',
    verification: 'source_verified',
    order: 0,
    summary: 'How to use the demo project',
  },
];

const assets: AssetRecord[] = [
  {
    sourcePath: 'assets/logo.png',
    outputPath: 'assets/images/logo-abc123.png',
    type: 'image',
    handling: 'copied',
    auditStatus: 'passed',
    bytes: 12,
    mimeType: 'image/png',
  },
];

describe('generateSite', () => {
  it('produces the documented output structure', async () => {
    const site = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    const paths = site.files.map((file) => file.path);

    expect(paths).toContain('index.html');
    expect(paths).toContain('404.html');
    expect(paths).toContain('docs/index.html');
    expect(paths).toContain('docs/docs/guide.html');
    expect(paths).toContain('markdown/README.md');
    expect(paths).toContain('markdown/docs/guide.md');
    expect(paths).toContain('ai/manifest.json');
    expect(paths).toContain('ai/pages.json');
    expect(paths).toContain('ai/chunks.json');
    expect(paths).toContain('llms.txt');
    expect(paths).toContain('llms-full.txt');
    expect(paths).toContain('robots.txt');
    expect(paths).toContain('sitemap.xml');
    expect(paths).toContain('assets/css/site.css');
    expect(paths).toContain('assets/js/site.js');
  });

  it('escapes untrusted metadata in the HTML output', async () => {
    const site = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    const home = site.files.find((file) => file.path === 'index.html')!.content as string;
    expect(home).not.toContain('<script>alert(1)</script>');
    expect(home).toContain('&lt;script&gt;');
  });

  it('rewrites local image references to the copied assets', async () => {
    const site = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    const page = site.files.find((file) => file.path === 'docs/docs/guide.html')!.content as string;
    expect(page).toContain('/assets/images/logo-abc123.png');
    expect(page).not.toContain('../assets/logo.png');
  });

  it('rewrites links to repository files to the pinned commit', async () => {
    const site = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    const markdown = site.files.find((file) => file.path === 'markdown/docs/guide.md')!.content as string;
    expect(markdown).toContain(`https://github.com/owner/demo/blob/${'b'.repeat(40)}/docs/other.md`);
  });

  it('writes machine readable indexes', async () => {
    const site = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    const manifest = JSON.parse(
      site.files.find((file) => file.path === 'ai/manifest.json')!.content as string,
    ) as { pages: Array<{ slug: string; verification: string }>; sourceCommitSha: string };
    expect(manifest.pages[0]!.slug).toBe('docs/guide');
    expect(manifest.pages[0]!.verification).toBe('source_verified');
    expect(manifest.sourceCommitSha).toBe('b'.repeat(40));

    const llms = site.files.find((file) => file.path === 'llms.txt')!.content as string;
    expect(llms).toContain('demo');
    expect(llms).toContain('/docs/docs/guide.html');

    const sitemap = site.files.find((file) => file.path === 'sitemap.xml')!.content as string;
    expect(sitemap).toContain('<urlset');
  });

  it('never writes API keys into the generated site', async () => {
    const site = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    for (const file of site.files) {
      if (typeof file.content !== 'string') continue;
      expect(file.content).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(file.content).not.toContain('DEEPSEEK_API_KEY=');
    }
  });

  it('is deterministic for the same input', async () => {
    const first = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    const second = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    const toMap = (site: typeof first) =>
      new Map(site.files.map((file) => [file.path, file.content as string]));
    expect(toMap(first)).toEqual(toMap(second));
  });
});
