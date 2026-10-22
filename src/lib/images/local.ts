import { dirnameOf, isImagePath, resolveRelativePath } from '../github/paths';
import type { AssetRecord, DocumentPage } from '../schema';

export interface ImageReference {
  /** normalized repository path of the referenced image */
  sourcePath: string;
  /** documents that reference the image */
  referencedBy: string[];
  /** raw reference as written in the Markdown */
  raw: string;
}

export interface LocalImagePlan {
  selected: ImageReference[];
  skipped: Array<ImageReference & { reason: string }>;
}

/**
 * Collects the repository-relative images referenced by the given documents.
 * Duplicates are merged; every reference is resolved relative to its document.
 */
export function collectLocalImageReferences(
  documents: Array<DocumentPage & { sourcePath?: string }>,
  references: Map<string, string[]>,
): ImageReference[] {
  const map = new Map<string, ImageReference>();

  for (const document of documents) {
    const rawReferences = references.get(document.slug) ?? [];
    for (const raw of rawReferences) {
      const trimmed = raw.trim();
      if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('#')) {
        continue;
      }
      let sourcePath: string;
      try {
        sourcePath = resolveRelativePath(
          document.sourcePath ? dirnameOf(document.sourcePath) : '',
          trimmed.split('#')[0]!.split('?')[0]!,
        );
      } catch {
        continue;
      }
      if (!isImagePath(sourcePath)) continue;
      const existing = map.get(sourcePath);
      if (existing) {
        if (!existing.referencedBy.includes(document.slug)) existing.referencedBy.push(document.slug);
        continue;
      }
      map.set(sourcePath, { sourcePath, referencedBy: [document.slug], raw: trimmed });
    }
  }

  return [...map.values()];
}

/** Applies the hard limit of 50 local images per generation task. */
export function planLocalImages(references: ImageReference[], maxImages = 50): LocalImagePlan {
  const selected = references.slice(0, maxImages);
  const skipped = references.slice(maxImages).map((reference) => ({
    ...reference,
    reason: `超过单次任务图片上限 (${maxImages})`,
  }));
  return { selected, skipped };
}

export function localImageToAsset(
  reference: ImageReference,
  outputPath: string,
  bytes: number,
  mimeType: string,
): AssetRecord {
  return {
    sourcePath: reference.sourcePath,
    outputPath,
    type: 'image',
    handling: 'copied',
    auditStatus: 'passed',
    bytes,
    mimeType,
  };
}

/** Deduplicates binary payloads by hash so identical images are stored once. */
export function dedupeByHash<T>(items: T[], hashOf: (item: T) => string): Array<{ item: T; hash: string }> {
  const seen = new Set<string>();
  const result: Array<{ item: T; hash: string }> = [];
  for (const item of items) {
    const hash = hashOf(item);
    if (seen.has(hash)) continue;
    seen.add(hash);
    result.push({ item, hash });
  }
  return result;
}

/** Cheap, stable, non-cryptographic hash used for asset file names. */
export function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * Rewrites relative image references of a document to the local copies that were stored
 * in the generated site. Used by the in-browser preview.
 */
export function rewriteLocalImagePaths(
  markdown: string,
  documentSourcePath: string | undefined,
  outputPathBySourcePath: Map<string, string>,
  prefix = '/',
): string {
  if (outputPathBySourcePath.size === 0) return markdown;
  const baseDir = documentSourcePath ? dirnameOf(documentSourcePath) : '';
  return markdown.replace(MARKDOWN_IMAGE_PATTERN, (full, alt: string, src: string) => {
    const trimmed = src.trim();
    if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      return full;
    }
    let sourcePath: string;
    try {
      sourcePath = resolveRelativePath(baseDir, trimmed.split('#')[0]!.split('?')[0]!);
    } catch {
      return full;
    }
    const outputPath = outputPathBySourcePath.get(sourcePath);
    if (!outputPath) return full;
    return `![${alt}](${prefix}${outputPath})`;
  });
}
