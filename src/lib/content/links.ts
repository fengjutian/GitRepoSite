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
  /** every file and directory path in the repository, used to tell "not published" from "missing" */
  knownRepositoryPaths?: Set<string>;
}

/**
 * Checks internal links against the known documents.
 *
 * A link that points at a repository file or directory that exists but was not
 * published as a page is rewritten to the pinned commit, so it is not reported.
 * Anything that resolves nowhere is reported as a warning: the source document
 * is somebody else's content, so it must not block an export.
 */
export function auditInternalLinks(
  inputs: LinkAuditInput[],
  context: LinkAuditContext,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const repositoryPaths = context.knownRepositoryPaths ?? new Set<string>();

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
            severity: 'warning',
            category: 'link',
            message: `内部链接指向不存在的页面: ${target}`,
            target: `${input.slug} → ${target}`,
            hint: '该地址只在原站点有效，生成站点中会失效，请确认是否保留。',
          });
        }
        continue;
      }

      if (isMarkdownPath(target)) {
        const resolved = resolveTarget(input.sourcePath, target);
        if (resolved && !context.knownSourcePaths.has(resolved) && !repositoryPaths.has(resolved)) {
          issues.push({
            id: 'link-missing-document',
            severity: 'warning',
            category: 'link',
            message: `内部文档链接指向不存在的文件: ${target}`,
            target: `${input.slug} → ${target}`,
            hint: '请确认是否保留该引用。',
          });
        }
        continue;
      }

      if (resolvesInsideRepository(input.sourcePath, target, repositoryPaths)) continue;

      const slugMatch = [...context.knownSlugs].some(
        (slug) => slug === target || slug.endsWith(`/${target}`),
      );
      const routeMatch = [...context.knownRoutes].some((route) => route.endsWith(target));
      if (!slugMatch && !routeMatch) {
        issues.push({
          id: 'link-unresolved',
          severity: 'warning',
          category: 'link',
          message: `内部链接无法解析: ${target}`,
          target: `${input.slug} → ${target}`,
          hint: '目标不在仓库中，该链接在生成站点中会失效，请确认是否保留。',
        });
      }
    }
  }

  return issues;
}

/** True when the target resolves to an existing file or directory of the repository. */
function resolvesInsideRepository(
  sourcePath: string | undefined,
  target: string,
  repositoryPaths: Set<string>,
): boolean {
  const resolved = resolveTarget(sourcePath, target);
  if (!resolved) return false;
  if (repositoryPaths.has(resolved)) return true;
  // Directory links are common in monorepos: `packages/vite` has no blob entry.
  const prefix = `${resolved}/`;
  for (const candidate of repositoryPaths) {
    if (candidate.startsWith(prefix)) return true;
  }
  return false;
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
