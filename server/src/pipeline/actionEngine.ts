import { copy } from '../copy.js';
import type { ActionKind, ActionRecord, Flagged, Mode, PlaceCluster, RiskLevel } from '../types.js';

// Turns classifications and risk changes into moderation actions (AGENTS.md §11).
export interface ModerationApi {
  deleteMessage(messageId: string): Promise<void>;
  sendChat(message: string): Promise<void>;
  warnUser(userId: string, reason: string): Promise<void>;
  setShieldMode(active: boolean): Promise<void>;
}
export interface PlannedAction { kind: ActionKind; reason: string; targetMessageId?: string; targetUserId?: string; chatMessage?: string; demo: boolean; manual?: boolean }
const levelRank: Record<RiskLevel, number> = { quiet: 0, few_flies: 1, buzzing: 2, swarm: 3 };
const ALERT_DEDUPE_MS = 60_000, WARN_WINDOW_MS = 600_000;

export class ActionEngine {
  private done = new Set<string>();             // idempotency: one action of each kind per target
  private lastAlert = new Map<string, number>(); // alert kind → time
  private swarmAlerted = new Set<string>();      // cluster ids
  private deletesByUser = new Map<string, number[]>();
  private known = new Map<string, Flagged>();    // flagged messages by id, for swarm deletions
  private shieldOn = false;
  private counter = 0;
  // swatAllGuesses deletes every guess/confirmation/share regardless of confidence, so a deletion only ever
  // means "someone guessed" and never hints which guess the crowd agrees on.
  constructor(private api: ModerationApi, private now: () => number, private onRecord: (record: ActionRecord) => void, private mode: Mode = 'observe', private swatAllGuesses = false) {}
  getSwatAllGuesses() { return this.swatAllGuesses; }
  setSwatAllGuesses(enabled: boolean) { this.swatAllGuesses = enabled; }
  getMode() { return this.mode; }
  setMode(mode: Mode) { this.mode = mode; }

  async onFlagged(flagged: Flagged, level: RiskLevel, cluster?: PlaceCluster) {
    const { message, classification: c, prefilter } = flagged;
    if (c.category === 'benign') return;
    this.known.set(message.id, flagged);
    if (this.known.size > 2000) this.known.delete(this.known.keys().next().value!);
    const demo = message.source === 'demo';
    if (!prefilter.deletable) {
      // Twitch cannot delete broadcaster/mod messages; tell the streamer privately instead.
      if (message.isBroadcaster) await this.execute({ kind: 'private_alert', targetMessageId: message.id, reason: copy.broadcasterAlert, demo });
      return;
    }
    const inSwarm = Boolean(cluster?.isSwarm && cluster.mentions.some(m => m.messageId === message.id));
    const reasons: string[] = [];
    if (c.category === 'location_share' && c.confidence >= 0.6) reasons.push('shared a location');
    if ((c.category === 'location_guess' || c.category === 'location_confirmation') && c.severity >= 2 && c.confidence >= 0.7) reasons.push(`confident ${c.category.replace('location_', '')}`);
    if (inSwarm) reasons.push('part of a converging swarm');
    if (this.swatAllGuesses && ['location_guess', 'location_confirmation', 'location_share'].includes(c.category)) reasons.push('swat-all-guesses is on');
    if (this.mode === 'guardian' && c.category === 'location_question' && levelRank[level] >= levelRank.buzzing) reasons.push('location question while chat is buzzing');
    if (reasons.length) await this.deleteFlagged(flagged, reasons.join('; '));
  }
  // A new swarm: alert mods once per cluster and swat every message that built it.
  async onSwarm(cluster: PlaceCluster, demo: boolean) {
    if (this.swarmAlerted.has(cluster.id)) return;
    this.swarmAlerted.add(cluster.id);
    await this.alert('swarm', copy.modAlertSwarm, `Swarm formed: ${cluster.distinctUsers} chatters converged on one place`, demo);
    for (const mention of cluster.mentions) {
      const flagged = this.known.get(mention.messageId);
      if (flagged?.prefilter.deletable) await this.deleteFlagged(flagged, 'part of a converging swarm');
    }
  }
  async onLevelChange(from: RiskLevel, to: RiskLevel, demo: boolean) {
    if (levelRank[to] <= levelRank[from]) return;
    if (to === 'buzzing') await this.alert('buzzing', copy.modAlertBuzzing, 'Risk rose to Buzzing', demo);
    if (to === 'swarm') {
      await this.alert('swarm', copy.modAlertSwarm, 'Risk rose to Swarm Incoming', demo);
      if (this.mode === 'guardian' && !this.shieldOn) {
        const record = await this.execute({ kind: 'shield_mode_on', reason: 'Guardian: risk reached Swarm Incoming', demo });
        if (record?.success) this.shieldOn = true;
      }
    }
  }
  // Human-initiated Shield Mode toggle (auto-off is manual only).
  async setShield(active: boolean, demo: boolean) {
    const record = await this.execute({ kind: active ? 'shield_mode_on' : 'shield_mode_off', reason: active ? 'Turned on from the dashboard' : 'Turned off from the dashboard', demo, manual: true });
    if (record?.success) this.shieldOn = active;
    return record;
  }
  reset() { this.done.clear(); this.lastAlert.clear(); this.swarmAlerted.clear(); this.deletesByUser.clear(); this.known.clear(); }

  private async deleteFlagged(flagged: Flagged, reason: string) {
    const { message, classification } = flagged;
    const record = await this.execute({ kind: 'delete_message', targetMessageId: message.id, targetUserId: message.userId, reason: `Swatted ${classification.category.replace(/_/g, ' ')}: ${reason}`, demo: message.source === 'demo' });
    if (!record?.success) return;
    const now = this.now();
    const recent = (this.deletesByUser.get(message.userId) ?? []).filter(at => now - at <= WARN_WINDOW_MS);
    recent.push(now); this.deletesByUser.set(message.userId, recent);
    if (this.mode === 'guardian' && recent.length >= 2 && !this.recentlyDone(`warn_user:${message.userId}`, WARN_WINDOW_MS)) {
      await this.execute({ kind: 'warn_user', targetUserId: message.userId, reason: 'Repeat offender: 2+ swatted messages in 10 minutes', chatMessage: copy.warningReason, demo: message.source === 'demo' });
    }
  }
  // Same alert kind at most once per 60 s (§11.2). A swarm reaching the risk level and forming a cluster
  // happen in the same instant, so they share the "swarm" slot instead of posting twice.
  private async alert(kind: 'buzzing' | 'swarm', text: string, reason: string, demo: boolean) {
    const now = this.now();
    if (now - (this.lastAlert.get(kind) ?? -Infinity) < ALERT_DEDUPE_MS) return;
    this.lastAlert.set(kind, now);
    await this.execute({ kind: 'mod_alert', reason, chatMessage: text, demo });
  }
  private recentlyDone(key: string, windowMs: number) { const at = this.lastAlert.get(key); return at !== undefined && this.now() - at < windowMs; }

  // Single choke point: dry-run, idempotency and error capture are enforced here and nowhere else.
  async execute(action: PlannedAction): Promise<ActionRecord | undefined> {
    const key = action.targetMessageId ? `${action.kind}:${action.targetMessageId}` : undefined;
    if (key && this.done.has(key)) return undefined;
    if (key) { this.done.add(key); if (this.done.size > 10_000) this.done.delete(this.done.values().next().value!); }
    if (action.kind === 'warn_user') this.lastAlert.set(`warn_user:${action.targetUserId}`, this.now());
    // Observe mode and demo messages never touch Twitch. Manual dashboard actions still respect demo.
    const dryRun = action.demo || (this.mode === 'observe' && !action.manual) || action.kind === 'private_alert';
    const record: ActionRecord = { id: `action-${++this.counter}`, at: this.now(), kind: action.kind, dryRun: dryRun && action.kind !== 'private_alert', success: true, reason: action.reason,
      ...(action.targetMessageId ? { targetMessageId: action.targetMessageId } : {}), ...(action.targetUserId ? { targetUserId: action.targetUserId } : {}) };
    if (!dryRun) {
      try {
        if (action.kind === 'delete_message') await this.api.deleteMessage(action.targetMessageId!);
        else if (action.kind === 'mod_alert') await this.api.sendChat(action.chatMessage!);
        else if (action.kind === 'warn_user') await this.api.warnUser(action.targetUserId!, action.chatMessage!);
        else if (action.kind === 'shield_mode_on' || action.kind === 'shield_mode_off') await this.api.setShieldMode(action.kind === 'shield_mode_on');
      } catch (error) {
        record.success = false;
        // Error text comes from our own Helix messages (status codes only), never upstream bodies.
        record.error = error instanceof Error ? error.message.slice(0, 200) : 'Action failed';
      }
    }
    try { this.onRecord(record); } catch { /* recording must not break moderation */ }
    return record;
  }
}
