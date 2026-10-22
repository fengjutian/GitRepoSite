import { describe, expect, it } from 'vitest';
import { extractMarkdownLinks, renderMarkdown } from '@/lib/content/markdown';

describe('renderMarkdown', () => {
  it('drops script tags from the output', async () => {
    const result = await renderMarkdown('# Title\n\n<script>alert(1)</script>\n\nHello', { highlight: false });
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('alert(1)');
    expect(result.html).toContain('<h1');
  });

  it('removes inline event handlers', async () => {
    const result = await renderMarkdown('<img src="x.png" onerror="alert(1)" />', { highlight: false });
    expect(result.html).not.toContain('onerror');
  });

  it('removes javascript: links', async () => {
    const result = await renderMarkdown('[click](javascript:alert(1))', { highlight: false });
    expect(result.html).not.toContain('javascript:');
  });

  it('keeps safe links and images', async () => {
    const result = await renderMarkdown('[docs](https://example.com/docs) ![logo](assets/logo.png)', {
      highlight: false,
    });
    expect(result.html).toContain('https://example.com/docs');
    expect(result.html).toContain('assets/logo.png');
  });

  it('collects headings, links and images', async () => {
    const result = await renderMarkdown(
      '# Title\n\n## Section\n\n[internal](./other.md) [external](https://example.com)',
      { highlight: false },
    );
    expect(result.headings.map((heading) => heading.text)).toEqual(['Title', 'Section']);
    expect(result.links.find((link) => link.text === 'internal')?.kind).toBe('internal');
    expect(result.links.find((link) => link.text === 'external')?.kind).toBe('external');
  });

  it('renders GFM tables', async () => {
    const result = await renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |', { highlight: false });
    expect(result.html).toContain('<table');
  });
});

describe('extractMarkdownLinks', () => {
  it('classifies internal and external links', () => {
    const links = extractMarkdownLinks('[a](./x.md) [b](https://example.com) [c](#anchor) [d](mailto:a@b.c)');
    expect(links.map((link) => link.kind)).toEqual(['internal', 'external', 'anchor', 'mail']);
  });
});
