import { expect, it } from 'vitest';
import { renderMarkdown } from '@/lib/content/markdown';

it('debug heading ids', async () => {
  const result = await renderMarkdown('# Title\n\n## Install\n', { highlight: false });
  console.log(JSON.stringify(result.headings));
  console.log(result.html);
  expect(result.html).toBeTruthy();
});
