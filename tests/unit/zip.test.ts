import { describe, expect, it } from 'vitest';
import { packageSite, scanForSecrets } from '@/lib/export/zip';
import { assertNoSecrets, clearSettings, loadSettings, saveSettings } from '@/lib/settings';

describe('scanForSecrets', () => {
  it('detects common API key patterns', () => {
    const findings = scanForSecrets([
      { path: 'index.html', content: 'const key = "sk-abcdefghijklmnopqrstuvwxyz0123";' },
    ]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('ignores normal content', () => {
    expect(scanForSecrets([{ path: 'index.html', content: '<h1>Hello</h1>' }])).toHaveLength(0);
  });
});

describe('packageSite', () => {
  it('packages the generated files', async () => {
    const result = await packageSite([
      { path: 'index.html', content: '<h1>hi</h1>' },
      { path: 'assets/css/site.css', content: 'body{}' },
    ]);
    expect(result.fileCount).toBe(2);
    expect(result.fileNames).toContain('index.html');
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it('refuses to package files that look like secrets', async () => {
    await expect(
      packageSite([{ path: 'index.html', content: 'DEEPSEEK_API_KEY=abcd1234' }]),
    ).rejects.toThrow();
  });
});

describe('local settings', () => {
  function fakeStorage(): Storage {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => [...map.keys()][index] ?? null,
      removeItem: (key: string) => void map.delete(key),
      setItem: (key: string, value: string) => void map.set(key, value),
    } as Storage;
  }

  it('round trips non sensitive preferences', () => {
    const storage = fakeStorage();
    saveSettings(
      {
        preferredProvider: 'minimax',
        preferredKeyMode: 'byok',
        targetLanguage: 'en-US',
        downloadExternalImages: true,
      },
      storage,
    );
    const loaded = loadSettings(storage);
    expect(loaded.preferredProvider).toBe('minimax');
    expect(loaded.targetLanguage).toBe('en-US');
    expect(loaded.downloadExternalImages).toBe(true);
  });

  it('never persists API keys', () => {
    expect(() => assertNoSecrets({ apiKey: 'x' })).toThrow();
    expect(() => assertNoSecrets({ preferredProvider: 'deepseek' })).not.toThrow();
  });

  it('can clear the stored configuration', () => {
    const storage = fakeStorage();
    saveSettings(
      {
        preferredProvider: 'deepseek',
        preferredKeyMode: 'server',
        targetLanguage: 'zh-CN',
        downloadExternalImages: false,
      },
      storage,
    );
    clearSettings(storage);
    expect(storage.getItem('reposite.settings')).toBeNull();
  });
});
