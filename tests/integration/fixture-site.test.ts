import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateSite } from '@/lib/site/generator';
import type { AssetRecord, DocumentPage, ProjectMetadata } from '@/lib/schema';

const metadata: ProjectMetadata = {
  name: 'demo-project',
  description: 'A demo project used to inspect the generated site.',
  repositoryUrl: 'https://github.com/demo/demo-project',
  sourceCommitSha: 'a'.repeat(40),
  targetLanguage: 'zh-CN',
  generatedAt: '2026-01-01T00:00:00.000Z',
  topics: ['demo', 'docs'],
  stars: 42,
  license: { status: 'detected', identifier: 'MIT' },
};

const documents: DocumentPage[] = [
  {
    slug: 'readme',
    title: 'Demo Project',
    summary: 'Demo project overview.',
    contentMarkdown:
      '# Demo Project\n\nIntro paragraph with a [link](https://example.com) and `code`.\n\n' +
      '![diagram](assets/images/diagram.svg)\n\n' +
      '## Install\n\n```bash\nnpm install demo-project\n```\n\n' +
      '| Option | Default |\n| --- | --- |\n| verbose | false |\n',
    sourcePath: 'README.md',
    sourceCommitSha: 'a'.repeat(40),
    origin: 'repository',
    verification: 'source_verified',
    order: 0,
  },
  {
    slug: 'docs-guide',
    title: 'Guide',
    summary: 'How to use the demo project.',
    contentMarkdown:
      '# Guide\n\nStep by step instructions.\n\nSee the [README](../README.md) and the [licence](../LICENSE).\n',
    sourcePath: 'docs/guide.md',
    sourceCommitSha: 'a'.repeat(40),
    origin: 'repository',
    verification: 'source_verified',
    order: 1,
  },
];

const assets: AssetRecord[] = [
  {
    sourcePath: 'assets/images/diagram.svg',
    outputPath: 'assets/images/diagram.svg',
    type: 'image',
    handling: 'copied',
    auditStatus: 'passed',
    bytes: 120,
    mimeType: 'image/svg+xml',
  },
];

describe('fixture site', () => {
  it('writes a sample site for manual inspection', async () => {
    const site = await generateSite({
      metadata,
      documents,
      assets,
      binaryAssets: new Map([['assets/images/diagram.svg', new Uint8Array([60, 115, 118, 103, 62])]]),
      repositoryPaths: [
        'LICENSE',
        'README.md',
        'assets',
        'assets/images',
        'assets/images/diagram.svg',
        'docs',
        'docs/guide.md',
      ],
      language: 'zh-CN',
      summary: '由 AI 生成的简介（推断内容）。',
      highlights: ['开箱即用', '类型安全'],
      quickStart: 'npm install demo-project',
      tags: ['demo'],
      audience: '前端开发者',
    });

    const outDir = new URL('../.tmp/fixture-site/', import.meta.url);
    await mkdir(outDir, { recursive: true });
    for (const file of site.files) {
      const target = new URL(file.path, outDir);
      await mkdir(new URL('.', target), { recursive: true });
      await writeFile(target, typeof file.content === 'string' ? file.content : Buffer.from(file.content));
    }

    const paths = site.files.map((file) => file.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('docs/readme.html');
    expect(paths).toContain('docs/docs-guide.html');
    expect(paths).toContain('markdown/docs-guide.md');
    expect(paths).toContain('llms.txt');
    expect(paths).toContain('ai/manifest.json');
    expect(paths).toContain('markdown/README-home.md');

    // A link to a generated page stays internal, a link to another repository file is
// pinned to the commit so it still works outside the generated site.
    const guideMarkdown = site.files.find((file) => file.path === 'markdown/docs-guide.md')!.content as string;
    expect(guideMarkdown).toContain('[README](/docs/readme.html)');
    expect(guideMarkdown).toContain(
      `[licence](https://github.com/demo/demo-project/blob/${'a'.repeat(40)}/LICENSE)`,
    );
  });
});
