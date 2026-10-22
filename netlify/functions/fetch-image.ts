/**
 * Netlify Function: external image download.
 *
 * Performs the SSRF checks server side (DNS resolution included) so the browser
 * never talks to an untrusted host directly.
 */
import { fetchExternalImage, nodeHostResolver } from '../../src/lib/images/external';

const MAX_BODY_BYTES = 16 * 1024;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 POST 请求。' } }, 405);
  }

  let url = '';
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大。' } }, 413);
    }
    const body = JSON.parse(raw) as { url?: unknown };
    url = typeof body.url === 'string' ? body.url : '';
  } catch {
    return json({ ok: false, error: { code: 'INVALID_REQUEST', message: '请求体不是合法 JSON。' } }, 400);
  }

  if (!url) {
    return json({ ok: false, error: { code: 'INVALID_REQUEST', message: '缺少 url 参数。' } }, 400);
  }

  const result = await fetchExternalImage(url, { resolver: nodeHostResolver });
  if (!result.ok || !result.bytes) {
    return json(
      { ok: false, error: { code: 'IMAGE_DOWNLOAD_FAILED', message: result.reason ?? '下载失败。' } },
      502,
    );
  }

  const base64 = Buffer.from(result.bytes).toString('base64');
  return json({
    ok: true,
    data: {
      base64,
      contentType: result.contentType,
      finalUrl: result.finalUrl,
      bytes: result.bytes.byteLength,
    },
  });
};
