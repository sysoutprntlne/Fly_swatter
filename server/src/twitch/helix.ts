import type { ChatSession } from '../types.js';

export interface ChatAuth {
  getChatSession(): ChatSession | undefined;
  getModerationSession?(): ChatSession | undefined;
  refresh(): Promise<void>;
}
export class HelixError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export class Helix {
  constructor(private clientId: string, private auth: ChatAuth, private request: typeof fetch = fetch,
    private now: () => number = Date.now, private wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {}
  async subscribeChat(sessionId: string, signal: AbortSignal) {
    const initial = this.auth.getChatSession();
    if (!initial) throw new Error('Chat authorization required');
    let refreshed = false;
    let rateRetried = false;
    while (!signal.aborted) {
      const session = this.auth.getChatSession();
      if (!session || session.broadcasterId !== initial.broadcasterId) throw new Error('Chat authorization changed');
      const response = await this.request('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
        headers: { Authorization: `Bearer ${session.accessToken}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: session.broadcasterId, user_id: session.broadcasterId }, transport: { method: 'websocket', session_id: sessionId } }),
      });
      // Twitch returns 202 with a body we don't need; drain every response so the connection is released.
      await response.body?.cancel().catch(() => {});
      if (response.status === 401 && !refreshed) { refreshed = true; await this.auth.refresh(); continue; }
      if (response.status === 429 && !rateRetried) {
        rateRetried = true;
        const reset = Number(response.headers.get('Ratelimit-Reset')) * 1000;
        const delay = reset > this.now() ? reset - this.now() + 100 : 1000;
        // A long wait misses Twitch's welcome subscription deadline: reconnect instead.
        if (delay > 8_000) throw new Error('Twitch rate limit; reconnect required');
        await this.wait(delay); continue;
      }
      if (response.status !== 202) throw new Error(`Twitch subscription failed (HTTP ${response.status})`);
      return;
    }
    throw new Error('Subscription cancelled');
  }
  // Moderation calls act as the token owner (broadcaster == moderator == sender in this MVP, §7.2).
  async deleteMessage(messageId: string) {
    // Twitch deletes the ENTIRE chat when message_id is omitted. Never allow that.
    if (!/^[\w-]{1,100}$/.test(messageId)) throw new Error('Refusing delete without a valid message ID');
    await this.moderate('DELETE', '/moderation/chat', session => ({ broadcaster_id: session.broadcasterId, moderator_id: session.broadcasterId, message_id: messageId }), undefined, [204]);
  }
  async sendChat(message: string) {
    const body = await this.moderate('POST', '/chat/messages', () => ({}), session => ({ broadcaster_id: session.broadcasterId, sender_id: session.broadcasterId, message: message.slice(0, 500) }), [200]);
    const sent = (body as { data?: { is_sent?: boolean; drop_reason?: { message?: string } }[] } | undefined)?.data?.[0];
    if (sent && sent.is_sent === false) throw new HelixError(200, 'Twitch dropped the chat message');
  }
  async warnUser(userId: string, reason: string) {
    await this.moderate('POST', '/moderation/warnings', session => ({ broadcaster_id: session.broadcasterId, moderator_id: session.broadcasterId }), () => ({ data: { user_id: userId, reason: reason.slice(0, 500) } }), [200]);
  }
  async setShieldMode(active: boolean) {
    await this.moderate('PUT', '/moderation/shield_mode', session => ({ broadcaster_id: session.broadcasterId, moderator_id: session.broadcasterId }), () => ({ is_active: active }), [200]);
  }
  private async moderate(method: string, path: string, query: (session: ChatSession) => Record<string, string>, body: ((session: ChatSession) => unknown) | undefined, ok: number[]) {
    let refreshed = false, rateRetried = false;
    for (;;) {
      const session = this.auth.getModerationSession?.();
      if (!session) throw new HelixError(403, 'Moderation permission not granted');
      const params = new URLSearchParams(query(session));
      const response = await this.request(`https://api.twitch.tv/helix${path}${params.size ? `?${params}` : ''}`, {
        method, signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Bearer ${session.accessToken}`, 'Client-Id': this.clientId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body(session)) } : {}),
      });
      if (response.status === 401 && !refreshed) { await response.body?.cancel().catch(() => {}); refreshed = true; await this.auth.refresh(); continue; }
      if (response.status === 429 && !rateRetried) {
        await response.body?.cancel().catch(() => {});
        rateRetried = true;
        const reset = Number(response.headers.get('Ratelimit-Reset')) * 1000;
        await this.wait(Math.min(10_000, reset > this.now() ? reset - this.now() + 100 : 1000)); continue;
      }
      if (!ok.includes(response.status)) { await response.body?.cancel().catch(() => {}); throw new HelixError(response.status, `Twitch ${method} ${path} failed (HTTP ${response.status})`); }
      if (response.status === 204) return undefined;
      return response.json().catch(() => undefined);
    }
  }
}
