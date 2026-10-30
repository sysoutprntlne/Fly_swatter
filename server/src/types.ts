export interface ChatMessage {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  text: string;
  timestamp: number;
  isBroadcaster: boolean;
  isModerator: boolean;
  isVip: boolean;
  isSubscriber: boolean;
  replyToMessageId?: string;
  source: 'twitch' | 'demo';
}
export interface ChatStatus {
  state: 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'revoked';
  message: string;
}
export interface ChatSnapshot { status: ChatStatus; messages: ChatMessage[]; demo?: DemoState; pipeline?: PipelineSnapshot }
export interface ChatSession { accessToken: string; broadcasterId: string }
export interface RaidEvent { fromLogin: string; viewers: number; at: number; source: 'twitch' | 'demo' }
export type DemoSpeed = 0.5 | 1 | 2;
export interface DemoScenarioSummary { name: string; file: string; events: number; durationMs: number }
export interface DemoState {
  enabled: boolean;
  scenario?: string;
  playing: boolean;
  finished: boolean;
  speed: DemoSpeed;
  position: number;
  total: number;
  lastRaid?: RaidEvent;
}

// ── Detection pipeline (AGENTS.md §6) ──
export type RiskLevel = 'quiet' | 'few_flies' | 'buzzing' | 'swarm';
export type Mode = 'observe' | 'assist' | 'guardian';
export interface PrefilterResult {
  messageId: string;
  score: number;              // 0..1
  matchedRules: string[];
  candidate: boolean;
  deletable: boolean;         // false for broadcaster/moderator messages
  immediate: boolean;         // high-weight hit: classify without batching delay
}
export type Category = 'location_question' | 'location_guess' | 'location_confirmation' | 'location_share' | 'approach_intent' | 'swat_or_threat' | 'benign';
export type Granularity = 'none' | 'country' | 'region' | 'city' | 'neighborhood' | 'street' | 'venue' | 'exact';
export interface Classification {
  messageId: string;
  category: Category;
  confidence: number;
  severity: 0 | 1 | 2 | 3;
  place?: { rawText: string; canonical: string; granularity: Granularity };
  rationale: string;          // dashboard only
  source: 'ai' | 'rules_fallback';
}
export interface Flagged { message: ChatMessage; prefilter: PrefilterResult; classification: Classification }
export interface ClusterMention { messageId: string; userId: string; userLogin: string; excerpt: string; category: Category; confidence: number; weight: number; at: number }
export interface PlaceCluster {
  id: string;
  canonical: string;          // dashboard only — never sent to chat
  granularity: Granularity;
  mentions: ClusterMention[];
  distinctUsers: number;
  score: number;
  firstSeen: number;
  lastSeen: number;
  isSwarm: boolean;
}
export interface RiskState {
  score: number;
  level: RiskLevel;
  components: { chat: number; triangulation: number; exposure: number; raid: number };
  questionPressure: number;
  updatedAt: number;
}
export type ActionKind = 'delete_message' | 'mod_alert' | 'warn_user' | 'shield_mode_on' | 'shield_mode_off' | 'obs_brb_scene' | 'report_prepared' | 'private_alert';
export interface ActionRecord {
  id: string;
  at: number;
  kind: ActionKind;
  targetMessageId?: string;
  targetUserId?: string;
  dryRun: boolean;
  success: boolean;
  error?: string;
  reason: string;             // dashboard only
}
export interface AiStatus { enabled: boolean; healthy: boolean; budgetReached: boolean; message: string }
export interface Settings { swatAllGuesses: boolean }
// A mod's check of one call the model made: right, or wrong and what it should have been. Session memory only.
export type Verdict = 'right' | 'wrong';
export interface Review { messageId: string; verdict: Verdict; shouldBe?: Category; at: number }
export interface PipelineSnapshot { settings: Settings; mode: Mode; risk: RiskState; flagged: Flagged[]; clusters: PlaceCluster[]; actions: ActionRecord[]; ai: AiStatus; reviews: Review[] }
