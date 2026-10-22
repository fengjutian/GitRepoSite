import { describe, expect, it } from 'vitest';
import {
  collectLocalImageReferences,
  dedupeByHash,
  hashBytes,
  planLocalImages,
} from '@/lib/images/local';
import type { DocumentPage } from '@/lib/schema';

function document(slug: string, sourcePath: string): DocumentPage {
  return {
    slug,
    title: slug,
    contentMarkdown: '',
    sourcePath,
    origin: 'repository',
    verification: 'source_verified',
    order: 0,
  };
}

describe('collectLocalImageReferences', () => {
  it('resolves relative references against the document directory', () => {
    const references = collectLocalImageReferences(
      [document('guide', 'docs/guide.md')],
      new Map([['guide', ['./img/logo.png', 'img/logo.png']]]),
    );
    expect(references).toHaveLength(1);
    expect(references[0]!.sourcePath).toBe('docs/img/logo.png');
    expect(references[0]!.referencedBy).toEqual(['guide']);
  });

  it('ignores external references', () => {
    const references = collectLocalImageReferences(
      [document('guide', 'docs/guide.md')],
      new Map([['guide', ['https://example.com/a.png', '//cdn.example.com/b.png', '#anchor']]]),
    );
    expect(references).toHaveLength(0);
  });

  it('ignores references that escape the repository', () => {
    const references = collectLocalImageReferences(
      [document('guide', 'docs/guide.md')],
      new Map([['guide', ['../../etc/passwd.png']]]),
    );
    expect(references).toHaveLength(0);
  });
});

describe('planLocalImages', () => {
  it('applies the hard limit of 50 images', () => {
    const references = Array.from({ length: 60 }, (_, index) => ({
      sourcePath: `assets/img-${index}.png`,
      referencedBy: ['readme'],
      raw: `assets/img-${index}.png`,
    }));
    const plan = planLocalImages(references, 50);
    expect(plan.selected).toHaveLength(50);
    expect(plan.skipped).toHaveLength(10);
    expect(plan.skipped[0]!.reason).toContain('50');
  });
});

describe('dedupeByHash', () => {
  it('keeps only the first item of each hash group', () => {
    const bytes = new TextEncoder().encode('same');
    const items = [
      { name: 'a', bytes },
      { name: 'b', bytes },
      { name: 'c', bytes: new TextEncoder().encode('other') },
    ];
    const result = dedupeByHash(items, (item) => hashBytes(item.bytes));
    expect(result.map((entry) => entry.item.name)).toEqual(['a', 'c']);
  });
});
