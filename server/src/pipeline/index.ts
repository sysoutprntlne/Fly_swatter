import type { Bus } from '../bus.js';
import type { Config } from '../config.js';
import type { ActionRecord, Category, ChatMessage, Flagged, Mode, PipelineSnapshot, PlaceCluster, Review, RiskLevel, RiskState, Verdict } from '../types.js';
import { ActionEngine, type ModerationApi } from './actionEngine.js';
import { Classifier, type AiClient } from './classifier.js';
import { ChatContext, prefilter } from './prefilter.js';
import { RiskEngine } from './riskEngine.js';
import { Triangulation } from './triangulation.js';

export interface PipelineOptions {
  bus: Bus;
  config: Pick<Config, 'DEFAULT_MODE' | 'SWAT_ALL_GUESSES' | 'PREFILTER_THRESHOLD' | 'TRIANGULATION_WINDOW_MS' | 'SWARM_MIN_USERS' | 'SWARM_MIN_SCORE' | 'AI_MAX_CALLS_PER_MINUTE' | 'AI_TIMEOUT_MS'>;
  moderation: ModerationApi;
  ai?: AiClient;
  isDemo: () => boolean;
  streamer: () => string;
  accountAgeDays: (userId: string) => number | undefined;
  now?: () => number;
  log?: (message: string) => void;
  tickMs?: number;
}
const MAX_FLAGGED = 1000, MAX_ACTIONS = 500, RISK_EMIT_MS = 250;

// Wires chat → prefilter → classifier → triangulation → risk → actions over the bus (AGENTS.md §6).
export class Pipeline {
  private context = new ChatContext();
  private triangulation: Triangulation;
  private risk: RiskEngine;
  private classifier: Classifier;
  private actions: ActionEngine;
  private flagged: Flagged[] = [];
  private actionLog: ActionRecord[] = [];
  private reviews = new Map<string, Review>();   // mods' checks of the model's calls, by message id
  private level: RiskLevel = 'quiet';
  private lastRisk?: RiskState;
  private riskEmittedAt = 0;
  private riskTimer?: ReturnType<typeof setTimeout>;
  private tick?: ReturnType<typeof setInterval>;
  private unsubscribers: (() => void)[] = [];
  private clusterSignature = '';
  private demoEnabled: boolean;
  private generation = 0;
  private now: () => number;
  constructor(private options: PipelineOptions) {
    this.now = options.now ?? Date.now;
    const { config, bus } = options;
    this.demoEnabled = options.isDemo();
    this.triangulation = new Triangulation({ windowMs: config.TRIANGULATION_WINDOW_MS, swarmMinUsers: config.SWARM_MIN_USERS, swarmMinScore: config.SWARM_MIN_SCORE, now: this.now });
    this.risk = new RiskEngine(this.now);
    this.actions = new ActionEngine(options.moderation, this.now, record => this.record(record), config.DEFAULT_MODE, config.SWAT_ALL_GUESSES);
    this.classifier = new Classifier({
      ai: options.ai, maxCallsPerMinute: config.AI_MAX_CALLS_PER_MINUTE, timeoutMs: config.AI_TIMEOUT_MS,
      streamer: options.streamer, context: () => this.context.recent(),
      onResult: flagged => { void this.onClassified(flagged); }, onStatus: status => bus.emit('ai.status', status),
      timers: options.now ? { now: this.now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) } : undefined,
    });
    this.unsubscribers.push(
      bus.on('chat.message', message => this.onMessage(message)),
      bus.on('raid', raid => { if ((raid.source === 'demo') !== options.isDemo()) return; this.risk.onRaid(raid.viewers); this.updateRisk(); }),
      bus.on('demo.cleared', () => this.reset()),
      bus.on('demo.state', state => { if (state.enabled !== this.demoEnabled) { this.demoEnabled = state.enabled; this.reset(); } }),
    );
  }
  start() { this.tick = setInterval(() => this.onTick(), this.options.tickMs ?? 1000); this.tick.unref(); }
  stop() { this.generation++; if (this.tick) clearInterval(this.tick); if (this.riskTimer) clearTimeout(this.riskTimer); this.classifier.reset(); this.actions.reset(); for (const off of this.unsubscribers) off(); }
  mode() { return this.actions.getMode(); }
  setMode(mode: Mode) { this.actions.setMode(mode); this.options.bus.emit('mode', mode); }
  setSwatAllGuesses(enabled: boolean) { this.actions.setSwatAllGuesses(enabled); this.options.bus.emit('settings', { swatAllGuesses: enabled }); }
  setShield(active: boolean) { return this.actions.setShield(active, this.options.isDemo()); }
  snapshot(): PipelineSnapshot {
    return { settings: { swatAllGuesses: this.actions.getSwatAllGuesses() }, mode: this.actions.getMode(), risk: this.risk.state(), flagged: [...this.flagged], clusters: this.triangulation.snapshot(), actions: [...this.actionLog], ai: this.classifier.aiStatus(), reviews: [...this.reviews.values()] };
  }
  /** Records a mod's verdict on a flagged message (null clears it). Returns false if the message isn't flagged. */
  review(messageId: string, verdict: Verdict | null, shouldBe?: Category): boolean {
    if (!this.flagged.some(f => f.message.id === messageId)) return false;
    const review = verdict ? { messageId, verdict, ...(verdict === 'wrong' && shouldBe ? { shouldBe } : {}), at: this.now() } : null;
    if (review) this.reviews.set(messageId, review); else this.reviews.delete(messageId);
    this.options.bus.emit('review', { messageId, review });
    return true;
  }
  async flush() { await this.classifier.flush(); }

  private onMessage(message: ChatMessage) {
    // Demo mode analyses only simulated chat; live mode only real chat.
    if ((message.source === 'demo') !== this.options.isDemo()) return;
    try {
      this.context.add(message);
      const result = prefilter(message, this.options.config.PREFILTER_THRESHOLD);
      if (result.candidate) this.classifier.enqueue({ message, prefilter: result });
    } catch { this.options.log?.('Prefilter failed for one message'); }
  }
  private async onClassified(flagged: Flagged) {
    const generation = this.generation;
    try {
      if ((flagged.message.source === 'demo') !== this.options.isDemo()) return;
      const { bus } = this.options;
      const { cluster, becameSwarm } = this.triangulation.add(flagged);
      const pressure = this.triangulation.questionPressure();
      this.syncTriangulation();
      this.risk.onClassification(flagged, { accountAgeDays: this.options.accountAgeDays(flagged.message.userId), questionPressure: pressure });
      if (flagged.classification.category !== 'benign') {
        this.flagged.push(flagged);
        if (this.flagged.length > MAX_FLAGGED) this.reviews.delete(this.flagged.shift()!.message.id);
      }
      bus.emit('classification', flagged);
      this.emitClustersIfChanged(this.triangulation.snapshot(), true);
      this.updateRisk();
      await this.actions.onFlagged(flagged, this.level, cluster);
      if (generation !== this.generation) return;
      if (becameSwarm && cluster) { bus.emit('cluster.swarm', cluster); await this.actions.onSwarm(cluster, flagged.message.source === 'demo'); }
    } catch { this.options.log?.('Pipeline failed for one classification'); }
  }
  private syncTriangulation() {
    const clusters = this.triangulation.snapshot();
    this.risk.setTriangulation(clusters[0]?.score ?? 0, clusters.some(c => c.isSwarm), this.triangulation.questionPressure());
    return clusters;
  }
  private onTick() {
    try {
      // Mentions age out of the window between messages; push the change when the clusters differ.
      this.emitClustersIfChanged(this.syncTriangulation());
      this.updateRisk();
    } catch { this.options.log?.('Risk tick failed'); }
  }
  private emitClustersIfChanged(clusters: PlaceCluster[], force = false) {
    const signature = clusters.map(c => `${c.id}:${c.mentions.length}:${c.score}`).join('|');
    if (!force && signature === this.clusterSignature) return;
    this.clusterSignature = signature;
    this.options.bus.emit('cluster.updated', clusters);
  }
  // risk.updated is throttled to 4/s with a trailing emit; level changes are never throttled.
  private updateRisk() {
    const state = this.risk.state();
    this.lastRisk = state;
    if (state.level !== this.level) {
      const from = this.level; this.level = state.level;
      this.options.bus.emit('risk.level_changed', { from, to: state.level });
      void this.actions.onLevelChange(from, state.level, this.options.isDemo());
    }
    const wait = RISK_EMIT_MS - (this.now() - this.riskEmittedAt);
    if (wait <= 0) { this.riskEmittedAt = this.now(); this.options.bus.emit('risk.updated', state); }
    else if (!this.riskTimer) this.riskTimer = setTimeout(() => { this.riskTimer = undefined; this.riskEmittedAt = this.now(); if (this.lastRisk) this.options.bus.emit('risk.updated', this.lastRisk); }, wait);
  }
  private record(record: ActionRecord) {
    this.actionLog.push(record); if (this.actionLog.length > MAX_ACTIONS) this.actionLog.shift();
    this.options.bus.emit('action.taken', record);
  }
  reset() {
    this.generation++;
    if (this.riskTimer) clearTimeout(this.riskTimer);
    this.riskTimer = undefined; this.lastRisk = undefined; this.riskEmittedAt = 0;
    this.classifier.reset(); this.triangulation.reset(); this.risk.reset(); this.actions.reset(); this.context.clear();
    this.flagged = []; this.actionLog = []; this.reviews.clear(); this.level = 'quiet'; this.clusterSignature = '';
    this.options.bus.emit('pipeline.reset', this.snapshot());
  }
}
