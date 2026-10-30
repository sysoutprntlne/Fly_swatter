import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Bus } from '../bus.js';
import type { ChatMessage, DemoScenarioSummary, DemoSpeed, DemoState } from '../types.js';

const login = z.string().regex(/^[a-z0-9_]{1,25}$/i);
const chatEvent = z.object({ t: z.number().int().min(0), type: z.literal('chat'), user: login, text: z.string().min(1).max(500), accountAgeDays: z.number().min(0).max(10_000).optional(), role: z.enum(['viewer', 'moderator', 'broadcaster']).optional() }).strict();
const raidEvent = z.object({ t: z.number().int().min(0), type: z.literal('raid'), fromUser: login, viewers: z.number().int().min(1).max(100_000) }).strict();
const scenarioSchema = z.object({ name: z.string().min(1).max(80), speed: z.number().optional(), events: z.array(z.discriminatedUnion('type', [chatEvent, raidEvent])).min(1).max(1000) })
  .refine(s => s.events.every((e, i) => i === 0 || e.t >= s.events[i - 1]!.t), 'events must be in time order');
export type Scenario = z.infer<typeof scenarioSchema>;
export const injectSchema = z.object({ user: login, text: z.string().trim().min(1).max(500) }).strict();
export const scenarioDir = resolve(import.meta.dirname, '../../src/demo/scenarios');

export function loadScenarios(dir = scenarioDir): Map<string, Scenario & { file: string }> {
  const scenarios = new Map<string, Scenario & { file: string }>();
  for (const file of readdirSync(dir).filter(name => name.endsWith('.json')).sort()) {
    // A broken scenario file must not take down the server; it is just not offered.
    try {
      const parsed = scenarioSchema.safeParse(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
      if (parsed.success) scenarios.set(parsed.data.name, { ...parsed.data, file });
    } catch { /* malformed JSON: skip */ }
  }
  return scenarios;
}

interface Timers { now: () => number; setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void }
const realTimers: Timers = { now: Date.now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

// Replays scripted chat onto the bus as source "demo" messages. Demo messages never reach Twitch.
export class Simulator {
  private state: DemoState;
  private messages: ChatMessage[] = [];
  private ages = new Map<string, number>();
  private elapsed = 0;          // scenario time already played, in scenario ms
  private resumedAt = 0;        // wall clock when playback last (re)started
  private timer: unknown;
  private counter = 0;
  constructor(private bus: Bus, private scenarios: Map<string, Scenario & { file: string }>, enabled: boolean, private timers: Timers = realTimers) {
    this.state = { enabled, playing: false, finished: false, speed: 1, position: 0, total: 0 };
  }
  list(): DemoScenarioSummary[] {
    return [...this.scenarios.values()].map(s => ({ name: s.name, file: s.file, events: s.events.length, durationMs: s.events.at(-1)!.t }));
  }
  snapshot() { return { state: { ...this.state }, messages: [...this.messages] }; }
  enabled() { return this.state.enabled; }
  accountAgeDays(userId: string) { return this.ages.get(userId); }
  setEnabled(enabled: boolean) {
    if (!enabled) this.reset();
    this.state.enabled = enabled; this.publish();
  }
  play(name: string, speed: DemoSpeed) {
    const scenario = this.scenarios.get(name);
    if (!this.state.enabled || !scenario) return false;
    if (this.state.scenario !== name || this.state.finished) this.rewind(name, scenario.events.length);
    else this.pauseClock();
    this.state.speed = speed; this.state.playing = true;
    this.resumedAt = this.timers.now();
    this.schedule(); this.publish();
    return true;
  }
  pause() {
    if (!this.state.playing) return;
    this.pauseClock(); this.state.playing = false; this.publish();
  }
  reset() {
    this.cancel();
    this.state = { enabled: this.state.enabled, playing: false, finished: false, speed: this.state.speed, position: 0, total: 0 };
    this.elapsed = 0; this.messages = []; this.ages.clear();
    this.bus.emit('demo.cleared', null); this.publish();
  }
  inject(user: string, text: string) {
    if (!this.state.enabled) return undefined;
    return this.emitChat(user, text, undefined, 'viewer');
  }
  stop() { this.cancel(); }
  private rewind(name: string, total: number) {
    this.cancel();
    this.elapsed = 0; this.messages = []; this.ages.clear();
    this.bus.emit('demo.cleared', null);
    this.state = { ...this.state, scenario: name, finished: false, position: 0, total, lastRaid: undefined };
  }
  private pauseClock() {
    this.cancel();
    if (this.state.playing) this.elapsed += (this.timers.now() - this.resumedAt) * this.state.speed;
  }
  private cancel() { if (this.timer !== undefined) this.timers.clearTimeout(this.timer); this.timer = undefined; }
  private schedule() {
    const scenario = this.scenarios.get(this.state.scenario!)!;
    const next = scenario.events[this.state.position];
    if (!next) { this.state.playing = false; this.state.finished = true; this.publish(); return; }
    const playedSoFar = this.elapsed + (this.timers.now() - this.resumedAt) * this.state.speed;
    const wait = Math.max(0, (next.t - playedSoFar) / this.state.speed);
    this.timer = this.timers.setTimeout(() => { this.timer = undefined; this.fire(); }, wait);
  }
  private fire() {
    const event = this.scenarios.get(this.state.scenario!)!.events[this.state.position++]!;
    try {
      if (event.type === 'chat') this.emitChat(event.user, event.text, event.accountAgeDays, event.role ?? 'viewer');
      else {
        this.state.lastRaid = { fromLogin: event.fromUser, viewers: event.viewers, at: this.timers.now(), source: 'demo' };
        this.bus.emit('raid', this.state.lastRaid);
      }
    } finally { this.publish(); this.schedule(); }
  }
  private emitChat(user: string, text: string, accountAgeDays: number | undefined, role: 'viewer' | 'moderator' | 'broadcaster') {
    const userLogin = user.toLowerCase();
    const message: ChatMessage = { id: `demo-${++this.counter}-${randomBytes(4).toString('hex')}`, userId: `demo:${userLogin}`, userLogin, userName: user, text, timestamp: this.timers.now(), isBroadcaster: role === 'broadcaster', isModerator: role === 'moderator', isVip: false, isSubscriber: false, source: 'demo' };
    if (accountAgeDays !== undefined) this.ages.set(message.userId, accountAgeDays);
    this.messages.push(message); if (this.messages.length > 2000) this.messages.shift();
    this.bus.emit('chat.message', message);
    return message;
  }
  private publish() { this.bus.emit('demo.state', { ...this.state }); }
}
