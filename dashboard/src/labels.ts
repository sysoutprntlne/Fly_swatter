import type { ActionRecord, Category, Mode, RiskLevel } from './socket';
// Level names; each level also has its own shape (LevelMark), so colour is never the only signal (AGENTS.md §13.4).
export const levelInfo: Record<RiskLevel, { name: string; detail: string }> = {
  quiet: { name: 'Quiet', detail: 'No strong location-seeking signals detected.' },
  few_flies: { name: 'A Few Flies', detail: 'A few people are curious where you are.' },
  buzzing: { name: 'Buzzing', detail: 'Chat is trying to work out where you are.' },
  swarm: { name: 'Swarm Incoming', detail: 'Several people agree on a location guess. Check chat.' },
};
export const categoryLabel: Record<Category, string> = {
  location_question: 'Asked where', location_guess: 'Guessed a place', location_confirmation: 'Agreed with a guess', location_share: 'Shared a location',
  approach_intent: "Says they're coming", swat_or_threat: 'Threat', benign: 'Harmless',
};
// Pill tone per category: shares and threats need a decision now, guesses build a swarm, questions are context.
export const categoryTone: Record<Category, '' | 'warning' | 'negative'> = {
  location_question: '', location_guess: 'warning', location_confirmation: 'warning', location_share: 'negative',
  approach_intent: 'warning', swat_or_threat: 'negative', benign: '',
};
export const modeInfo: Record<Mode, { name: string; detail: string }> = {
  observe: { name: 'Observe', detail: 'Only watches. Nothing gets deleted.' },
  assist: { name: 'Assist', detail: 'Deletes shared locations, confident guesses and swarm messages, and alerts your mods.' },
  guardian: { name: 'Guardian', detail: 'Like Assist, plus deletes "where are you" questions when chat gets busy, warns repeat guessers, and locks down chat at Swarm.' },
};
export const actionLabel: Record<ActionRecord['kind'], string> = {
  delete_message: 'Deleted a message', mod_alert: 'Warned your mods', warn_user: 'Warned a chatter', shield_mode_on: 'Locked down chat', shield_mode_off: 'Ended chat lockdown',
  obs_brb_scene: 'Switched to BRB scene', report_prepared: 'Report prepared', private_alert: 'Note for you',
};
export const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
