import JSZip from 'jszip';
import type { GeneratedFile } from '../site/generator';

export interface ZipPackageResult {
  blob: Blob;
  fileCount: number;
  totalBytes: number;
  fileNames: string[];
}

export const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/ },
  { name: 'api-key-assignment', pattern: /\b(?:api[_-]?key|apikey|access[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{16,}/i },
  { name: 'server-key-env', pattern: /\b(?:DEEPSEEK|MINIMAX)_API_KEY\s*=/ },
  { name: 'authorization-header', pattern: /["']authorization["']\s*:\s*["'][^"']{12,}/i },
];

/** Returns the names of files that look like they contain credentials. */
export function scanForSecrets(files: Array<{ path: string; content: string | Uint8Array }>): string[] {
  const suspicious: string[] = [];
  for (const file of files) {
    if (typeof file.content !== 'string') continue;
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(file.content)) {
        suspicious.push(`${file.path} (${name})`);
        break;
      }
    }
  }
  return suspicious;
}

/**
 * Packages the generated site into a ZIP archive. The archive is rejected when a file
 * looks like it contains a credential.
 */
export async function packageSite(
  files: GeneratedFile[],
  options: { maxBytes?: number } = {},
): Promise<ZipPackageResult> {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const totalBytes = files.reduce(
    (sum, file) => sum + (typeof file.content === 'string' ? file.content.length : file.content.byteLength),
    0,
  );

  if (totalBytes > maxBytes) {
    throw new Error(
      `生成内容约 ${Math.round(totalBytes / 1024 / 1024)} MB，超过浏览器可承受的打包上限 (${Math.round(maxBytes / 1024 / 1024)} MB)。`,
    );
  }

  const suspicious = scanForSecrets(files);
  if (suspicious.length > 0) {
    throw new Error(`检测到疑似密钥内容，已阻止导出: ${suspicious.join(', ')}`);
  }

  const zip = new JSZip();
  for (const file of files) {
    const entry = zip.file(file.path);
    if (!entry) continue;
    if (typeof file.content === 'string') {
      entry.file(file.path, file.content);
    } else {
      entry.file(file.path, file.content);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return {
    blob,
    fileCount: files.length,
    totalBytes: blob.size,
    fileNames: files.map((file) => file.path),
  };
}
