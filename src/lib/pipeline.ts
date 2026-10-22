import { detectLicense, identifyLicense } from './content/license';
import { auditInternalLinks } from './content/links';
import { extractMarkdownLinks } from './content/markdown';
import { runAudit } from './audit/audit';
import { GitHubClient, type GitHubClientOptions, type TreeEntry } from './github/client';
import { parseRepositoryUrl } from './github/url';
import { isExcludedPath, pathToSlug, slugToTitle } from './github/paths';
import { collectLocalImageReferences, hashBytes, planLocalImages } from './images/local';
import { sanitizeSvg } from './images/svg';
import type {
  AssetRecord,
  AuditReport,
  DocumentPage,
  GenerationLanguage,
  LicenseInfo,
  ProjectMetadata,
} from './schema';

export interface LoadRepositoryOptions {
  targetLanguage: GenerationLanguage;
  clientOptions?: GitHubClientOptions;
  client?: GitHubClient;
  maxImages?: number;
  maxDocuments?: number;
  maxMarkdownChars?: number;
  maxImageBytes?: number;
  now?: () => Date;
}

export interface RepositoryContent {
  metadata: ProjectMetadata;
  documents: DocumentPage[];
  assets: AssetRecord[];
  binaryAssets: Map<string, Uint8Array>;
  imageReferences: Map<string, string[]>;
  license: LicenseInfo;
  treeTruncated: boolean;
  fileTreeSummary: string;
  readmeMarkdown: string;
}

const DOC_DIRECTORIES = ['docs', 'doc', 'documentation', 'guide', 'guides', 'wiki', 'manual'];
const ROOT_DOC_NAMES = [
  'changelog.md',
  'contributing.md',
  'architecture.md',
  'usage.md',
  'installation.md',
  'api.md',
];
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

/** Loads a public repository and turns it into the structured content model. */
export async function loadRepository(
  repositoryUrl: string,
  options: LoadRepositoryOptions,
): Promise<RepositoryContent> {
  const client = options.client ?? new GitHubClient(options.clientOptions);
  const maxImages = options.maxImages ?? 50;
  const maxDocuments = options.maxDocuments ?? 60;
  const maxMarkdownChars = options.maxMarkdownChars ?? 200_000;
  const maxImageBytes = options.maxImageBytes ?? 8 * 1024 * 1024;

  const reference = parseRepositoryUrl(repositoryUrl);
  const repository = await client.getRepository(reference);
  const commitSha = await client.resolveCommitSha(reference);
  const tree = await client.getTree(reference, commitSha);

  const entries = tree.entries.filter((entry) => entry.type === 'blob' && !isExcludedPath(entry.path));
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));

  const readmeEntry = entries.find(
    (entry) => /(^|\/)readme\.md$/i.test(entry.path) && !entry.path.includes('/'),
  );
  const readmeMarkdown = readmeEntry
    ? await readText(client, reference, readmeEntry)
    : '';

  const license = await resolveLicense(entries, entryByPath, client, reference, repository);

  const documentPaths = pickDocumentPaths(
    entries.map((entry) => entry.path),
    readmeEntry?.path,
  );
  const documents: DocumentPage[] = [];
  const imageReferences = new Map<string, string[]>();

  for (const path of documentPaths.slice(0, maxDocuments)) {
    const entry = entryByPath.get(path);
    if (!entry) continue;
    const markdown = await readText(client, reference, entry);
    if (!markdown) continue;

    const slug = documentSlug(path, readmeEntry?.path);
    const title = extractTitle(markdown, path);
    documents.push({
      slug,
      title,
      contentMarkdown: markdown.slice(0, maxMarkdownChars),
      sourcePath: path,
      sourceCommitSha: commitSha,
      origin: 'repository',
      verification: 'source_verified',
      order: documents.length,
      summary: extractSummary(markdown),
    });
    imageReferences.set(slug, extractImageReferences(markdown));
  }

  // --- images --------------------------------------------------------------
  const assets: AssetRecord[] = [];
  const binaryAssets = new Map<string, Uint8Array>();
  const candidates = collectLocalImageReferences(documents, imageReferences);
  const plan = planLocalImages(candidates, maxImages);

  const usedHashes = new Set<string>();
  for (const candidate of plan.selected) {
    const entry = entryByPath.get(candidate.sourcePath);
    if (!entry) {
      assets.push({
        sourcePath: candidate.sourcePath,
        type: 'image',
        handling: 'skipped',
        auditStatus: 'failed',
        reason: '文件在仓库树中不存在',
      });
      continue;
    }
    if (entry.size && entry.size > maxImageBytes) {
      assets.push({
        sourcePath: candidate.sourcePath,
        type: 'image',
        handling: 'skipped',
        auditStatus: 'warning',
        reason: `图片体积超过上限 (${maxImageBytes} 字节)`,
      });
      continue;
    }

    let bytes = await client.getBlobBytes(reference, entry.sha);
    const extension = extensionOf(candidate.sourcePath);
    let svgNote: string | undefined;
    if (extension === '.svg') {
      const sanitized = sanitizeSvg(new TextDecoder().decode(bytes));
      if (!/<svg[\s>]/i.test(sanitized.svg)) {
        assets.push({
          sourcePath: candidate.sourcePath,
          type: 'image',
          handling: 'skipped',
          auditStatus: 'failed',
          reason: 'SVG 净化后没有可渲染内容，已跳过。',
        });
        continue;
      }
      bytes = new TextEncoder().encode(sanitized.svg);
      if (sanitized.removedElements.length > 0) {
        svgNote = `已移除 SVG 主动内容: ${sanitized.removedElements.join(', ')}`;
      }
    }
    const hash = hashBytes(bytes);
    if (usedHashes.has(hash)) {
      assets.push({
        sourcePath: candidate.sourcePath,
        type: 'image',
        handling: 'skipped',
        auditStatus: 'passed',
        reason: '与已复制图片内容重复',
      });
      continue;
    }
    usedHashes.add(hash);

    const fileName = `${hash}-${sanitizeFileName(baseNameOf(candidate.sourcePath))}${extension}`;
    const outputPath = `assets/images/${fileName}`;
    binaryAssets.set(outputPath, bytes);
    assets.push({
      sourcePath: candidate.sourcePath,
      outputPath,
      type: 'image',
      handling: 'copied',
      auditStatus: 'passed',
      bytes: bytes.byteLength,
      mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
      reason: svgNote,
    });
  }

  for (const skipped of plan.skipped) {
    assets.push({
      sourcePath: skipped.sourcePath,
      type: 'image',
      handling: 'skipped',
      auditStatus: 'warning',
      reason: skipped.reason,
    });
  }

  const metadata: ProjectMetadata = {
    name: repository.name || reference.repo,
    description: repository.description ?? '',
    repositoryUrl: `https://github.com/${reference.owner}/${reference.repo}`,
    sourceCommitSha: commitSha,
    sourceLanguage: repository.language ?? undefined,
    targetLanguage: options.targetLanguage,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    homepage: repository.homepage ?? undefined,
    topics: repository.topics?.slice(0, 20) ?? [],
    stars: repository.stars,
    license,
  };

  return {
    metadata,
    documents,
    assets,
    binaryAssets,
    imageReferences,
    license,
    treeTruncated: tree.truncated,
    fileTreeSummary: summarizeTree(entries.map((entry) => entry.path)),
    readmeMarkdown,
  };
}

/** Runs the link, image and source audits on a loaded repository. */
export async function auditRepository(
  content: RepositoryContent,
  overrides?: { documents?: DocumentPage[] },
): Promise<AuditReport> {
  const documents = overrides?.documents ?? content.documents;
  const linkInputs = documents.map((document) => ({
    slug: document.slug,
    sourcePath: document.sourcePath,
    links: extractMarkdownLinks(document.contentMarkdown),
  }));

  const knownRoutes = new Set<string>(['/', '/docs/', '/404.html']);
  for (const document of documents) knownRoutes.add(`/docs/${document.slug}.html`);

  const linkIssues = auditInternalLinks(linkInputs, {
    knownSourcePaths: new Set(
      documents.map((document) => document.sourcePath).filter((path): path is string => Boolean(path)),
    ),
    knownSlugs: new Set(documents.map((document) => document.slug)),
    knownRoutes,
  });

  const imageIssues = [];
  for (const asset of content.assets) {
    if (asset.handling === 'skipped' && asset.auditStatus === 'failed') {
      imageIssues.push({
        id: 'image-missing',
        severity: 'blocking' as const,
        category: 'image' as const,
        message: `图片无法解析: ${asset.sourcePath ?? '未知路径'}`,
        target: asset.sourcePath,
        hint: '请修复引用路径或跳过该图片。',
      });
    } else if (asset.handling === 'skipped' && asset.auditStatus === 'warning') {
      imageIssues.push({
        id: 'image-skipped',
        severity: 'warning' as const,
        category: 'image' as const,
        message: `图片被跳过: ${asset.sourcePath ?? '未知路径'} (${asset.reason ?? '原因未知'})`,
        target: asset.sourcePath,
      });
    }
  }

  return runAudit({
    metadata: content.metadata,
    documents,
    assets: content.assets,
    license: content.license,
    linkIssues,
    imageIssues,
    externalLinkCount: 0,
  });
}

async function resolveLicense(
  entries: TreeEntry[],
  entryByPath: Map<string, TreeEntry>,
  client: GitHubClient,
  reference: { owner: string; repo: string },
  repository: { license?: { spdxId: string | null; name: string | null } | null },
): Promise<LicenseInfo> {
  const detected = detectLicense(entries.map((entry) => entry.path));
  if (detected.sourcePath) {
    const entry = entryByPath.get(detected.sourcePath);
    const text = entry ? await readText(client, reference, entry) : '';
    const identifier = identifyLicense(text);
    return {
      status: identifier ? 'detected' : 'uncertain',
      sourcePath: detected.sourcePath,
      identifier,
    };
  }

  const spdx = repository.license?.spdxId;
  if (spdx && spdx !== 'NOASSERTION') {
    return { status: 'detected', identifier: spdx };
  }
  return { status: 'missing' };
}

async function readText(
  client: GitHubClient,
  reference: { owner: string; repo: string },
  entry: { path: string; sha: string },
): Promise<string> {
  const bytes = await client.getBlobBytes(reference, entry.sha);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function pickDocumentPaths(paths: string[], readmePath?: string): string[] {
  const selected: string[] = [];
  for (const path of paths) {
    if (!/\.md$/i.test(path)) continue;
    if (readmePath && path === readmePath) continue;
    const segments = path.split('/');
    if (segments.length === 1) {
      if (ROOT_DOC_NAMES.includes(path.toLowerCase())) selected.push(path);
      continue;
    }
    if (segments.length <= 3 && DOC_DIRECTORIES.includes(segments[0]!.toLowerCase())) {
      selected.push(path);
    }
  }
  return selected;
}

function documentSlug(path: string, readmePath?: string): string {
  if (readmePath && path === readmePath) return 'readme';
  return pathToSlug(path.replace(/\.md$/i, ''));
}

function extractTitle(markdown: string, path: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  if (heading) return heading[1]!.trim().slice(0, 200);
  return slugToTitle(path.replace(/\.md$/i, ''));
}

function extractSummary(markdown: string): string {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/^#+\s+.*$/gm, ' ');
  const text = withoutCode.replace(/\s+/g, ' ').trim();
  return text.slice(0, 220);
}

export function extractImageReferences(markdown: string): string[] {
  const references: string[] = [];
  const pattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match = pattern.exec(markdown);
  while (match) {
    references.push(match[1]!);
    match = pattern.exec(markdown);
  }
  const htmlPattern = /<img[^>]+src\s*=\s*"([^"]+)"/gi;
  let htmlMatch = htmlPattern.exec(markdown);
  while (htmlMatch) {
    references.push(htmlMatch[1]!);
    htmlMatch = htmlPattern.exec(markdown);
  }
  return references;
}

function summarizeTree(paths: string[]): string {
  const directories = new Map<string, number>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const directory = segments.slice(0, index).join('/');
      directories.set(directory, (directories.get(directory) ?? 0) + 1);
    }
  }
  return [...directories.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 200)
    .map(([directory, count]) => `${directory}/ (${count} files)`)
    .join('\n');
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
}

function baseNameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'asset'
  );
}
