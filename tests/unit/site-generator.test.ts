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

  it('never emits two files that collide on a case insensitive filesystem', async () => {
    const withReadme: DocumentPage[] = [
      ...documents,
      {
        slug: 'readme',
        title: 'Demo README',
        contentMarkdown: '# Demo README\n\nIntro.',
        sourcePath: 'README.md',
        sourceCommitSha: 'b'.repeat(40),
        origin: 'repository',
        verification: 'source_verified',
        order: 1,
        summary: 'Project overview',
      },
    ];
    const site = await generateSite({ metadata, documents: withReadme, assets, language: 'zh-CN' });
    const paths = site.files.map((file) => file.path.toLowerCase());

    expect(new Set(paths).size).toBe(paths.length);
    // `markdown/readme.md` belongs to the repository README, so the overview moves aside.
    expect(paths).toContain('markdown/readme.md');
    expect(paths).toContain('markdown/readme-home.md');

    const overview = site.files.find((file) => file.path === 'markdown/README-home.md')!.content as string;
    const readmeDoc = site.files.find((file) => file.path === 'markdown/readme.md')!.content as string;
    expect(overview).not.toBe(readmeDoc);
    expect(readmeDoc).toContain('Demo README');
  });

  it('keeps the overview markdown at markdown/README.md when no document uses that name', async () => {
    const site = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    expect(site.files.map((file) => file.path)).toContain('markdown/README.md');
  });

  it('publishes rewritten references in llms-full.txt', async () => {
    const site = await generateSite({ metadata, documents, assets, language: 'zh-CN' });
    const llmsFull = site.files.find((file) => file.path === 'llms-full.txt')!.content as string;

    expect(llmsFull).toContain('/assets/images/logo-abc123.png');
    expect(llmsFull).not.toContain('../assets/logo.png');
    expect(llmsFull).toContain(`https://github.com/owner/demo/blob/${'b'.repeat(40)}/docs/other.md`);
  });

  it('points links at repository files and directories at the pinned commit', async () => {
    const withRepoLinks: DocumentPage[] = [
      {
        slug: 'readme',
        title: 'Demo README',
        contentMarkdown:
          '# Demo README\n\n- [package](packages/vite)\n- [license](LICENSE)\n- [missing](nowhere)\n',
        sourcePath: 'README.md',
        sourceCommitSha: 'b'.repeat(40),
        origin: 'repository',
        verification: 'source_verified',
        order: 0,
        summary: 'Overview',
      },
    ];
    const site = await generateSite({
      metadata,
      documents: withRepoLinks,
      assets,
      language: 'zh-CN',
      repositoryPaths: ['LICENSE', 'README.md', 'packages', 'packages/vite', 'packages/vite/README.md'],
    });
    const markdown = site.files.find((file) => file.path === 'markdown/readme.md')!.content as string;

    expect(markdown).toContain(`https://github.com/owner/demo/tree/${'b'.repeat(40)}/packages/vite`);
    expect(markdown).toContain(`https://github.com/owner/demo/blob/${'b'.repeat(40)}/LICENSE`);
    expect(markdown).toContain('[missing](nowhere)');
  });

  it('rewrites README table rows that link a local image', async () => {
    const row: DocumentPage = {
      slug: 'readme',
      title: 'Demo README',
      contentMarkdown:
        '# Demo README\n\n' +
        '| ![logo](assets/logo.png)](packages/vite) |\n' +
        '| ![remote](https://img.shields.io/npm/v/vite.svg)](LICENSE) |\n',
      sourcePath: 'README.md',
      sourceCommitSha: 'b'.repeat(40),
      origin: 'repository',
      verification: 'source_verified',
      order: 0,
      summary: 'Overview',
    };
    const site = await generateSite({
      metadata,
      documents: [row],
      assets,
      language: 'zh-CN',
      repositoryPaths: ['LICENSE', 'README.md', 'assets', 'assets/logo.png', 'packages', 'packages/vite', 'packages/vite/index.ts'],
    });
    const markdown = site.files.find((file) => file.path === 'markdown/readme.md')!.content as string;

    expect(markdown).toContain(
      `[![logo](/assets/images/logo-abc123.png)](https://github.com/owner/demo/tree/${'b'.repeat(40)}/packages/vite)`,
    );
    expect(markdown).toContain(
      `[![remote](https://img.shields.io/npm/v/vite.svg)](https://github.com/owner/demo/blob/${'b'.repeat(40)}/LICENSE)`,
    );
  });
});
