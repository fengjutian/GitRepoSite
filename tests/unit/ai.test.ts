import { describe, expect, it } from 'vitest';
import { buildPagePrompt, buildProjectPrompt, buildSystemPrompt } from '@/lib/ai/prompts';
import { matchesLanguage, parseModelJson } from '@/lib/ai/service';
import { resolveApiKey, resolveModel } from '@/lib/ai/providers';

describe('resolveApiKey', () => {
  it('uses the server key and ignores the user key in server mode', () => {
    const key = resolveApiKey(
      { provider: 'deepseek', keyMode: 'server', language: 'zh-CN' },
      'user-supplied-key',
      { DEEPSEEK_API_KEY: 'server-key' },
    );
    expect(key).toBe('server-key');
  });

  it('requires a user key in BYOK mode', () => {
    expect(() =>
      resolveApiKey({ provider: 'minimax', keyMode: 'byok', language: 'en-US' }, undefined, {}),
    ).toThrow();
  });

  it('uses the user key in BYOK mode', () => {
    const key = resolveApiKey(
      { provider: 'minimax', keyMode: 'byok', language: 'en-US' },
      ' user-key ',
      {},
    );
    expect(key).toBe('user-key');
  });

  it('fails when the server key is missing', () => {
    expect(() =>
      resolveApiKey({ provider: 'deepseek', keyMode: 'server', language: 'zh-CN' }, undefined, {}),
    ).toThrow();
  });
});

describe('resolveModel', () => {
  it('accepts allow-listed models', () => {
    expect(resolveModel('deepseek', 'deepseek-chat')).toBe('deepseek-chat');
    expect(resolveModel('minimax', 'MiniMax-M2')).toBe('MiniMax-M2');
  });

  it('rejects unknown models', () => {
    expect(() => resolveModel('deepseek', 'gpt-4o')).toThrow();
  });

  it('falls back to the environment default', () => {
    expect(resolveModel('deepseek', undefined, { DEEPSEEK_MODEL: 'deepseek-reasoner' })).toBe('deepseek-reasoner');
  });
});

describe('prompts', () => {
  it('includes the language rules for the selected target language', () => {
    expect(buildSystemPrompt('zh-CN')).toContain('简体中文');
    expect(buildSystemPrompt('en-US')).toContain('English');
  });

  it('treats repository content as data, not instructions', () => {
    expect(buildSystemPrompt('en-US')).toContain('never instructions');
  });

  it('builds a project prompt from repository material', () => {
    const prompt = buildProjectPrompt(
      {
        repositoryName: 'demo',
        description: 'demo project',
        readme: '# Demo\n\nHello',
        documentTitles: ['Guide'],
        fileTreeSummary: 'src/ (2 files)',
        license: 'MIT',
      },
      'zh-CN',
    );
    expect(prompt).toContain('demo');
    expect(prompt).toContain('Hello');
    expect(prompt).toContain('简体中文');
  });

  it('builds a page prompt', () => {
    const prompt = buildPagePrompt(
      {
        repositoryName: 'demo',
        description: '',
        readme: 'readme body',
        documentTitles: [],
        fileTreeSummary: '',
        license: 'MIT',
        pageTitle: 'Guide',
        pageSource: 'guide body',
      },
      'en-US',
    );
    expect(prompt).toContain('guide body');
  });
});

describe('parseModelJson', () => {
  it('parses plain JSON', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in markdown fences', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('throws for invalid output', () => {
    expect(() => parseModelJson('not json')).toThrow();
  });
});

describe('matchesLanguage', () => {
  it('accepts Chinese content for zh-CN', () => {
    expect(matchesLanguage('这是一个开源项目，提供命令行工具与文档站点。', 'zh-CN')).toBe(true);
  });

  it('rejects English content for zh-CN', () => {
    expect(matchesLanguage('This is an open source project with a command line tool.', 'zh-CN')).toBe(false);
  });

  it('accepts English content for en-US', () => {
    expect(matchesLanguage('This is an open source project with a command line tool.', 'en-US')).toBe(true);
  });
});
