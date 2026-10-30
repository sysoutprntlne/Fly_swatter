import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const schema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TWITCH_CLIENT_ID: z.string().trim().default(''),
  TWITCH_CLIENT_SECRET: z.string().trim().default(''),
  TWITCH_REDIRECT_URI: z.string().url().default('http://localhost:3000/auth/callback'),
  DEFAULT_MODE: z.enum(['observe', 'assist', 'guardian']).default('observe'),
  SWAT_ALL_GUESSES: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  OPENAI_API_KEY: z.string().trim().default(''),
  OPENAI_MODEL_TEXT: z.string().trim().default('gpt-6-luna'),
  AI_MAX_CALLS_PER_MINUTE: z.coerce.number().int().min(0).max(600).default(30),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(8000),
  PREFILTER_THRESHOLD: z.coerce.number().min(0.05).max(1).default(0.35),
  TRIANGULATION_WINDOW_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  SWARM_MIN_USERS: z.coerce.number().int().min(2).max(50).default(3),
  SWARM_MIN_SCORE: z.coerce.number().min(0.5).max(100).default(3.0),
  DEMO_MODE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  MASCOT_NAME: z.string().trim().min(1).max(40).default('Swatty'),
});
export type Config = z.infer<typeof schema>;
export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Do not include Zod input values: invalid config can contain secrets.
    throw new Error(`Invalid configuration: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}. Check .env.example.`);
  }
  const c = parsed.data;
  const redirect = new URL(c.TWITCH_REDIRECT_URI);
  if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(redirect.hostname) ||
      redirect.port !== String(c.PORT) || redirect.pathname !== '/auth/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new Error('Invalid TWITCH_REDIRECT_URI: use http://localhost:PORT/auth/callback with the configured PORT.');
  }
  return c;
}
export function loadConfig(): Config {
  dotenv.config({ path: resolve(projectRoot, '.env'), quiet: true });
  return parseConfig(process.env);
}
export function configWarnings(config: Config): string[] {
  const missing = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'].filter(key => !config[key as keyof Config]);
  const warnings = missing.length ? [`Twitch connection unavailable: add ${missing.join(' and ')} to .env, then restart.`] : [];
  if (!config.OPENAI_API_KEY) warnings.push('No OpenAI key: classifying with built-in rules only.');
  return warnings;
}
// Reading chat is required for monitoring. Moderation scopes are requested at login but only
// needed for Assist/Guardian actions; a token without them still monitors in Observe mode.
export const readScopes = ['user:read:chat'];
export const moderationScopes = ['user:write:chat', 'moderator:manage:chat_messages', 'moderator:manage:warnings', 'moderator:manage:shield_mode'];
export const twitchScopes: string[] = [...readScopes, ...moderationScopes];
// Chain/venue names for the prefilter (§8.1). Extend freely.
export const chainNames = ['walmart', 'target', 'cvs', 'walgreens', 'starbucks', "mcdonald's", 'mcdonalds', '7-eleven', '7 eleven', 'costco', 'whole foods', 'trader joes', "trader joe's", 'dunkin', 'chipotle', 'subway', 'wendys', "wendy's", 'taco bell', 'burger king', 'kfc', 'home depot', 'best buy', 'kroger', 'safeway', 'publix', 'aldi', 'ikea', 'wawa', 'sheetz', 'circle k', 'shell station', 'chevron'];
