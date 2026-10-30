import { expect, it } from 'vitest';
import { createApp } from '../src/server/http.js';
import { parseConfig } from '../src/config.js';
it('serves health and a dashboard without allowing DNS rebinding hosts', async () => {
  const app = await createApp(parseConfig({ LOG_LEVEL: 'silent' }));
  try {
    const health = await app.inject({ url: '/api/health', headers: { host: 'localhost:3000' } });
    expect(health.statusCode).toBe(200); expect(health.json().mode).toBe('observe');
    expect((await app.inject({ url: '/', headers: { host: 'localhost:3000' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/health', headers: { host: 'attacker.test:3000' } })).statusCode).toBe(403);
    expect(health.headers['cache-control']).toBe('no-store');
  } finally { await app.close(); }
});
