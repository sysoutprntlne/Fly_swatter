// Verify the built release through real HTTP and WebSocket connections, without credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['scripts/demo.mjs', '--port', String(port)], {
  cwd: new URL('..', import.meta.url), stdio: 'ignore',
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'silent',
    TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', OPENAI_API_KEY: '',
    TWITCH_REDIRECT_URI: `${origin}/auth/callback`, DEFAULT_MODE: 'observe', DEMO_MODE: 'true',
    SWAT_ALL_GUESSES: 'false', PREFILTER_THRESHOLD: '0.35', TRIANGULATION_WINDOW_MS: '300000', SWARM_MIN_USERS: '3', SWARM_MIN_SCORE: '3' },
});
const exited = once(child, 'exit');
let socket;
async function get(path) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200, path);
  return response;
}
async function until(read, accept, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  await until(async () => {
    if (child.exitCode !== null) throw new Error('Built server exited before startup');
    return fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false);
  }, Boolean, 'server startup', 10000);
  const html = await (await get('/')).text();
  assert.match(html, /<div id="root">/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
  assert(assets.length >= 2, 'Built JS and CSS must be present');
  for (const path of assets) await get(path);
  const session = await get('/api/session');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  async function post(path, body) {
    const response = await fetch(`${origin}${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
      body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200, path); return response.json();
  }
  const state = async () => (await get('/api/state')).json();
  const frames = [];
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
  socket.on('message', data => frames.push(JSON.parse(String(data))));
  await until(async () => frames, values => values.some(f => f.type === 'snapshot'), 'dashboard socket');
  assert.equal((await state()).pipeline.mode, 'observe');
  const auth = await (await get('/auth/status')).json();
  assert.equal(auth.configured, false, 'Demo launcher must disable Twitch credentials');
  assert.equal(auth.connected, false, 'Demo launcher must not reuse a saved login');
  assert.equal((await state()).pipeline.ai.enabled, false, 'Demo launcher must disable paid AI calls');
  await post('/api/mode', { mode: 'guardian' });
  await post('/api/demo/play', { name: 'IRL triangulation', speed: 2 });
  const swarm = await until(state, s => !s.demo.playing && s.pipeline.risk.level === 'swarm', 'IRL scenario');
  assert(swarm.pipeline.clusters.some(c => c.isSwarm));
  assert(swarm.pipeline.actions.some(a => a.kind === 'delete_message'));
  assert(swarm.pipeline.actions.some(a => a.kind === 'shield_mode_on'));
  assert(swarm.pipeline.actions.every(a => a.dryRun || a.kind === 'private_alert'));
  assert(frames.some(f => f.type === 'risk.updated' && f.payload.level === 'swarm'));
  const flagged = swarm.pipeline.flagged[0];
  await post('/api/review', { messageId: flagged.message.id, verdict: 'right' });
  assert.equal((await state()).pipeline.reviews[0].verdict, 'right');
  await post('/api/demo/reset', {});
  const reset = await state();
  assert.equal(reset.pipeline.risk.score, 0);
  assert.equal(reset.pipeline.actions.length, 0);
  assert.equal(reset.pipeline.reviews.length, 0);
  await post('/api/demo/play', { name: 'False positive check', speed: 2 });
  const benign = await until(state, s => !s.demo.playing, 'benign scenario');
  assert(['quiet', 'few_flies'].includes(benign.pipeline.risk.level));
  assert(!benign.pipeline.clusters.some(c => c.isSwarm));
  const denied = await fetch(`${origin}/api/mode`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.com', Cookie: cookie },
    body: JSON.stringify({ mode: 'assist' }), signal: AbortSignal.timeout(2000) });
  assert.equal(denied.status, 403);
  console.log('Release smoke passed: built assets, HTTP, WebSocket, swarm, dry-run protection, review, reset, benign scenario, origin checks.');
} finally {
  socket?.terminate();
  child.kill('SIGTERM');
  const killed = await Promise.race([exited.then(() => true), delay(3000).then(() => false)]);
  if (!killed) { child.kill('SIGKILL'); await exited; }
}
