/**
 * Optional download of external images referenced by the repository documents.
 *
 * The default behaviour of RepoSite is to keep remote images as remote links. When the
 * user explicitly opts in, every remote image is fetched through the server side proxy
 * (which performs the SSRF checks) and stored inside the generated site.
 */
import { hashBytes } from './local';
import type { AssetRecord, DocumentPage } from '../schema';

export interface ExternalImageDownloader {
  (url: string): Promise<{
    ok: boolean;
    bytes?: Uint8Array;
    contentType?: string;
    reason?: string;
  }>;
}

export interface ExternalDownloadResult {
  /** assets that were downloaded and stored in the site */
  assets: AssetRecord[];
  /** binary payload per output path */
  binaryAssets: Map<string, Uint8Array>;
  /** documents with the remote URLs rewritten to the local copies */
  documents: DocumentPage[];
  /** images that could not be downloaded, with the reason */
  failed: Array<{ url: string; reason: string }>;
}

export interface ExternalDownloadOptions {
  /** hard limit of downloaded remote images per task */
  maxImages?: number;
  /** bytes of the largest accepted image */
  maxBytes?: number;
  /** hash function used for the file name */
  hash?: (bytes: Uint8Array) => string;
}

const DEFAULT_MAX_IMAGES = 20;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** Maps a content type to a file extension; returns null for anything that is not an image. */
export function extensionFromContentType(contentType: string | undefined): string | null {
  const fromType = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
    'image/bmp': '.bmp',
    'image/x-icon': '.ico',
  };
  return fromType ? (map[fromType] ?? null) : null;
}

function extensionFor(contentType: string | undefined, url: string): string {
  const fromType = extensionFromContentType(contentType);
  if (fromType) return fromType;
  try {
    const pathname = new URL(url).pathname;
    const match = /\.[a-z0-9]{1,5}$/i.exec(pathname);
    if (match) return match[0].toLowerCase();
  } catch {
    /* ignore */
  }
  return '.img';
}

function baseNameFor(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').filter(Boolean).pop() ?? 'image';
    return name.replace(/[^A-Za-z0-9._-]/g, '-').slice(-60) || 'image';
  } catch {
    return 'image';
  }
}

/**
 * Downloads the remote images referenced by the given documents and rewrites the
 * Markdown so the generated site points at the local copies.
 */
export async function downloadExternalImages(
  documents: DocumentPage[],
  imageReferences: Map<string, string[]>,
  downloader: ExternalImageDownloader,
  options: ExternalDownloadOptions = {},
): Promise<ExternalDownloadResult> {
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const hash = options.hash ?? hashBytes;

  const urls: string[] = [];
  for (const references of imageReferences.values()) {
    for (const reference of references) {
      const trimmed = reference.trim();
      if (!isRemoteHttpUrl(trimmed)) continue;
      if (!urls.includes(trimmed)) urls.push(trimmed);
    }
  }

  const assets: AssetRecord[] = [];
  const binaryAssets = new Map<string, Uint8Array>();
  const failed: Array<{ url: string; reason: string }> = [];
  const localPathByUrl = new Map<string, string>();
  const usedHashes = new Set<string>();

  for (const url of urls.slice(0, maxImages)) {
    const result = await downloader(url);
    if (!result.ok || !result.bytes || result.bytes.byteLength === 0) {
      failed.push({ url, reason: result.reason ?? '下载失败' });
      assets.push({
        sourcePath: url,
        type: 'image',
        handling: 'skipped',
        auditStatus: 'warning',
        reason: `外部图片下载失败: ${result.reason ?? '未知原因'}`,
      });
      continue;
    }
    if (result.bytes.byteLength > maxBytes) {
      failed.push({ url, reason: '图片体积超过上限' });
      assets.push({
        sourcePath: url,
        type: 'image',
        handling: 'skipped',
        auditStatus: 'warning',
        reason: '外部图片体积超过上限',
      });
      continue;
    }

    const contentHash = hash(result.bytes);
    if (usedHashes.has(contentHash)) {
      failed.push({ url, reason: '与已下载图片内容重复' });
      continue;
    }
    usedHashes.add(contentHash);

    const extension = extensionFor(result.contentType, url);
    const fileName = `${contentHash}-${baseNameFor(url)}${extension}`.replace(/-+(\.[a-z0-9]+)$/i, '$1');
    const outputPath = `assets/images/${fileName}`;
    binaryAssets.set(outputPath, result.bytes);
    localPathByUrl.set(url, outputPath);
    assets.push({
      sourcePath: url,
      outputPath,
      type: 'image',
      handling: 'copied',
      auditStatus: 'passed',
      bytes: result.bytes.byteLength,
      mimeType: result.contentType ?? 'application/octet-stream',
      reason: '已下载外部图片',
    });
  }

  const rewritten = documents.map((document) => ({
    ...document,
    contentMarkdown: rewriteRemoteImages(document.contentMarkdown, localPathByUrl),
  }));

  return { assets, binaryAssets, documents: rewritten, failed };
}

/** Rewrites remote image URLs that were downloaded to the local copy. */
export function rewriteRemoteImages(markdown: string, localPathByUrl: Map<string, string>): string {
  if (localPathByUrl.size === 0) return markdown;
  return markdown.replace(MARKDOWN_IMAGE_PATTERN, (full, alt: string, src: string) => {
    const local = localPathByUrl.get(src.trim());
    if (!local) return full;
    return `![${alt}](${local})`;
  });
}

/** Decodes a base64 payload (as returned by the server side proxy) into bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
