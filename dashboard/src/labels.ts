import type { ActionRecord, Category, Mode, RiskLevel } from './socket';
// Level names; each level also has its own shape (LevelMark), so colour is never the only signal (AGENTS.md §13.4).
export const levelInfo: Record<RiskLevel, { name: string; detail: string }> = {
  quiet: { name: 'Quiet', detail: 'Nobody is hunting for your location.' },
  few_flies: { name: 'A Few Flies', detail: 'Some chatters are curious about where you are.' },
  buzzing: { name: 'Buzzing', detail: 'Chat is actively fishing for your location.' },
  swarm: { name: 'Swarm Incoming', detail: 'Several chatters agree on a place. Act now.' },
};
export const categoryLabel: Record<Category, string> = {
  location_question: 'Question', location_guess: 'Guess', location_confirmation: 'Confirmation', location_share: 'Shared location',
  approach_intent: 'Approaching', swat_or_threat: 'Threat', benign: 'Benign',
};
// Pill tone per category: shares and threats need a decision now, guesses build a swarm, questions are context.
export const categoryTone: Record<Category, '' | 'warning' | 'negative'> = {
  location_question: '', location_guess: 'warning', location_confirmation: 'warning', location_share: 'negative',
  approach_intent: 'warning', swat_or_threat: 'negative', benign: '',
};
export const modeInfo: Record<Mode, { name: string; detail: string }> = {
  observe: { name: 'Observe', detail: 'Watches and logs what it would do. Never touches Twitch.' },
  assist: { name: 'Assist', detail: 'Deletes shared locations, confident guesses and swarm messages; alerts mods in chat.' },
  guardian: { name: 'Guardian', detail: 'Assist, plus deletes location questions while buzzing, warns repeat offenders and turns on Shield Mode at Swarm.' },
};
export const actionLabel: Record<ActionRecord['kind'], string> = {
  delete_message: 'Swatted message', mod_alert: 'Mod alert', warn_user: 'Warned user', shield_mode_on: 'Shield Mode on', shield_mode_off: 'Shield Mode off',
  obs_brb_scene: 'BRB scene', report_prepared: 'Report prepared', private_alert: 'Private alert',
};
export const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
