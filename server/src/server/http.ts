import Fastify, { LogController } from 'fastify';
import type { EventSub } from '../twitch/eventsub.js';
import type { Bus } from '../bus.js';
import { injectSchema, type Simulator } from '../demo/simulator.js';
import type { Pipeline } from '../pipeline/index.js';
import { z } from 'zod';
import { attachDashboardSocket } from './dashboardSocket.js';
import staticFiles from '@fastify/static';
import cookie from '@fastify/cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SignInError, TwitchAuth } from '../twitch/auth.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { configWarnings, projectRoot, type Config } from '../config.js';
import { createLogger } from '../logger.js';
import type { ChatSnapshot } from '../types.js';

export async function createApp(config: Config, auth = new TwitchAuth(config), chat?: { receiver: EventSub; bus: Bus; simulator?: Simulator; pipeline?: Pipeline }) {
  const app = Fastify({ loggerInstance: createLogger(config.LOG_LEVEL), logController: new LogController({ disableRequestLogging: true }), bodyLimit: 16_384 });
  await app.register(cookie);
  const sessionSecret = randomBytes(32).toString('hex');
  const authOrigin = new URL(config.TWITCH_REDIRECT_URI).origin;
  const origins = new Set([`http://localhost:${config.PORT}`, `http://127.0.0.1:${config.PORT}`, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  const hosts = new Set([`localhost:${config.PORT}`, `127.0.0.1:${config.PORT}`]);
  app.addHook('onRequest', async (req, reply) => {
    if (!hosts.has(req.headers.host ?? '')) return reply.code(403).send({ error: 'Local access only' });
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return reply.code(403).send({ error: 'Origin not allowed' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const session = req.cookies.fly_session ?? '';
      if (!origin || session.length !== sessionSecret.length || !timingSafeEqual(Buffer.from(session), Buffer.from(sessionSecret))) {
        return reply.code(403).send({ error: 'Local session required' });
      }
    }
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });
  const snapshot = (): ChatSnapshot => {
    const live = chat?.receiver.snapshot() ?? { status: { state: 'waiting' as const, message: 'Chat receiver not enabled.' }, messages: [] };
    const demo = chat?.simulator?.snapshot();
    const pipeline = chat?.pipeline?.snapshot();
    return { ...live, ...(demo ? { messages: [...live.messages, ...demo.messages], demo: demo.state } : {}), ...(pipeline ? { pipeline } : {}) };
  };
  // Demo mode must work without Twitch, so the dashboard obtains its CSRF cookie here rather than only after OAuth.
  // SameSite=strict plus the Origin check above keep other sites from using it.
  app.get('/api/session', async (_req, reply) => { reply.setCookie('fly_session', sessionSecret, { httpOnly: true, sameSite: 'strict', path: '/' }); return { ok: true }; });
  app.get('/api/health', async () => ({ ok: true, milestone: chat?.pipeline ? 'M7' : chat?.simulator ? 'M4' : chat ? 'M3' : 'M2', mode: chat?.pipeline?.mode() ?? 'observe', warnings: configWarnings(config), mascotName: config.MASCOT_NAME, swarmMinUsers: config.SWARM_MIN_USERS, swarmMinScore: config.SWARM_MIN_SCORE, loginUrl: `${new URL(config.TWITCH_REDIRECT_URI).origin}/auth/login` }));
  app.get('/api/state', async () => ({ mode: chat?.pipeline?.mode() ?? 'observe', ...snapshot() }));
  const pipeline = chat?.pipeline;
  if (pipeline) {
    app.post('/api/mode', async (req, reply) => {
      const body = z.object({ mode: z.enum(['observe', 'assist', 'guardian']) }).strict().safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Mode must be observe, assist or guardian.' });
      pipeline.setMode(body.data.mode); return { mode: pipeline.mode() };
    });
    app.post('/api/settings', async (req, reply) => {
      const body = z.object({ swatAllGuesses: z.boolean() }).strict().safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Send { swatAllGuesses: true | false }.' });
      pipeline.setSwatAllGuesses(body.data.swatAllGuesses); return pipeline.snapshot().settings;
    });
    app.post('/api/shield', async (req, reply) => {
      const body = z.object({ active: z.boolean() }).strict().safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Send { active: true | false }.' });
      const record = await pipeline.setShield(body.data.active);
      if (record && !record.success) return reply.code(502).send({ error: record.error ?? 'Shield Mode change failed.' });
      return record ?? { ok: true };
    });
    // Mods check the model's calls. Verdicts live in memory for this session only.
    const categories = ['location_question', 'location_guess', 'location_confirmation', 'location_share', 'approach_intent', 'swat_or_threat', 'benign'] as const;
    app.post('/api/review', async (req, reply) => {
      const body = z.object({ messageId: z.string().min(1).max(200), verdict: z.enum(['right', 'wrong']).nullable(), shouldBe: z.enum(categories).optional() }).strict().safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Send { messageId, verdict: "right" | "wrong" | null, shouldBe? }.' });
      if (!pipeline.review(body.data.messageId, body.data.verdict, body.data.shouldBe)) return reply.code(404).send({ error: 'That message is no longer in the flagged list.' });
      return { ok: true };
    });
  }
  const simulator = chat?.simulator;
  if (simulator) {
    const bad = (reply: import('fastify').FastifyReply, error: string) => reply.code(400).send({ error });
    const playBody = z.object({ name: z.string().max(80), speed: z.union([z.literal(0.5), z.literal(1), z.literal(2)]).default(1) }).strict();
    app.get('/api/demo/scenarios', async () => ({ scenarios: simulator.list(), state: simulator.snapshot().state }));
    app.post('/api/demo/mode', async (req, reply) => {
      const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
      if (!body.success) return bad(reply, 'Send { enabled: true | false }.');
      simulator.setEnabled(body.data.enabled); return simulator.snapshot().state;
    });
    app.post('/api/demo/play', async (req, reply) => {
      const body = playBody.safeParse(req.body);
      if (!body.success) return bad(reply, 'Choose a scenario and a speed of 0.5, 1 or 2.');
      if (!simulator.play(body.data.name, body.data.speed)) return reply.code(409).send({ error: 'Turn on demo mode and pick a listed scenario.' });
      return simulator.snapshot().state;
    });
    app.post('/api/demo/pause', async () => { simulator.pause(); return simulator.snapshot().state; });
    app.post('/api/demo/reset', async () => { simulator.reset(); return simulator.snapshot().state; });
    app.post('/api/demo/inject', async (req, reply) => {
      const body = injectSchema.safeParse(req.body);
      if (!body.success) return bad(reply, 'Use a username of letters, numbers or underscores and a message of 1–500 characters.');
      const message = simulator.inject(body.data.user, body.data.text);
      return message ? { id: message.id } : reply.code(409).send({ error: 'Turn on demo mode first.' });
    });
  }
  app.get('/auth/status', async () => auth.status());
  app.get('/auth/login', async (req, reply) => {
    // Cookies are host-specific: establish them on the callback host.
    if (req.headers.host !== new URL(authOrigin).host) return reply.redirect(`${authOrigin}/auth/login`);
    if (!auth.status().configured) return reply.code(503).send({ error: configWarnings(config)[0] });
    const { state, url } = auth.beginLogin();
    reply.setCookie(`fly_oauth_${state}`, state, { httpOnly: true, sameSite: 'lax', path: '/auth', maxAge: 600 });
    return reply.redirect(url);
  });
  app.get('/auth/callback', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const state = typeof query.state === 'string' ? query.state : '';
    const retry = (error: string) => reply.code(400).send({ error, restartUrl: `${authOrigin}/auth/login` });
    if (!/^[a-f0-9]{64}$/.test(state)) return retry('Login state is missing or malformed. Start a new sign-in from the dashboard.');
    const cookieName = `fly_oauth_${state}`;
    const cookieState = req.cookies[cookieName] ?? '';
    if (!cookieState) return retry('The login cookie is missing. Start sign-in and complete it in the same browser, with cookies enabled for localhost.');
    if (!/^[a-f0-9]{64}$/.test(cookieState) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
      return retry('The login cookie does not match this attempt. Start a new sign-in from the dashboard.');
    }
    reply.clearCookie(cookieName, { path: '/auth' });
    if (!auth.consumeState(state)) {
      return retry('This login attempt expired, was already used, or the server restarted. Start a new sign-in from the dashboard.');
    }
    if (query.error || typeof query.code !== 'string' || !query.code || query.code.length > 2048) {
      return reply.code(400).send({ error: 'Twitch authorization was not completed. Start sign-in again.' });
    }
    try {
      await auth.exchange(query.code);
      reply.setCookie('fly_session', sessionSecret, { httpOnly: true, sameSite: 'strict', path: '/' });
      return reply.redirect('/');
    } catch (error) { return reply.code(502).send({ error: error instanceof SignInError ? error.message : 'Twitch sign-in failed. Please try connecting again.' }); }
  });
  app.post('/auth/revalidate', async () => { await auth.validate(); return auth.status(); });
  const closeSocket = chat ? attachDashboardSocket(app.server, chat.bus, snapshot, config.PORT) : undefined;
  app.addHook('onReady', async () => { await auth.start(); chat?.receiver.start(); });
  app.addHook('preClose', async () => { chat?.receiver.stop(); chat?.simulator?.stop(); await closeSocket?.(); });
  app.addHook('onClose', async () => { auth.stop(); });
  const root = resolve(projectRoot, 'dashboard/dist');
  if (existsSync(resolve(root, 'index.html'))) {
    await app.register(staticFiles, { root, index: 'index.html' });
  } else {
    app.get('/', async (_req, reply) => reply.type('text/html').send('<!doctype html><html lang="en"><title>Fly Swatter</title><h1>Fly Swatter</h1><p>Setup is running. Open the Vite dashboard at <a href="http://localhost:5173">localhost:5173</a>, or run npm run build to serve it here.</p></html>'));
  }
  app.setErrorHandler((_error, _req, reply) => { app.log.error('Request failed'); void reply.code(500).send({ error: 'Request failed. Please retry.' }); });
  return app;
}
