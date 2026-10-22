import { expect, test } from '@playwright/test';

test('the studio page renders the repository input', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('GitHub');
  await expect(page.getByPlaceholder(/github\.com/)).toBeVisible();
});

test('the project configuration page is reachable', async ({ page }) => {
  await page.goto('/project-config');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('项目配置');
  await expect(page.getByText(/BYOK/)).toBeVisible();
});

test('invalid repository URLs are rejected before any request', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder(/github\.com/).fill('https://gitlab.com/owner/repo');
  await page.getByRole('button', { name: /读取仓库|加载/ }).first().click();
  await expect(page.getByText(/仅支持 github\.com/)).toBeVisible();
});
