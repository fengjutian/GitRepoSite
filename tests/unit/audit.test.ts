import { describe, expect, it } from 'vitest';
import { runAudit } from '@/lib/audit/audit';
import { auditInternalLinks } from '@/lib/content/links';
import type { AssetRecord, DocumentPage, ProjectMetadata } from '@/lib/schema';

const metadata: ProjectMetadata = {
  name: 'demo',
  description: 'demo project',
  repositoryUrl: 'https://github.com/owner/demo',
  sourceCommitSha: 'a'.repeat(40),
  targetLanguage: 'zh-CN',
  generatedAt: '2026-01-01T00:00:00.000Z',
  topics: [],
};

function document(overrides: Partial<DocumentPage> = {}): DocumentPage {
  return {
    slug: 'guide',
    title: 'Guide',
    contentMarkdown: '# Guide\n\nSome content.',
    origin: 'repository',
    verification: 'source_verified',
    order: 0,
    ...overrides,
  };
}

describe('runAudit', () => {
  it('warns about active content instead of blocking the export', () => {
    const report = runAudit({
      metadata,
      documents: [document({ contentMarkdown: '<script>alert(1)</script>' })],
      assets: [],
      license: { status: 'detected', identifier: 'MIT' },
    });
    expect(report.blockingCount).toBe(0);
    expect(
      report.issues.some((issue) => issue.id === 'security-unsafe-content' && issue.severity === 'warning'),
    ).toBe(true);
  });

  it('does not treat code samples as active content', () => {
    const report = runAudit({
      metadata,
      documents: [
        document({
          contentMarkdown:
            '# Guide\n\n```html\n<script>alert(1)</script>\n```\n\nUse `<iframe>` with care.\n',
        }),
      ],
      assets: [],
      license: { status: 'detected', identifier: 'MIT' },
    });
    expect(report.issues.some((issue) => issue.id === 'security-unsafe-content')).toBe(false);
  });

  it('warns when no license was found', () => {
    const report = runAudit({
      metadata,
      documents: [document()],
      assets: [],
      license: { status: 'missing' },
    });
    expect(report.blockingCount).toBe(0);
    expect(report.issues.some((issue) => issue.category === 'license' && issue.severity === 'warning')).toBe(true);
  });

  it('warns when more than 50 local images are processed', () => {
    const assets: AssetRecord[] = Array.from({ length: 51 }, (_, index) => ({
      sourcePath: `assets/img-${index}.png`,
      type: 'image',
      handling: 'copied',
      auditStatus: 'passed',
    }));
    const report = runAudit({
      metadata,
      documents: [document()],
      assets,
      license: { status: 'detected', identifier: 'MIT' },
    });
    expect(report.issues.some((issue) => issue.id === 'image-limit-exceeded')).toBe(true);
  });

  it('flags AI inferred content as a warning', () => {
    const report = runAudit({
      metadata,
      documents: [document()],
      assets: [],
      license: { status: 'detected', identifier: 'MIT' },
      aiInferredCount: 2,
    });
    expect(report.issues.some((issue) => issue.id === 'source-ai-inference' && issue.severity === 'warning')).toBe(true);
  });

  it('blocks documents without a title', () => {
    const report = runAudit({
      metadata,
      documents: [document({ title: '   ' })],
      assets: [],
      license: { status: 'detected', identifier: 'MIT' },
    });
    expect(report.issues.some((issue) => issue.id === 'structure-missing-title')).toBe(true);
  });
});

describe('auditInternalLinks', () => {
  it('warns about links to unknown documents', () => {
    const issues = auditInternalLinks(
      [
        {
          slug: 'guide',
          sourcePath: 'docs/guide.md',
          links: [{ href: './missing.md', text: 'missing', kind: 'internal' }],
        },
      ],
      {
        knownSourcePaths: new Set(['docs/guide.md']),
        knownSlugs: new Set(['guide']),
        knownRoutes: new Set(['/docs/guide.html']),
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.id).toBe('link-missing-document');
  });

  it('accepts repository links that are published as pinned commit URLs', () => {
    const issues = auditInternalLinks(
      [
        {
          slug: 'readme',
          sourcePath: 'README.md',
          links: [
            { href: 'packages/vite', text: 'vite', kind: 'internal' },
            { href: 'LICENSE', text: 'license', kind: 'internal' },
          ],
        },
      ],
      {
        knownSourcePaths: new Set(['README.md']),
        knownSlugs: new Set(['readme']),
        knownRoutes: new Set(['/docs/readme.html']),
        knownRepositoryPaths: new Set(['README.md', 'LICENSE', 'packages/vite/README.md']),
      },
    );
    expect(issues).toHaveLength(0);
  });

  it('warns when a repository link matches nothing at all', () => {
    const issues = auditInternalLinks(
      [
        {
          slug: 'readme',
          sourcePath: 'README.md',
          links: [{ href: 'nowhere/at/all', text: 'missing', kind: 'internal' }],
        },
      ],
      {
        knownSourcePaths: new Set(['README.md']),
        knownSlugs: new Set(['readme']),
        knownRoutes: new Set(['/docs/readme.html']),
        knownRepositoryPaths: new Set(['README.md']),
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('link-unresolved');
    expect(issues[0]!.severity).toBe('warning');
  });

  it('warns about absolute routes that only exist on the source host', () => {
    const issues = auditInternalLinks(
      [
        {
          slug: 'guide',
          sourcePath: 'docs/guide.md',
          links: [{ href: '/team', text: 'team', kind: 'internal' }],
        },
      ],
      {
        knownSourcePaths: new Set(['docs/guide.md']),
        knownSlugs: new Set(['guide']),
        knownRoutes: new Set(['/docs/guide.html']),
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('link-missing-route');
    expect(issues[0]!.severity).toBe('warning');
  });

  it('accepts links to known documents', () => {
    const issues = auditInternalLinks(
      [
        {
          slug: 'guide',
          sourcePath: 'docs/guide.md',
          links: [{ href: './other.md', text: 'other', kind: 'internal' }],
        },
      ],
      {
        knownSourcePaths: new Set(['docs/guide.md', 'docs/other.md']),
        knownSlugs: new Set(['guide', 'docs/other']),
        knownRoutes: new Set(['/docs/guide.html']),
      },
    );
    expect(issues).toHaveLength(0);
  });
});
