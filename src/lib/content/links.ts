import { RepoSiteError } from '../errors';
import { dirnameOf, isMarkdownPath, normalizeRepoPath, resolveRelativePath } from '../github/paths';
import type { AuditIssue } from '../schema';
import type { MarkdownLink } from './markdown';

export interface LinkAuditInput {
  /** slug of the document that contains the link */
  slug: string;
  /** repository path of the source document, when it comes from the repository */
  sourcePath?: string;
  links: MarkdownLink[];
}

export interface LinkAuditContext {
  /** normalized repository paths of all known documents */
  knownSourcePaths: Set<string>;
  /** slugs of all generated pages */
  knownSlugs: Set<string>;
  /** routes published by the generator */
  knownRoutes: Set<string>;
}

/**
 * Checks internal links against the known documents. Links that cannot be resolved
 * are reported as blocking issues so the user can fix or remove them.
 */
export function auditInternalLinks(
  inputs: LinkAuditInput[],
  context: LinkAuditContext,
): AuditIssue[] {
  const issues: AuditIssue[] = [];

  for (const input of inputs) {
    for (const link of input.links) {
      if (link.kind !== 'internal') continue;
      // Image references are audited by the image audit, not by the page link audit.
      if (link.isImage) continue;
      const target = stripQueryAndHash(link.href);
      if (!target) continue;

      if (target.startsWith('/')) {
        if (!context.knownRoutes.has(target)) {
          issues.push({
            id: 'link-missing-route',
            severity: 'blocking',
            category: 'link',
            message: `内部链接指向不存在的页面: ${target}`,
            target: `${input.slug} → ${target}`,
            hint: '请修正链接或移除该引用。',
          });
        }
        continue;
      }

      if (isMarkdownPath(target)) {
        const resolved = resolveTarget(input.sourcePath, target);
        if (resolved && !context.knownSourcePaths.has(resolved)) {
          issues.push({
            id: 'link-missing-document',
            severity: 'blocking',
            category: 'link',
            message: `内部文档链接指向不存在的文件: ${target}`,
            target: `${input.slug} → ${target}`,
            hint: '请修正链接或移除该引用。',
          });
        }
        continue;
      }

      const slugMatch = [...context.knownSlugs].some(
        (slug) => slug === target || slug.endsWith(`/${target}`),
      );
      const routeMatch = [...context.knownRoutes].some((route) => route.endsWith(target));
      if (!slugMatch && !routeMatch) {
        issues.push({
          id: 'link-unresolved',
          severity: 'blocking',
          category: 'link',
          message: `内部链接无法解析到已生成页面: ${target}`,
          target: `${input.slug} → ${target}`,
          hint: '请修正链接或移除该引用。',
        });
      }
    }
  }

  return issues;
}

function resolveTarget(sourcePath: string | undefined, target: string): string | undefined {
  try {
    if (!sourcePath) return normalizeRepoPath(target);
    return resolveRelativePath(dirnameOf(sourcePath), target);
  } catch (error) {
    if (error instanceof RepoSiteError) return undefined;
    throw error;
  }
}

export function stripQueryAndHash(href: string): string {
  return href.split('#')[0]!.split('?')[0]!.trim();
}
