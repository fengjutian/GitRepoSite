import { describe, expect, it } from 'vitest';
import { GitHubClient, GITHUB_RAW_ORIGIN } from '@/lib/github/client';
import { RepoSiteError } from '@/lib/errors';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(
  responder: (url: string, call: RecordedCall) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return responder(call.url, call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const REF = { owner: 'owner', repo: 'repo' };
const SHA = 'a'.repeat(40);

describe('GitHubClient file reads', () => {
  it('reads files from the content host at the pinned commit', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const client = new GitHubClient({ fetchImpl });

    const bytes = await client.getFileBytes(REF, SHA, 'docs/中文 guide.md');

    expect(calls[0]!.url).toBe(`${GITHUB_RAW_ORIGIN}/owner/repo/${SHA}/docs/%E4%B8%AD%E6%96%87%20guide.md`);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('never sends the token to the content host', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(new Uint8Array([0]), { status: 200 }));
    const client = new GitHubClient({ fetchImpl, token: 'ghp_secret' });

    await client.getFileBytes(REF, SHA, 'README.md');

    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('falls back to the blob endpoint when the content host does not have the file', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.startsWith(GITHUB_RAW_ORIGIN)) return new Response('not found', { status: 404 });
      return new Response(
        JSON.stringify({ content: Buffer.from('from blob').toString('base64'), encoding: 'base64' }),
        { status: 200 },
      );
    });
    const client = new GitHubClient({ fetchImpl });

    const bytes = await client.getFileBytes(REF, SHA, 'missing.md', 'b'.repeat(40));

    expect(new TextDecoder().decode(bytes)).toBe('from blob');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain('/git/blobs/');
  });

  it('reports a missing file without a fallback as a 404 error', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('not found', { status: 404 }));
    const client = new GitHubClient({ fetchImpl });

    await expect(client.getFileBytes(REF, SHA, 'missing.md')).rejects.toMatchObject({
      code: 'GITHUB_ERROR',
      status: 404,
    });
  });
});

describe('GitHubClient API calls', () => {
  it('authenticates API calls with the configured token', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    const client = new GitHubClient({ fetchImpl, token: 'ghp_secret' });

    await client.getRepository({ owner: 'auth', repo: 'repo' });

    expect(calls[0]!.url).toBe('https://api.github.com/repos/auth/repo');
    expect(calls[0]!.headers.Authorization).toBe('Bearer ghp_secret');
  });

  it('serves a repeated read of the same repository from the cache', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ id: 7 }), { status: 200 }));
    const client = new GitHubClient({ fetchImpl });

    const first = await client.getRepository({ owner: 'cached', repo: 'repo' });
    const second = await client.getRepository({ owner: 'cached', repo: 'repo' });

    expect(calls).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('caches the file tree per commit', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      new Response(JSON.stringify({ tree: [{ path: 'README.md', sha: 'b'.repeat(40), type: 'blob' }] }), {
        status: 200,
      }),
    );
    const client = new GitHubClient({ fetchImpl });

    await client.getTree({ owner: 'tree', repo: 'repo' }, SHA);
    await client.getTree({ owner: 'tree', repo: 'repo' }, SHA);

    expect(calls).toHaveLength(1);
  });

  it('explains when the rate limit resets and how to avoid it', async () => {
    const reset = Math.floor(Date.now() / 1000) + 900;
    const { fetchImpl } = fakeFetch(
      () =>
        new Response('{}', {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-limit': '60',
            'x-ratelimit-reset': String(reset),
          },
        }),
    );
    const client = new GitHubClient({ fetchImpl });

    const error = await client.getRepository({ owner: 'limited', repo: 'repo' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RepoSiteError);
    const message = (error as RepoSiteError).message;
    expect((error as RepoSiteError).code).toBe('GITHUB_RATE_LIMIT');
    expect(message).toContain('60 次');
    expect(message).toContain('每小时');
    expect(message).toContain('GitHub Token');
    expect(message).toMatch(/配额将于 \d{2}:\d{2} 恢复/);
  });
});
