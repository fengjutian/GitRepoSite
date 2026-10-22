import { describe, expect, it } from 'vitest';
import { fetchExternalImage, isPublicIp } from '@/lib/images/external';

function imageResponse(bytes = 'binary', init: ResponseInit = {}): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/png', ...(init.headers as Record<string, string>) },
    ...init,
  });
}

describe('fetchExternalImage', () => {
  it('rejects non http(s) protocols', async () => {
    const result = await fetchExternalImage('file:///etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('协议');
  });

  it('rejects loopback and private addresses', async () => {
    const loopback = await fetchExternalImage('http://127.0.0.1/a.png');
    expect(loopback.ok).toBe(false);

    const metadata = await fetchExternalImage('http://169.254.169.254/latest/meta-data');
    expect(metadata.ok).toBe(false);
  });

  it('rejects internal hostnames', async () => {
    const result = await fetchExternalImage('http://service.internal/logo.png');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('内部主机');
  });

  it('rejects hosts that resolve to private addresses', async () => {
    const result = await fetchExternalImage('https://evil.example/logo.png', {
      resolver: async () => ['10.0.0.5'],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('非公网');
  });

  it('rejects redirects that point to private addresses', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://example.com')) {
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret.png' } });
      }
      return imageResponse();
    }) as unknown as typeof fetch;

    const result = await fetchExternalImage('https://example.com/logo.png', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('非公网');
  });

  it('rejects responses that are not images', async () => {
    const fetchImpl = (async () =>
      new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const result = await fetchExternalImage('https://example.com/logo.png', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('内容类型');
  });

  it('downloads a valid image', async () => {
    const fetchImpl = (async () => imageResponse('PNGDATA')) as unknown as typeof fetch;
    const result = await fetchExternalImage('https://example.com/logo.png', { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe('image/png');
    expect(result.bytes?.byteLength).toBeGreaterThan(0);
  });
});

describe('isPublicIp', () => {
  it('classifies private and public addresses', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('10.1.2.3')).toBe(false);
    expect(isPublicIp('192.168.0.1')).toBe(false);
    expect(isPublicIp('172.16.0.1')).toBe(false);
    expect(isPublicIp('169.254.169.254')).toBe(false);
    expect(isPublicIp('::1')).toBe(false);
    expect(isPublicIp('93.184.216.34')).toBe(true);
  });
});
