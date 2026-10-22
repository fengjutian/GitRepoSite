import { z } from 'zod';
import { RepoSiteError } from '../errors';
import type { GenerationLanguage } from '../schema';
import { buildPagePrompt, buildProjectPrompt, buildSystemPrompt, extractJson, type PromptContext } from './prompts';
import type { AIProvider } from './providers';

export const aiProjectSummarySchema = z.object({
  summary: z.string().min(1).max(4000),
  highlights: z.array(z.string().max(500)).max(12).default([]),
  quickStart: z.string().max(12000).default(''),
  tags: z.array(z.string().max(60)).max(20).default([]),
  audience: z.string().max(600).optional(),
  facts: z
    .array(
      z.object({
        claim: z.string().max(600),
        source: z.enum(['repository', 'ai_inferred']),
      }),
    )
    .max(40)
    .default([]),
});

export const aiPageSchema = z.object({
  title: z.string().min(1).max(300),
  summary: z.string().max(1000).default(''),
  contentMarkdown: z.string().max(200_000).default(''),
});

export type AiProjectSummary = z.infer<typeof aiProjectSummarySchema>;
export type AiPage = z.infer<typeof aiPageSchema>;

export interface AiAssistantOptions {
  maxInputBytes?: number;
}

const DEFAULT_MAX_INPUT_BYTES = 512 * 1024;

function assertInputSize(prompt: string, maxInputBytes: number): void {
  const bytes = new TextEncoder().encode(prompt).length;
  if (bytes > maxInputBytes) {
    throw new RepoSiteError('AI_INPUT_TOO_LARGE', '提交给 AI 的内容超过大小上限。', { status: 413 });
  }
}

/** Generates the project overview content with strict schema validation. */
export async function generateProjectSummary(
  provider: AIProvider,
  context: PromptContext,
  language: GenerationLanguage,
  options: AiAssistantOptions = {},
): Promise<AiProjectSummary> {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildProjectPrompt(context, language);
  assertInputSize(userPrompt, maxInputBytes);

  const raw = await provider.generate({
    systemPrompt,
    userPrompt,
    config: { provider: provider.name, keyMode: 'server', language },
  });

  const parsed = aiProjectSummarySchema.safeParse(raw);
  if (!parsed.success) {
    throw new RepoSiteError('AI_INVALID_RESPONSE', 'AI 返回的内容未通过结构校验。', {
      status: 502,
      details: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join('.')),
    });
  }

  if (!matchesLanguage(parsed.data.summary, language)) {
    throw new RepoSiteError('AI_LANGUAGE_MISMATCH', 'AI 返回内容与所选语言不一致，请重试。', { status: 502 });
  }

  return parsed.data;
}

/** Generates a single documentation page with strict schema validation. */
export async function generatePage(
  provider: AIProvider,
  context: PromptContext & { pageTitle: string; pageSource: string },
  language: GenerationLanguage,
  options: AiAssistantOptions = {},
): Promise<AiPage> {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildPagePrompt(context, language);
  assertInputSize(userPrompt, maxInputBytes);

  const raw = await provider.generate({
    systemPrompt,
    userPrompt,
    config: { provider: provider.name, keyMode: 'server', language },
  });

  const parsed = aiPageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RepoSiteError('AI_INVALID_RESPONSE', 'AI 返回的内容未通过结构校验。', {
      status: 502,
      details: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join('.')),
    });
  }

  return parsed.data;
}

/**
 * Heuristic language check. Chinese content is expected to contain CJK characters,
 * English content is expected to be mostly ASCII letters.
 */
export function matchesLanguage(text: string, language: GenerationLanguage): boolean {
  if (!text || text.trim().length < 8) return true;
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (language === 'zh-CN') {
    return cjk > 0 || latin < 12;
  }
  return cjk / Math.max(1, latin) < 0.1;
}

/** Parses raw model output into JSON, tolerating markdown fences. */
export function parseModelJson(raw: string): unknown {
  try {
    return extractJson(raw);
  } catch (error) {
    throw new RepoSiteError(
      'AI_INVALID_RESPONSE',
      error instanceof Error ? error.message : 'AI 返回的不是有效 JSON。',
      { status: 502 },
    );
  }
}
