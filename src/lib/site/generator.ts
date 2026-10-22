import { renderMarkdown, markdownToPlainText, escapeHtml } from '../content/markdown';
import { dirnameOf, resolveRelativePath } from '../github/paths';
import type {
  AssetRecord,
  AuditReport,
  DocumentPage,
  GenerationLanguage,
  ProjectMetadata,
} from '../schema';
import {
  renderDocIndex,
  renderDocument,
  renderHome,
  renderNotFound,
  SITE_CSS,
  SITE_JS,
  type NavItem,
} from './templates';

export interface SiteInput {
  metadata: ProjectMetadata;
  documents: DocumentPage[];
  assets: AssetRecord[];
  binaryAssets?: Map<string, Uint8Array>;
  language: GenerationLanguage;
  summary?: string;
  highlights?: string[];
  quickStart?: string;
  tags?: string[];
  audience?: string;
  siteOrigin?: string;
  audit?: AuditReport;
}

export interface GeneratedFile {
  path: string;
  content: string | Uint8Array;
}

export interface GeneratedSite {
  files: GeneratedFile[];
  totalBytes: number;
  fileCount: number;
}

const CHUNK_SIZE = 1200;

export async function generateSite(input: SiteInput): Promise<GeneratedSite> {
  const { metadata, documents, language } = input;
  const files: GeneratedFile[] = [];

  const ordered = [...documents].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const nav: NavItem[] = ordered.map((document) => ({
    title: document.title,
    href: `/docs/${document.slug}.html`,
    slug: document.slug,
  }));

  const assetUrlByPath = new Map<string, string>();
  for (const asset of input.assets) {
    if (asset.handling === 'copied' && asset.outputPath && asset.sourcePath) {
      assetUrlByPath.set(asset.sourcePath, `/${asset.outputPath}`);
    }
  }

  const pagePathBySourcePath = new Map<string, string>();
  for (const document of ordered) {
    if (document.sourcePath) pagePathBySourcePath.set(document.sourcePath, `/docs/${document.slug}.html`);
  }

  const siteTitle = metadata.name;
  const siteDescription = metadata.description || markdownToPlainText(metadata.description, 200);
  const baseOptions = {
    metadata,
    language,
    nav,
    siteTitle,
    siteDescription,
    canonicalPath: '/',
  };

  // --- Documentation pages -------------------------------------------------
  const pageSummaries: Array<{ title: string; href: string; summary: string; sourcePath?: string }> = [];

  for (const document of ordered) {
    const markdown = rewriteDocument(
      document.contentMarkdown,
      document.sourcePath,
      assetUrlByPath,
      pagePathBySourcePath,
      metadata,
    );
    const rendered = await renderMarkdown(markdown, { highlight: true });
    // The page template already renders the title, so a leading H1 in the source is dropped.
    const content = stripLeadingTitle(rendered.html, rendered.headings);

    const html = renderDocument({
      ...baseOptions,
      canonicalPath: `/docs/${document.slug}.html`,
      title: document.title,
      html: content.html,
      headings: content.headings,
      sourcePath: document.sourcePath,
      origin: document.origin,
    });
    files.push({ path: `docs/${document.slug}.html`, content: html });
    files.push({ path: `markdown/${document.slug}.md`, content: markdown });

    pageSummaries.push({
      title: document.title,
      href: `/docs/${document.slug}.html`,
      summary: document.summary || markdownToPlainText(markdown, 220),
      sourcePath: document.sourcePath,
    });
  }

  // --- Home page -----------------------------------------------------------
  const homeMarkdown = buildHomeMarkdown(input);
  const homeRendered = await renderMarkdown(homeMarkdown, { highlight: true });
  const homeHtml = renderHome({
    ...baseOptions,
    canonicalPath: '/',
    summary: input.summary || markdownToPlainText(homeMarkdown, 800),
    highlights: input.highlights ?? [],
    quickStart: input.quickStart ?? '',
    tags: input.tags ?? metadata.topics ?? [],
    audience: input.audience,
    sourceCommit: metadata.sourceCommitSha,
  });
  files.push({ path: 'index.html', content: homeHtml });
  files.push({
    path: uniqueMarkdownPath(
      'markdown/README.md',
      new Set(ordered.map((document) => `markdown/${document.slug}.md`.toLowerCase())),
    ),
    content: homeMarkdown,
  });

  // --- Docs index ----------------------------------------------------------
  files.push({
    path: 'docs/index.html',
    content: renderDocIndex({
      ...baseOptions,
      canonicalPath: '/docs/',
      items: pageSummaries,
    }),
  });

  // --- 404 -----------------------------------------------------------------
  files.push({
    path: '404.html',
    content: renderNotFound({ ...baseOptions, canonicalPath: '/404.html' }),
  });

  // --- Static assets -------------------------------------------------------
  files.push({ path: 'assets/css/site.css', content: SITE_CSS });
  files.push({ path: 'assets/js/site.js', content: SITE_JS });
  for (const [path, bytes] of input.binaryAssets ?? new Map<string, Uint8Array>()) {
    files.push({ path, content: bytes });
  }

  // --- AI friendly outputs -------------------------------------------------
  files.push({ path: 'ai/manifest.json', content: buildManifest(input, ordered) });
  files.push({ path: 'ai/pages.json', content: buildPagesJson(input, ordered) });
  files.push({ path: 'ai/chunks.json', content: buildChunksJson(input, ordered) });
  files.push({ path: 'llms.txt', content: buildLlmsTxt(input, ordered, pageSummaries) });
  files.push({ path: 'llms-full.txt', content: buildLlmsFullTxt(input, ordered) });
  files.push({ path: 'robots.txt', content: buildRobotsTxt(input.siteOrigin) });
  files.push({ path: 'sitemap.xml', content: buildSitemap(input, ordered, pageSummaries) });

  const totalBytes = files.reduce((sum, file) => sum + byteLength(file.content), 0);
  assertUniquePaths(files);
  return { files, totalBytes, fileCount: files.length };
}

/**
 * Picks a markdown path that cannot collide with a document markdown file.
 * Windows and macOS treat paths case insensitively, so `markdown/readme.md` and
 * `markdown/README.md` would silently overwrite each other when the archive is
 * unpacked. The fallback keeps the output identical on every platform.
 */
export function uniqueMarkdownPath(preferred: string, takenLowerCase: Set<string>): string {
  if (!takenLowerCase.has(preferred.toLowerCase())) return preferred;
  const base = preferred.replace(/\.md$/i, '');
  let candidate = `${base}-home.md`;
  let counter = 2;
  while (takenLowerCase.has(candidate.toLowerCase())) {
    candidate = `${base}-home-${counter}.md`;
    counter += 1;
  }
  return candidate;
}

/** Guards against two generated files sharing the same path on a case insensitive filesystem. */
export function assertUniquePaths(files: GeneratedFile[]): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (seen.has(key)) duplicates.push(file.path);
    seen.add(key);
  }
  if (duplicates.length > 0) {
    throw new Error(`生成结果存在重名文件（大小写不敏感冲突）：${duplicates.join(', ')}`);
  }
}

function byteLength(content: string | Uint8Array): number {
  if (typeof content === 'string') return new TextEncoder().encode(content).length;
  return content.byteLength;
}

/** Removes a leading H1 from the rendered document so the title is not rendered twice. */
export function stripLeadingTitle(
  html: string,
  headings: Array<{ id: string; text: string; depth: number }>,
): { html: string; headings: Array<{ id: string; text: string; depth: number }> } {
  const match = /^\s*<h1(\s[^>]*)?>([\s\S]*?)<\/h1>\s*/i.exec(html);
  if (!match) return { html, headings };

  const idMatch = /id="([^"]*)"/i.exec(match[1] ?? '');
  const id = idMatch ? idMatch[1]! : '';
  const remaining = id
    ? headings.filter((heading) => !(heading.depth === 1 && heading.id === id))
    : headings.filter((heading) => heading.depth !== 1);
  return { html: html.slice(match[0].length), headings: remaining };
}

/** Rewrites image and repository-file references so the generated site is self contained. */
export function rewriteDocument(
  markdown: string,
  sourcePath: string | undefined,
  assetUrlByPath: Map<string, string>,
  pagePathBySourcePath: Map<string, string>,
  metadata: ProjectMetadata,
): string {
  let output = markdown;

  output = output.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt: string, src: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) return match;
    const resolved = resolveMaybe(sourcePath, src);
    if (!resolved) return match;
    const url = assetUrlByPath.get(resolved);
    if (!url) return match;
    return `![${alt}](${url})`;
  });

  output = output.replace(/<img\s+([^>]*?)src\s*=\s*"([^"]*)"([^>]*)>/gi, (match, before: string, src: string, after: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) return match;
    const resolved = resolveMaybe(sourcePath, src);
    if (!resolved) return match;
    const url = assetUrlByPath.get(resolved);
    if (!url) return match;
    return `<img ${before}src="${url}"${after}>`;
  });

  output = output.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label: string, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return match;
    const resolved = resolveMaybe(sourcePath, href);
    if (!resolved) return match;
    if (pagePathBySourcePath.has(resolved)) {
      return `[${label}](${pagePathBySourcePath.get(resolved)})`;
    }
    if (/\.md$/i.test(resolved)) {
      const base = metadata.repositoryUrl.replace(/\/+$/, '');
      return `[${label}](${base}/blob/${metadata.sourceCommitSha}/${resolved})`;
    }
    return match;
  });

  return output;
}

function resolveMaybe(sourcePath: string | undefined, reference: string): string | undefined {
  const clean = reference.split('#')[0]!.split('?')[0]!;
  if (!clean) return undefined;
  try {
    return resolveRelativePath(sourcePath ? dirnameOf(sourcePath) : '', clean);
  } catch {
    return undefined;
  }
}

function buildHomeMarkdown(input: SiteInput): string {
  const { metadata } = input;
  const lines: string[] = [];
  lines.push(`# ${metadata.name}`, '');
  if (metadata.description) {
    lines.push(metadata.description, '');
  }
  if (input.summary) {
    lines.push(input.summary, '');
  }
  if (input.highlights?.length) {
    lines.push('## Highlights', '');
    for (const highlight of input.highlights) {
      lines.push(`- ${highlight}`);
    }
    lines.push('');
  }
  if (input.quickStart) {
    lines.push('## Quick start', '', '```bash', input.quickStart, '```', '');
  }
  lines.push('## Source', '');
  lines.push(`- Repository: ${metadata.repositoryUrl}`);
  lines.push(`- Commit: ${metadata.sourceCommitSha}`);
  if (metadata.license?.identifier) {
    lines.push(`- License: ${metadata.license.identifier}`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildManifest(input: SiteInput, ordered: DocumentPage[]): string {
  const manifest = {
    generator: 'RepoSite',
    name: input.metadata.name,
    description: input.metadata.description,
    repositoryUrl: input.metadata.repositoryUrl,
    sourceCommitSha: input.metadata.sourceCommitSha,
    sourceLanguage: input.metadata.sourceLanguage,
    targetLanguage: input.language,
    generatedAt: input.metadata.generatedAt,
    license: input.metadata.license ?? null,
    topics: input.metadata.topics ?? [],
    pageCount: ordered.length,
    pages: ordered.map((document) => ({
      slug: document.slug,
      title: document.title,
      url: `/docs/${document.slug}.html`,
      markdown: `/markdown/${document.slug}.md`,
      sourcePath: document.sourcePath ?? null,
      origin: document.origin,
      verification: document.verification,
      summary: document.summary ?? '',
    })),
    audit: input.audit
      ? {
          blockingCount: input.audit.blockingCount,
          warningCount: input.audit.warningCount,
          issues: input.audit.issues.map((issue) => ({
            id: issue.id,
            severity: issue.severity,
            category: issue.category,
            message: issue.message,
            target: issue.target ?? null,
          })),
        }
      : null,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function buildPagesJson(input: SiteInput, ordered: DocumentPage[]): string {
  const pages = ordered.map((document) => ({
    slug: document.slug,
    title: document.title,
    url: `/docs/${document.slug}.html`,
    sourcePath: document.sourcePath ?? null,
    sourceCommitSha: document.sourceCommitSha ?? input.metadata.sourceCommitSha,
    origin: document.origin,
    verification: document.verification,
    summary: document.summary ?? markdownToPlainText(document.contentMarkdown, 400),
  }));
  return `${JSON.stringify({ pages }, null, 2)}\n`;
}

function buildChunksJson(input: SiteInput, ordered: DocumentPage[]): string {
  const chunks: Array<Record<string, unknown>> = [];
  let index = 0;
  for (const document of ordered) {
    const text = markdownToPlainText(document.contentMarkdown, 100_000);
    const parts = chunkText(text, CHUNK_SIZE);
    for (const part of parts) {
      index += 1;
      chunks.push({
        id: `${document.slug}#${index}`,
        page: document.slug,
        title: document.title,
        content: part,
        sourcePath: document.sourcePath ?? null,
        sourceCommitSha: document.sourceCommitSha ?? input.metadata.sourceCommitSha,
        origin: document.origin,
        verification: document.verification,
      });
    }
  }
  return `${JSON.stringify({ chunkSize: CHUNK_SIZE, chunks }, null, 2)}\n`;
}

export function chunkText(text: string, size: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?。！？])\s+/)) {
    if (current.length + sentence.length > size && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += `${sentence} `;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function buildLlmsTxt(
  input: SiteInput,
  ordered: DocumentPage[],
  summaries: Array<{ title: string; href: string; summary: string }>,
): string {
  const { metadata } = input;
  const lines: string[] = [];
  lines.push(`# ${metadata.name}`);
  lines.push('');
  lines.push(`> ${input.summary || metadata.description || ''}`);
  lines.push('');
  lines.push('## Project metadata');
  lines.push('');
  lines.push(`- Repository: ${metadata.repositoryUrl}`);
  lines.push(`- Commit: ${metadata.sourceCommitSha}`);
  if (metadata.license?.identifier) {
    lines.push(`- License: ${metadata.license.identifier}`);
  }
  lines.push(`- Language: ${input.language}`);
  lines.push('');
  lines.push('## Docs');
  lines.push('');
  for (const summary of summaries) {
    lines.push(`- [${summary.title}](${summary.href}): ${summary.summary}`);
  }
  lines.push('');
  lines.push('## Optional');
  lines.push('');
  lines.push('- [Full text](llms-full.txt)');
  lines.push('- [Content index](ai/manifest.json)');
  lines.push('');
  return lines.join('\n');
}

function buildLlmsFullTxt(input: SiteInput, ordered: DocumentPage[]): string {
  const { metadata } = input;
  const parts: string[] = [];
  parts.push(`# ${metadata.name}`);
  parts.push('');
  parts.push(metadata.description || '');
  parts.push('');
  parts.push(`Source: ${metadata.repositoryUrl} @ ${metadata.sourceCommitSha}`);
  parts.push('');
  for (const document of ordered) {
    parts.push(`## ${document.title}`);
    parts.push('');
    if (document.sourcePath) {
      parts.push(`<!-- source: ${document.sourcePath} -->`);
    }
    parts.push(document.contentMarkdown);
    parts.push('');
  }
  return parts.join('\n');
}

function buildRobotsTxt(siteOrigin?: string): string {
  const lines = ['User-agent: *', 'Allow: /', ''];
  if (siteOrigin) {
    lines.push(`Sitemap: ${siteOrigin.replace(/\/+$/, '')}/sitemap.xml`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildSitemap(
  input: SiteInput,
  ordered: DocumentPage[],
  summaries: Array<{ href: string }>,
): string {
  const origin = input.siteOrigin ? input.siteOrigin.replace(/\/+$/, '') : '';
  const locations = ['/', '/docs/', ...summaries.map((summary) => summary.href)];
  const entries = locations
    .map((location) => `  <url><loc>${escapeHtml(`${origin}${location}`)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
