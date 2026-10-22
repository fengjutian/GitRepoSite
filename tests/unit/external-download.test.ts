import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  downloadExternalImages,
  extensionFromContentType,
} from '@/lib/images/external-download';
import { rewriteLocalImagePaths } from '@/lib/images/local';
import type { DocumentPage } from '@/lib/schema';

function document(overrides: Partial<DocumentPage> = {}): DocumentPage {
  return {
    slug: 'guide',
    title: 'Guide',
    contentMarkdown: '# Guide\n\n![logo](https://example.com/logo.png)',
    origin: 'repository',
    verification: 'source_verified',
    order: 0,
    sourcePath: 'docs/guide.md',
    ...overrides,
  };
}

describe('extensionFromContentType', () => {
  it('maps known image types', () => {
    expect(extensionFromContentType('image/png')).toBe('.png');
    expect(extensionFromContentType('image/jpeg; charset=binary')).toBe('.jpg');
    expect(extensionFromContentType('image/svg+xml')).toBe('.svg');
  });

  it('rejects non image content types', () => {
    expect(extensionFromContentType('text/html')).toBeNull();
    expect(extensionFromContentType('application/octet-stream')).toBeNull();
  });
});

describe('base64ToBytes', () => {
  it('decodes base64 payloads', () => {
    const bytes = base64ToBytes('aGVsbG8=');
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });
});

describe('downloadExternalImages', () => {
  it('keeps external links when the download fails', async () => {
    const result = await downloadExternalImages(
      [document()],
      new Map([['guide', ['https://example.com/logo.png']]]),
      async () => ({ ok: false, reason: '连接超时' }),
    );

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.handling).toBe('skipped');
    expect(result.assets[0]!.auditStatus).toBe('warning');
    expect(result.failed).toHaveLength(1);
    expect(result.documents[0]!.contentMarkdown).toContain('https://example.com/logo.png');
  });

  it('stores the downloaded image and rewrites the reference', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await downloadExternalImages(
      [document()],
      new Map([['guide', ['https://example.com/logo.png']]]),
      async () => ({ ok: true, bytes, contentType: 'image/png' }),
    );

    expect(result.failed).toHaveLength(0);
    expect(result.assets[0]!.handling).toBe('copied');
    expect(result.binaryAssets.size).toBe(1);
    const outputPath = [...result.binaryAssets.keys()][0]!;
    expect(outputPath.startsWith('assets/images/')).toBe(true);
    expect(result.documents[0]!.contentMarkdown).toContain(outputPath);
    expect(result.documents[0]!.contentMarkdown).not.toContain('https://example.com/logo.png');
  });

  it('never downloads more than the configured limit', async () => {
    const references = Array.from({ length: 10 }, (_, index) => `https://example.com/${index}.png`);
    const result = await downloadExternalImages(
      [document()],
      new Map([['guide', references]]),
      async (url) => ({ ok: true, bytes: new Uint8Array([url.slice(-5).charCodeAt(0), 1]), contentType: 'image/png' }),
      { maxImages: 3 },
    );

    expect(result.assets.filter((asset) => asset.handling === 'copied')).toHaveLength(3);
  });
});

describe('rewriteLocalImagePaths', () => {
  it('rewrites relative image references to the copied assets', () => {
    const markdown = '![logo](images/logo.png)\n\n![external](https://example.com/a.png)';
    const rewritten = rewriteLocalImagePaths(
      markdown,
      'docs/guide.md',
      new Map([['docs/images/logo.png', 'assets/images/abc-logo.png']]),
    );

    expect(rewritten).toContain('![logo](/assets/images/abc-logo.png)');
    expect(rewritten).toContain('![external](https://example.com/a.png)');
  });

  it('leaves the markdown untouched when nothing was copied', () => {
    const markdown = '![logo](images/logo.png)';
    expect(rewriteLocalImagePaths(markdown, 'docs/guide.md', new Map())).toBe(markdown);
  });
});
