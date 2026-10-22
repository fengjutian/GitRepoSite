import { RepoSiteError } from '../errors';

export interface ExternalImageLimits {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

export const DEFAULT_EXTERNAL_LIMITS: ExternalImageLimits = {
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 12_000,
  maxRedirects: 3,
};

export interface ExternalFetchResult {
  ok: boolean;
  bytes?: Uint8Array;
  contentType?: string;
  finalUrl?: string;
  reason?: string;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.lan', '.home.arpa', '.corp'];
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'metadata',
  'metadata.google.internal',
]);

export interface HostResolver {
  (hostname: string): Promise<string[]>;
}

/** Node.js DNS resolver used by the server-side image proxy. */
export const nodeHostResolver: HostResolver = async (hostname) => {
  const dns = await import('node:dns/promises');
  const records = await dns.lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

/** Browser fallback: only literal IP addresses can be checked. */
export const literalHostResolver: HostResolver = async (hostname) => {
  if (isIpAddress(hostname)) return [hostname];
  return [];
};

/**
 * Downloads an external image with SSRF protections: scheme allow-list, private network
 * blocking, redirect re-validation, size and timeout limits and content-type verification.
 */
export async function fetchExternalImage(
  rawUrl: string,
  options: {
    limits?: Partial<ExternalImageLimits>;
    resolver?: HostResolver;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<ExternalFetchResult> {
  const limits = { ...DEFAULT_EXTERNAL_LIMITS, ...(options.limits ?? {}) };
  const resolver = options.resolver ?? literalHostResolver;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  let currentUrl = rawUrl;
  for (let redirect = 0; redirect <= limits.maxRedirects; redirect += 1) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, reason: 'URL 无法解析' };
    }

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return { ok: false, reason: `不允许的协议: ${parsed.protocol}` };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, reason: 'URL 不允许包含认证信息' };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return { ok: false, reason: `拒绝访问内部主机: ${hostname}` };
    }
    if (isIpAddress(hostname) && !isPublicIp(hostname)) {
      return { ok: false, reason: `拒绝访问非公网地址: ${hostname}` };
    }

    let addresses: string[] = [];
    try {
      addresses = await resolver(hostname);
    } catch {
      return { ok: false, reason: '域名解析失败' };
    }
    if (addresses.some((address) => !isPublicIp(address))) {
      return { ok: false, reason: `域名解析到非公网地址: ${hostname}` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    try {
      const response = await fetchImpl(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'image/*' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return { ok: false, reason: '重定向缺少目标地址' };
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        return { ok: false, reason: `下载失败 (${response.status})` };
      }

      const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (contentType && !contentType.startsWith('image/')) {
        return { ok: false, reason: `内容类型不是图片: ${contentType}` };
      }

      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (declaredLength && declaredLength > limits.maxBytes) {
        return { ok: false, reason: `图片体积超过上限 (${limits.maxBytes} 字节)` };
      }

      const buffer = await readLimited(response, limits.maxBytes);
      if (!buffer) {
        return { ok: false, reason: `图片体积超过上限 (${limits.maxBytes} 字节)` };
      }

      return {
        ok: true,
        bytes: buffer,
        contentType: contentType || 'application/octet-stream',
        finalUrl: currentUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return { ok: false, reason: `下载失败: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reason: '重定向次数过多' };
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) return null;
  return new Uint8Array(buffer);
}

export function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

/** Rejects loopback, private, link-local, multicast and reserved address ranges. */
export function isPublicIp(address: string): boolean {
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::') return false;
    if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      return isPublicIp(mapped);
    }
    return true;
  }

  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return false;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0) return false;
  if (a >= 224) return false;
  return true;
}

export function assertPublicUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new RepoSiteError('UNSAFE_URL', '外部资源地址无效。');
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new RepoSiteError('UNSAFE_URL', '外部资源只允许 http/https。');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new RepoSiteError('UNSAFE_URL', '外部资源地址指向内部主机。');
  }
  if (isIpAddress(hostname) && !isPublicIp(hostname)) {
    throw new RepoSiteError('UNSAFE_URL', '外部资源地址指向非公网 IP。');
  }
  return parsed;
}
