import WebSocket from 'ws';
import { z } from 'zod';
import { Bus } from '../bus.js';
import type { ChatMessage, ChatSession, ChatSnapshot, ChatStatus } from '../types.js';

const envelope = z.object({ metadata: z.object({ message_id: z.string(), message_type: z.string(), message_timestamp: z.string(), subscription_type: z.string().optional() }), payload: z.unknown() });
const welcome = z.object({ session: z.object({ id: z.string().min(1), keepalive_timeout_seconds: z.number().min(1).max(600) }) });
const reconnect = z.object({ session: z.object({ reconnect_url: z.string().url() }) });
const notification = z.object({
  subscription: z.object({ type: z.literal('channel.chat.message'), condition: z.object({ broadcaster_user_id: z.string(), user_id: z.string() }) }),
  event: z.object({ broadcaster_user_id: z.string(), source_broadcaster_user_id: z.string().nullish(), message_id: z.string().min(1), chatter_user_id: z.string(), chatter_user_login: z.string(), chatter_user_name: z.string(), message: z.object({ text: z.string().max(10_000) }), badges: z.array(z.object({ set_id: z.string() })), reply: z.object({ parent_message_id: z.string() }).nullish() }),
});
type Connection = { socket: WebSocket; timer?: ReturnType<typeof setTimeout>; timeout: number; welcomed: boolean; controller: AbortController };
interface Options {
  getSession: () => ChatSession | undefined;
  subscribe: (sessionId: string, signal: AbortSignal) => Promise<void>;
  bus: Bus;
  socket?: (url: string) => WebSocket;
  now?: () => number;
  // Injected only in tests, never accepted from configuration or requests.
  endpoint?: string;
  reconnectAllowed?: (url: URL) => boolean;
}
export class EventSub {
  private active?: Connection;
  private replacement?: Connection;
  private tick?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private running = false;
  private owner?: string;
  private revokedToken?: string;
  private seen = new Set<string>();
  private messages: ChatMessage[] = [];
  private status: ChatStatus = { state: 'waiting', message: 'Connect Twitch and allow chat reading.' };
  private now: () => number;
  constructor(private options: Options) { this.now = options.now ?? Date.now; }
  snapshot(): ChatSnapshot { return { status: { ...this.status }, messages: [...this.messages] }; }
  start() {
    if (this.running) return;
    this.running = true; this.sync();
    this.tick = setInterval(() => this.sync(), 1000); this.tick.unref();
  }
  stop() {
    this.running = false;
    if (this.tick) clearInterval(this.tick);
    this.disconnect();
  }
  private setStatus(state: ChatStatus['state'], message: string) {
    if (this.status.state === state && this.status.message === message) return;
    this.status = { state, message }; this.options.bus.emit('status', this.status);
  }
  private sync() {
    const session = this.options.getSession();
    if (!session) {
      this.disconnect();
      this.setStatus('waiting', 'Reconnect Twitch to allow reading your channel’s chat.');
      return;
    }
    if (this.owner !== session.broadcasterId) {
      this.disconnect(); this.messages = []; this.seen.clear(); this.owner = session.broadcasterId;
      this.options.bus.emit('chat.reset', null);
    }
    if (this.revokedToken === session.accessToken) return;
    if (!this.active && !this.retry) this.connect(this.options.endpoint ?? 'wss://eventsub.wss.twitch.tv/ws', false);
  }
  private disconnect() {
    if (this.retry) clearTimeout(this.retry); this.retry = undefined;
    const connections = [this.active, this.replacement]; this.active = undefined; this.replacement = undefined;
    for (const connection of connections) if (connection) this.dispose(connection);
  }
  private dispose(connection: Connection) {
    connection.controller.abort();
    if (connection.timer) clearTimeout(connection.timer);
    connection.socket.terminate();
  }
  private arm(connection: Connection) {
    if (connection.timer) clearTimeout(connection.timer);
    connection.timer = setTimeout(() => this.failed(connection), connection.timeout);
    connection.timer.unref();
  }
  private connect(url: string, transfer: boolean) {
    if (!this.running) return;
    const socket = this.options.socket?.(url) ?? new WebSocket(url, { maxPayload: 256_000, handshakeTimeout: 10_000 });
    const connection: Connection = { socket, timeout: 12_000, welcomed: false, controller: new AbortController() };
    if (transfer) this.replacement = connection; else this.active = connection;
    this.setStatus(transfer || this.attempts ? 'reconnecting' : 'connecting', 'Connecting to Twitch chat…');
    this.arm(connection);
    socket.on('message', data => { void this.receive(connection, data.toString(), transfer); });
    socket.on('error', () => this.failed(connection));
    socket.on('close', () => this.failed(connection));
  }
  private failed(connection: Connection) {
    if (connection !== this.active && connection !== this.replacement) return;
    this.disconnect();
    if (!this.running || !this.options.getSession()) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5));
    this.setStatus('reconnecting', 'Twitch chat disconnected. Retrying automatically; messages during the gap may be lost.');
    this.retry = setTimeout(() => { this.retry = undefined; this.sync(); }, delay); this.retry.unref();
  }
  private async receive(connection: Connection, raw: string, transfer: boolean) {
    if (connection !== this.active && connection !== this.replacement) return;
    try {
      const frame = envelope.parse(JSON.parse(raw));
      this.arm(connection);
      if (frame.metadata.message_type === 'session_welcome') {
        if (connection.welcomed) return;
        connection.welcomed = true;
        const session = welcome.parse(frame.payload).session;
        connection.timeout = session.keepalive_timeout_seconds * 1000 + 2000;
        this.arm(connection);
        if (transfer) {
          const old = this.active; this.active = connection; this.replacement = undefined;
          if (old && old !== connection) this.dispose(old);
        } else {
          // Subscription failure must reconnect regardless of status; an unsubscribed socket receives nothing.
          try { await this.options.subscribe(session.id, connection.controller.signal); } catch { this.failed(connection); return; }
        }
        if (connection !== this.active || connection.controller.signal.aborted) return;
        this.attempts = 0; this.setStatus('connected', 'Receiving your channel’s chat. Observe only.');
      } else if (frame.metadata.message_type === 'session_reconnect' && connection === this.active && !this.replacement) {
        const url = new URL(reconnect.parse(frame.payload).session.reconnect_url);
        const allowed = this.options.reconnectAllowed?.(url) ?? (url.protocol === 'wss:' && url.hostname === 'eventsub.wss.twitch.tv' && !url.port && !url.username && !url.password);
        if (!allowed) { this.failed(connection); return; }
        this.connect(url.href, true);
      } else if (frame.metadata.message_type === 'revocation') {
        this.revokedToken = this.options.getSession()?.accessToken;
        this.disconnect();
        this.setStatus('revoked', 'Twitch revoked the chat subscription. Reconnect Twitch to authorize again.');
      } else if (frame.metadata.message_type === 'notification' && frame.metadata.subscription_type === 'channel.chat.message' && connection.welcomed) {
        const payload = notification.parse(frame.payload);
        const identity = this.options.getSession();
        const event = payload.event;
        if (!identity || identity.broadcasterId !== this.owner || event.broadcaster_user_id !== this.owner || payload.subscription.condition.broadcaster_user_id !== this.owner || payload.subscription.condition.user_id !== this.owner) return;
        // Shared-chat events originating in another channel are outside this tool's scope.
        if (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== this.owner) return;
        const timestamp = Date.parse(frame.metadata.message_timestamp);
        if (!Number.isFinite(timestamp) || timestamp > this.now() + 60_000) return;
        const keys = [`event:${frame.metadata.message_id}`, `chat:${event.message_id}`];
        if (keys.some(key => this.seen.has(key))) return;
        for (const key of keys) this.seen.add(key);
        while (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value!);
        const badges = new Set(event.badges.map(badge => badge.set_id));
        const message: ChatMessage = { id: event.message_id, userId: event.chatter_user_id, userLogin: event.chatter_user_login, userName: event.chatter_user_name, text: event.message.text, timestamp, isBroadcaster: event.chatter_user_id === this.owner || badges.has('broadcaster'), isModerator: badges.has('moderator'), isVip: badges.has('vip'), isSubscriber: badges.has('subscriber') || badges.has('founder'), ...(event.reply ? { replyToMessageId: event.reply.parent_message_id } : {}), source: 'twitch' };
        this.messages.push(message); if (this.messages.length > 2000) this.messages.shift();
        this.options.bus.emit('chat.message', message);
      }
    } catch {
      // A malformed notification is discarded. Handshake/subscription failures reconnect.
      if (!connection.welcomed || this.status.state === 'connecting') this.failed(connection);
    }
  }
}
