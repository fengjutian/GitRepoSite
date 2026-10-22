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
  it('blocks unsafe active content', () => {
    const report = runAudit({
      metadata,
      documents: [document({ contentMarkdown: '<script>alert(1)</script>' })],
      assets: [],
      license: { status: 'detected', identifier: 'MIT' },
    });
    expect(report.blockingCount).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.id === 'security-unsafe-content')).toBe(true);
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
  it('blocks links to unknown documents', () => {
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
    expect(issues[0]!.severity).toBe('blocking');
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
