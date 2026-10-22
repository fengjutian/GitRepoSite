import { expect, test } from '@playwright/test';

/** Waits until the React island of the page is hydrated and interactive. */
async function waitForHydration(page: import('@playwright/test').Page) {
  await page.waitForSelector('astro-island:not([ssr])', { timeout: 15_000 });
}

test('the studio page renders the repository input', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('GitHub');
  await expect(page.getByPlaceholder(/github\.com/)).toBeVisible();
});

test('the project configuration page is reachable', async ({ page }) => {
  await page.goto('/project-config');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('项目配置');
  await expect(page.getByText('API Key 模式')).toBeVisible();
  await expect(page.locator('option[value="byok"]')).toHaveText('使用我自己的 Key');
});

test('invalid repository URLs are rejected before any request', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  const input = page.getByPlaceholder(/github\.com/);
  await input.fill('https://gitlab.com/owner/repo');
  const button = page.getByRole('button', { name: /读取仓库/ }).first();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText(/仅支持 github\.com/)).toBeVisible();
});

test('the API key is never written into the local storage', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.getByLabel(/API Key 模式/).selectOption('byok');
  await page.getByPlaceholder('sk-...').fill('sk-test-key-1234567890');
  const storage = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(storage).not.toContain('sk-test-key-1234567890');
});
