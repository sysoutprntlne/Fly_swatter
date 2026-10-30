// Bot copy (AGENTS.md §11.3). Fixed strings only: never interpolate place text, usernames or chat content.
export const copy = {
  modAlertBuzzing: '🪰 Fly Swatter: chat is fishing for the streamer\'s location. Mods, stay sharp.',
  modAlertSwarm: '🪰🪰🪰 Fly Swatter: multiple chatters are converging on a location guess. Swatting messages now. Mods, check the dashboard.',
  publicNotice: '🪰 Location guesses get swatted here. Keep the streamer safe!',
  warningReason: 'Please don\'t guess or share the streamer\'s location.',
  broadcasterAlert: 'You may have revealed a location in chat. Fly Swatter cannot delete your own messages.',
} as const;
