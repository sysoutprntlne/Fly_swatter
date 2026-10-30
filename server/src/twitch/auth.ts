import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ChatSession } from '../types.js';
import { moderationScopes, projectRoot, readScopes, twitchScopes, type Config } from '../config.js';

const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expiresIn: z.number().nonnegative(), obtainedAt: z.number().nonnegative() });
const exchangeSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().nonnegative(), token_type: z.string() });
// A no-permission login may omit the scope list. Treat that as zero grants;
// getChatSession refuses access whenever an enabled feature requires a missing scope.
const identitySchema = z.object({ client_id: z.string(), user_id: z.string().min(1), login: z.string().min(1), scopes: z.array(z.string()).nullish().transform(scopes => scopes ?? []), expires_in: z.number().nonnegative() });
type Tokens = z.infer<typeof tokenSchema>;
export interface AuthStatus { configured: boolean; connected: boolean; chatAuthorized: boolean; moderationAuthorized: boolean; login?: string; broadcasterId?: string; message: string }
export interface TokenStore { load(): Promise<Tokens | undefined>; save(tokens: Tokens): Promise<void>; clear(): Promise<void> }
export class FileTokenStore implements TokenStore {
  constructor(private path = resolve(projectRoot, '.tokens.json')) {}
  async load() {
    try { await chmod(this.path, 0o600); return tokenSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('Stored token unavailable'); }
  }
  async save(tokens: Tokens) {
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}`;
    try {
      await writeFile(temporary, JSON.stringify(tokens), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }
  async clear() { await rm(this.path, { force: true }); }
}
class Unauthorized extends Error {}
class TwitchHttpError extends Error {
  constructor(readonly status: number) { super('Twitch request failed'); }
}
export class SignInError extends Error {}
export class TwitchAuth {
  private tokens?: Tokens;
  private identity?: z.infer<typeof identitySchema>;
  private message = 'Connect your broadcaster account.';
  private pending = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private refreshPromise?: Promise<void>;
  private validationPromise?: Promise<void>;
  constructor(private config: Config, private store: TokenStore = new FileTokenStore(), private request: typeof fetch = fetch, private now: () => number = Date.now) {}
  status(): AuthStatus {
    return { configured: Boolean(this.config.TWITCH_CLIENT_ID && this.config.TWITCH_CLIENT_SECRET), connected: Boolean(this.identity), chatAuthorized: Boolean(this.getChatSession()), moderationAuthorized: Boolean(this.getModerationSession()), ...(this.identity ? { login: this.identity.login, broadcasterId: this.identity.user_id } : {}), message: this.message };
  }
  getChatSession(): ChatSession | undefined {
    if (!this.tokens || !this.identity || !readScopes.every(scope => this.identity!.scopes.includes(scope))) return undefined;
    return { accessToken: this.tokens.access_token, broadcasterId: this.identity.user_id };
  }
  // Moderation actions additionally require every moderation scope.
  getModerationSession(): ChatSession | undefined {
    const session = this.getChatSession();
    return session && moderationScopes.every(scope => this.identity!.scopes.includes(scope)) ? session : undefined;
  }
  beginLogin() {
    if (!this.status().configured) throw new Error('Twitch credentials missing');
    for (const [state, expires] of this.pending) if (expires <= this.now()) this.pending.delete(state);
    if (this.pending.size >= 50) this.pending.delete(this.pending.keys().next().value!);
    const state = randomBytes(32).toString('hex');
    this.pending.set(state, this.now() + 600_000);
    const query = new URLSearchParams({ client_id: this.config.TWITCH_CLIENT_ID, redirect_uri: this.config.TWITCH_REDIRECT_URI, response_type: 'code', state });
    if (twitchScopes.length) query.set('scope', twitchScopes.join(' '));
    return { state, url: `https://id.twitch.tv/oauth2/authorize?${query}` };
  }
  consumeState(state: string) {
    const expires = this.pending.get(state);
    this.pending.delete(state);
    return expires !== undefined && expires > this.now();
  }
  async exchange(code: string) {
    // Discard the old session before accepting a new identity.
    this.identity = undefined;
    this.tokens = undefined;
    let stage = 'token exchange';
    try {
      const tokens = await this.postToken({ grant_type: 'authorization_code', code, redirect_uri: this.config.TWITCH_REDIRECT_URI });
      stage = 'account validation';
      const identity = await this.validateToken(tokens.access_token);
      stage = 'local token storage';
      await this.store.save(tokens);
      this.tokens = tokens; this.identity = identity; this.message = 'Broadcaster connected.';
    } catch (error) {
      await this.invalidate();
      let detail = '';
      if (error instanceof TwitchHttpError) detail = ` (HTTP ${error.status})`;
      else if (error instanceof z.ZodError) {
        const safeFields = ['access_token', 'refresh_token', 'expires_in', 'token_type', 'client_id', 'user_id', 'login', 'scopes'];
        const fields = [...new Set(error.issues.map(issue => String(issue.path[0])).filter(field => safeFields.includes(field)))];
        detail = ` (unexpected response fields: ${fields.join(', ') || 'response'})`;
      } else if (error instanceof Unauthorized) detail = ' (account or app identity could not be verified)';
      else if (error instanceof Error && ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)) detail = ' (connection failed or timed out)';
      this.message = `Twitch sign-in failed during ${stage}${detail}. Start a new sign-in from the dashboard.`;
      throw new SignInError(this.message);
    }
  }
  async start() {
    if (!this.status().configured) return;
    try { this.tokens = await this.store.load(); if (this.tokens) await this.validate(); }
    catch { await this.invalidate(); }
    this.timer = setInterval(() => { void this.validate(); }, 3_600_000);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.pending.clear(); }
  private async validateToken(token: string) {
    const response = await this.request('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(8_000) });
    if (response.status === 401) throw new Unauthorized();
    if (!response.ok) throw new TwitchHttpError(response.status);
    const identity = identitySchema.parse(await response.json());
    if (identity.client_id !== this.config.TWITCH_CLIENT_ID) throw new Unauthorized();
    return identity;
  }
  async validate(): Promise<void> {
    if (this.validationPromise) return this.validationPromise;
    this.validationPromise = this.performValidation().finally(() => { this.validationPromise = undefined; });
    return this.validationPromise;
  }
  private async performValidation() {
    if (!this.tokens) return;
    try {
      this.identity = await this.validateToken(this.tokens.access_token);
      this.message = 'Broadcaster connected.';
    } catch (error) {
      this.identity = undefined;
      if (error instanceof Unauthorized) { try { await this.refresh(); } catch { /* refresh has cleared session */ } }
      else this.message = 'Twitch validation unavailable. Monitoring is disabled; retry or reconnect.';
    }
  }
  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }
  private async performRefresh() {
    try {
      if (!this.tokens) throw new Unauthorized();
      const tokens = await this.postToken({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token });
      const identity = await this.validateToken(tokens.access_token);
      // A refresh must never silently switch the authenticated channel.
      if (this.identity && identity.user_id !== this.identity.user_id) throw new Unauthorized();
      await this.store.save(tokens);
      this.tokens = tokens; this.identity = identity; this.message = 'Broadcaster connected.';
    } catch {
      await this.invalidate();
      throw new Error('Re-login required');
    }
  }
  private async postToken(fields: Record<string, string>): Promise<Tokens> {
    const body = new URLSearchParams({ ...fields, client_id: this.config.TWITCH_CLIENT_ID, client_secret: this.config.TWITCH_CLIENT_SECRET });
    const response = await this.request('https://id.twitch.tv/oauth2/token', { method: 'POST', body, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new TwitchHttpError(response.status);
    const token = exchangeSchema.parse(await response.json());
    return { access_token: token.access_token, refresh_token: token.refresh_token, expiresIn: token.expires_in, obtainedAt: this.now() };
  }
  private async invalidate() {
    this.tokens = undefined; this.identity = undefined; this.message = 'Re-login required';
    try { await this.store.clear(); } catch { this.message = 'Re-login required. Could not remove the local token file.'; }
  }
}
