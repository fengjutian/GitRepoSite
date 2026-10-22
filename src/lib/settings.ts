import { z } from 'zod';

export const localSettingsSchema = z.object({
  preferredProvider: z.enum(['deepseek', 'minimax']).default('deepseek'),
  preferredKeyMode: z.enum(['server', 'byok']).default('server'),
  targetLanguage: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  downloadExternalImages: z.boolean().default(false),
  preferredTheme: z.enum(['light', 'dark', 'system']).optional(),
});

export type LocalSettings = z.infer<typeof localSettingsSchema>;

export const SETTINGS_STORAGE_KEY = 'reposite.settings';

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Loads the non-sensitive preferences. API keys are never stored here. */
export function loadSettings(storage?: Storage): LocalSettings {
  const store = storage ?? (isBrowser() ? window.localStorage : undefined);
  if (!store) return localSettingsSchema.parse({});
  try {
    const raw = store.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return localSettingsSchema.parse({});
    const parsed = localSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : localSettingsSchema.parse({});
  } catch {
    return localSettingsSchema.parse({});
  }
}

export function saveSettings(settings: LocalSettings, storage?: Storage): void {
  const store = storage ?? (isBrowser() ? window.localStorage : undefined);
  if (!store) return;
  const safe = localSettingsSchema.parse(settings);
  store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(safe));
}

export function clearSettings(storage?: Storage): void {
  const store = storage ?? (isBrowser() ? window.localStorage : undefined);
  if (!store) return;
  store.removeItem(SETTINGS_STORAGE_KEY);
}

/** Guards against accidental persistence of API keys. */
export function assertNoSecrets(settings: Record<string, unknown>): void {
  const forbidden = ['apikey', 'authorization', 'token', 'secret'];
  for (const key of Object.keys(settings)) {
    if (forbidden.some((name) => key.toLowerCase().includes(name))) {
      throw new Error(`本地配置不得包含敏感字段: ${key}`);
    }
  }
}
