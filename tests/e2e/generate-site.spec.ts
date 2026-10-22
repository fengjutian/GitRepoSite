import { expect, test } from '@playwright/test';
import JSZip from 'jszip';

const SHA = 'a'.repeat(40);
const README = '# Demo Project\n\nDemo readme with an image.\n\n![logo](assets/logo.png)\n\nSee the [guide](docs/guide.md).\n';
const GUIDE = '# Guide\n\nHow to use the demo project.\n';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const BLOB_SHA: Record<string, string> = {
  ['b'.repeat(40)]: Buffer.from(README, 'utf-8').toString('base64'),
  ['c'.repeat(40)]: Buffer.from(GUIDE, 'utf-8').toString('base64'),
  ['d'.repeat(40)]: PNG_BASE64,
};

async function mockGitHub(page: import('@playwright/test').Page) {
  const stats = { contentReads: 0, blobReads: 0 };

  // File content is read from the content host, which is not metered against
  // the REST API quota. The blob endpoint stays mocked as the fallback path.
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    const url = new URL(route.request().url());
    const marker = `/${SHA}/`;
    const index = url.pathname.indexOf(marker);
    if (index === -1) return route.fulfill({ status: 404, body: 'Not Found' });
    const filePath = decodeURIComponent(url.pathname.slice(index + marker.length));
    stats.contentReads += 1;
    if (filePath === 'assets/logo.png') {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(PNG_BASE64, 'base64'),
      });
    }
    const text =
      filePath === 'README.md' ? README : filePath === 'docs/guide.md' ? GUIDE : undefined;
    if (text === undefined) return route.fulfill({ status: 404, body: 'Not Found' });
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: text });
  });

  await page.route('https://api.github.com/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/repos/demo/demo-docs') {
      return route.fulfill({
        json: {
          id: 1,
          name: 'demo-docs',
          full_name: 'demo/demo-docs',
          description: 'A demo repository',
          html_url: 'https://github.com/demo/demo-docs',
          homepage: null,
          default_branch: 'main',
          language: 'TypeScript',
          topics: ['demo'],
          stargazers_count: 3,
          license: null,
          archived: false,
        },
      });
    }
    if (path.endsWith('/commits/HEAD')) {
      return route.fulfill({ json: { sha: SHA } });
    }
    if (path.includes('/git/trees/')) {
      return route.fulfill({
        json: {
          truncated: false,
          tree: [
            { path: 'README.md', mode: '100644', type: 'blob', size: README.length, sha: 'b'.repeat(40) },
            { path: 'docs/guide.md', mode: '100644', type: 'blob', size: GUIDE.length, sha: 'c'.repeat(40) },
            { path: 'assets/logo.png', mode: '100644', type: 'blob', size: 68, sha: 'd'.repeat(40) },
          ],
        },
      });
    }
    const blob = path.match(/\/git\/blobs\/([0-9a-f]{40})$/);
    if (blob) {
      stats.blobReads += 1;
      const content = BLOB_SHA[blob[1]!];
      if (!content) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
      return route.fulfill({ json: { content, encoding: 'base64' } });
    }
    return route.fulfill({ status: 404, json: { message: 'Not Found' } });
  });

  return stats;
}

test('loads a repository, requires a license confirmation and exports a ZIP', async ({ page }) => {
  const stats = await mockGitHub(page);
  await page.goto('/');
  await page.waitForSelector('astro-island:not([ssr])');

  await page.getByPlaceholder(/github\.com/).fill('https://github.com/demo/demo-docs');
  const loadButton = page.getByRole('button', { name: /读取仓库/ }).first();
  await expect(loadButton).toBeEnabled();
  await loadButton.click();

  // The repository content comes from the content host, not from the REST API.
  await expect.poll(() => stats.contentReads).toBeGreaterThanOrEqual(3);
  expect(stats.blobReads).toBe(0);

  // The README becomes the first document of the generated site.
  await expect(page.getByRole('button', { name: /Demo Project/ })).toBeVisible();
  await expect(page.getByText('仓库中未发现 LICENSE 文件')).toBeVisible();

  // Without an explicit confirmation the export stays disabled.
  const exportButton = page.getByRole('button', { name: /生成并下载 ZIP/ });
  await expect(exportButton).toBeDisabled();

  await page.getByText('我确认有权使用并发布该仓库内容').click();
  await expect(exportButton).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const names = Object.keys(zip.files);

  expect(names).toContain('index.html');
  expect(names).toContain('llms.txt');
  expect(names).toContain('sitemap.xml');
  expect(names).toContain('docs/readme.html');
  expect(names.some((name) => name.startsWith('assets/images/'))).toBe(true);

  for (const name of names) {
    if (zip.files[name]!.dir) continue;
    const content = await zip.files[name]!.async('string');
    expect(content).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(content).not.toContain('DEEPSEEK_API_KEY');
    expect(content).not.toContain('MINIMAX_API_KEY');
  }
});
