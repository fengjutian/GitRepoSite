import { RepoSiteError, redactSecrets } from '../errors';
import type { AIKeyMode, AIProviderName, GenerationLanguage } from '../schema';

export interface AIRequestConfig {
  provider: AIProviderName;
  keyMode: AIKeyMode;
  language: GenerationLanguage;
  model?: string;
}

export interface AIProviderInput {
  systemPrompt: string;
  userPrompt: string;
  config: AIRequestConfig;
  /** Only used in BYOK mode. Never logged, never persisted. */
  userApiKey?: string;
}

export interface AIProvider {
  readonly name: AIProviderName;
  generate(input: AIProviderInput): Promise<unknown>;
}

export interface ProviderEnvironment {
  DEEPSEEK_API_KEY?: string;
  MINIMAX_API_KEY?: string;
  DEEPSEEK_API_BASE?: string;
  MINIMAX_API_BASE?: string;
  DEEPSEEK_MODEL?: string;
  MINIMAX_MODEL?: string;
}

export const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const;
export const MINIMAX_MODELS = [
  'MiniMax-M2',
  'MiniMax-M2.1',
  'MiniMax-Text-01',
  'abab6.5s-chat',
] as const;

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const MINIMAX_BASE_URL = 'https://api.minimax.io';

/** Resolves the model name, enforcing the server-side allow-list. */
export function resolveModel(
  provider: AIProviderName,
  requested: string | undefined,
  environment: ProviderEnvironment = {},
): string {
  const allowList: readonly string[] = provider === 'deepseek' ? DEEPSEEK_MODELS : MINIMAX_MODELS;
  const fallback = environment[provider === 'deepseek' ? 'DEEPSEEK_MODEL' : 'MINIMAX_MODEL'];
  const candidate = requested ?? fallback ?? allowList[0]!;
  if (!allowList.includes(candidate)) {
    throw new RepoSiteError('AI_CONFIGURATION_ERROR', `模型不在允许列表中: ${candidate}`, { status: 400 });
  }
  return candidate;
}

/**
 * Resolves the API key for the request.
 * Server mode ignores any user supplied key and uses the environment variable.
 */
export function resolveApiKey(
  config: AIRequestConfig,
  userApiKey: string | undefined,
  environment: ProviderEnvironment = {},
): string {
  if (config.keyMode === 'byok') {
    const key = (userApiKey ?? '').trim();
    if (!key) {
      throw new RepoSiteError('AI_CONFIGURATION_ERROR', '缺少用户自带 API Key。', { status: 400 });
    }
    if (key.length > 512) {
      throw new RepoSiteError('AI_CONFIGURATION_ERROR', 'API Key 长度异常。', { status: 400 });
    }
    return key;
  }

  const serverKey = config.provider === 'deepseek' ? environment.DEEPSEEK_API_KEY : environment.MINIMAX_API_KEY;
  const key = (serverKey ?? '').trim();
  if (!key) {
    throw new RepoSiteError('AI_CONFIGURATION_ERROR', '服务端未配置该服务商的 API Key。', { status: 400 });
  }
  return key;
}

interface ChatCompletionOptions {
  baseUrl: string;
  path: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}

async function chatCompletion(options: ChatCompletionOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetchImpl(`${options.baseUrl}${options.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: options.userPrompt },
        ],
        temperature: 0.2,
        max_tokens: options.maxOutputTokens,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new RepoSiteError('AI_PROVIDER_ERROR', 'AI 服务拒绝了认证，请检查 API Key。', { status: 502 });
    }
    if (response.status === 429) {
      throw new RepoSiteError('AI_RATE_LIMITED', 'AI 服务触发频率限制，请稍后重试。', { status: 429 });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new RepoSiteError(
        'AI_PROVIDER_ERROR',
        `AI 服务返回错误 (${response.status}): ${redactSecrets(body).slice(0, 200)}`,
        { status: 502 },
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const content = extractContent(payload);
    if (!content) {
      throw new RepoSiteError('AI_INVALID_RESPONSE', 'AI 未返回可用内容。', { status: 502 });
    }
    return content;
  } catch (error) {
    if (error instanceof RepoSiteError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RepoSiteError('AI_PROVIDER_ERROR', 'AI 请求超时。', { status: 504 });
    }
    throw new RepoSiteError('AI_PROVIDER_ERROR', 'AI 请求失败，请稍后重试。', { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function extractContent(payload: Record<string, unknown>): string {
  const choices = payload.choices as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          typeof part === 'string'
            ? part
            : typeof (part as Record<string, unknown>)?.text === 'string'
              ? String((part as Record<string, unknown>).text)
              : '',
        )
        .join('');
    }
  }
  // MiniMax native response shape.
  const reply = payload.reply as string | undefined;
  if (typeof reply === 'string') return reply;
  return '';
}

export interface ProviderOptions {
  environment?: ProviderEnvironment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export class DeepSeekProvider implements AIProvider {
  readonly name: AIProviderName = 'deepseek';
  private readonly options: ProviderOptions;

  constructor(options: ProviderOptions = {}) {
    this.options = options;
  }

  async generate(input: AIProviderInput): Promise<unknown> {
    const environment = this.options.environment ?? {};
    const apiKey = resolveApiKey(input.config, input.userApiKey, environment);
    const model = resolveModel('deepseek', input.config.model, environment);
    const content = await chatCompletion({
      baseUrl: environment.DEEPSEEK_API_BASE ?? DEEPSEEK_BASE_URL,
      path: '/chat/completions',
      apiKey,
      model,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      timeoutMs: this.options.timeoutMs ?? 90_000,
      maxOutputTokens: this.options.maxOutputTokens ?? 8192,
      fetchImpl: this.options.fetchImpl,
    });
    return JSON.parse(content) as unknown;
  }
}

export class MiniMaxProvider implements AIProvider {
  readonly name: AIProviderName = 'minimax';
  private readonly options: ProviderOptions;

  constructor(options: ProviderOptions = {}) {
    this.options = options;
  }

  async generate(input: AIProviderInput): Promise<unknown> {
    const environment = this.options.environment ?? {};
    const apiKey = resolveApiKey(input.config, input.userApiKey, environment);
    const model = resolveModel('minimax', input.config.model, environment);
    const content = await chatCompletion({
      baseUrl: environment.MINIMAX_API_BASE ?? MINIMAX_BASE_URL,
      path: '/v1/chat/completions',
      apiKey,
      model,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      timeoutMs: this.options.timeoutMs ?? 90_000,
      maxOutputTokens: this.options.maxOutputTokens ?? 8192,
      fetchImpl: this.options.fetchImpl,
    });
    return JSON.parse(content) as unknown;
  }
}

export function createProvider(name: AIProviderName, options: ProviderOptions = {}): AIProvider {
  return name === 'deepseek' ? new DeepSeekProvider(options) : new MiniMaxProvider(options);
}
