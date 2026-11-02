import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

it('shares session bootstrap and waits for it before sending controls', async () => {
  let ready!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { ready = resolve; })).mockImplementation(async () => ok());
  vi.stubGlobal('fetch', fetch);
  const { post } = await import('../../dashboard/src/socket.js');
  const first = post('/api/demo/reset', {}), second = post('/api/mode', { mode: 'observe' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('/api/session');
  ready(ok()); await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('recovers controls after a server restart invalidates the local cookie', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response('{}', { status: 403 }))
    .mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
  vi.stubGlobal('fetch', fetch);
  const { post } = await import('../../dashboard/src/socket.js');
  await expect(post('/api/demo/reset', {})).resolves.toEqual({ ok: true });
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/session', '/api/demo/reset', '/api/session', '/api/demo/reset']);
});

it('retries only once and surfaces an ongoing session error', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response('{}', { status: 403 }))
    .mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response('{"error":"Local session required"}', { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const { post } = await import('../../dashboard/src/socket.js');
  await expect(post('/api/demo/reset', {})).rejects.toThrow('Local session required');
  expect(fetch).toHaveBeenCalledTimes(4);
});
