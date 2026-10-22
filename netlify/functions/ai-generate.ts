/**
 * Netlify Function: AI proxy.
 *
 * - Mode "server": the key comes from the deployment environment, the browser never sees it.
 * - Mode "byok": the key is sent per request and only used while the request is handled.
 * The key is never logged, never persisted and never returned to the client.
 */
import { resolveApiKey, resolveModel, DEEPSEEK_MODELS, MINIMAX_MODELS } from '../../src/lib/ai/providers';
import { aiProjectSummarySchema } from '../../src/lib/ai/service';
import { redactSecrets } from '../../src/lib/errors';

type JsonRecord = Record<string, unknown>;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const MAX_BODY_BYTES = 1024 * 1024;

const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request): string {
  const headers = request.headers;
  return (
    headers.get('x-nf-client-connection-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'anonymous'
  );
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function json(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ ok: false, error: { code, message } }, status);
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return fail('METHOD_NOT_ALLOWED', '只支持 POST 请求。', 405);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength && contentLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', '请求体过大。', 413);
  }

  if (rateLimited(clientKey(request))) {
    return fail('RATE_LIMITED', '请求过于频繁，请稍后重试。', 429);
  }

  let body: JsonRecord;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return fail('PAYLOAD_TOO_LARGE', '请求体过大。', 413);
    }
    body = JSON.parse(raw) as JsonRecord;
  } catch {
    return fail('INVALID_REQUEST', '请求体不是合法 JSON。', 400);
  }

  const provider = body.provider;
  const keyMode = body.keyMode;
  const language = body.language;
  const model = typeof body.model === 'string' ? body.model : undefined;
  const userApiKey = typeof body.userApiKey === 'string' ? body.userApiKey : undefined;

  if (provider !== 'deepseek' && provider !== 'minimax') {
    return fail('INVALID_PROVIDER', '不支持的 AI 服务商。', 400);
  }
  if (keyMode !== 'server' && keyMode !== 'byok') {
    return fail('INVALID_KEY_MODE', '不支持的 Key 模式。', 400);
  }
  if (language !== 'zh-CN' && language !== 'en-US') {
    return fail('INVALID_LANGUAGE', '不支持的生成语言。', 400);
  }

  const allowList = provider === 'deepseek' ? DEEPSEEK_MODELS : MINIMAX_MODELS;
  if (model && !allowList.includes(model as never)) {
    return fail('INVALID_MODEL', '模型不在允许列表中。', 400);
  }

  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : '';
  const userPrompt = typeof body.userPrompt === 'string' ? body.userPrompt : '';
  if (!systemPrompt || !userPrompt) {
    return fail('INVALID_REQUEST', '缺少提示词。', 400);
  }

  const maxInputBytes = Number(process.env.AI_MAX_INPUT_BYTES ?? 524288);
  if (new TextEncoder().encode(userPrompt).length > maxInputBytes) {
    return fail('INPUT_TOO_LARGE', '输入内容超过大小上限。', 413);
  }
  const maxOutputTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 8192);

  let apiKey: string;
  let resolvedModel: string;
  try {
    apiKey = resolveApiKey({ provider, keyMode, language, model }, userApiKey, process.env as never);
    resolvedModel = resolveModel(provider, model, process.env as never);
  } catch (error) {
    const message = error instanceof Error ? redactSecrets(error.message) : 'AI 配置无效。';
    return fail('AI_CONFIGURATION_ERROR', message, 400);
  }

  const baseUrl =
    provider === 'deepseek'
      ? (process.env.DEEPSEEK_API_BASE ?? 'https://api.deepseek.com')
      : (process.env.MINIMAX_API_BASE ?? 'https://api.minimax.io');
  const path = provider === 'deepseek' ? '/chat/completions' : '/v1/chat/completions';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: maxOutputTokens,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // Never echo the key or the full upstream body.
      return fail('AI_PROVIDER_ERROR', `AI 服务返回错误 (${response.status}): ${redactSecrets(text).slice(0, 200)}`, 502);
    }

    const payload = (await response.json()) as JsonRecord;
    const choices = payload.choices as Array<JsonRecord> | undefined;
    const message = choices?.[0]?.message as JsonRecord | undefined;
    const content = typeof message?.content === 'string' ? message.content : '';
    if (!content) {
      return fail('AI_INVALID_RESPONSE', 'AI 未返回可用内容。', 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim());
    } catch {
      return fail('AI_INVALID_RESPONSE', 'AI 返回的不是有效 JSON。', 502);
    }

    const validated = aiProjectSummarySchema.safeParse(parsed);
    if (!validated.success) {
      return fail('AI_INVALID_RESPONSE', 'AI 返回的内容未通过结构校验。', 502);
    }

    return json({ ok: true, data: validated.data });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return fail('AI_TIMEOUT', 'AI 请求超时。', 504);
    }
    return fail('AI_PROVIDER_ERROR', 'AI 请求失败，请稍后重试。', 502);
  } finally {
    clearTimeout(timeout);
  }
};
