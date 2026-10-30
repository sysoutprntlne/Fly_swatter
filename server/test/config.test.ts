import { describe, expect, it } from 'vitest';
import { configWarnings, parseConfig } from '../src/config.js';
describe('configuration', () => {
  it('starts locally in Observe mode and names missing credentials', () => {
    const c = parseConfig({});
    expect(c.HOST).toBe('127.0.0.1'); expect(c.DEFAULT_MODE).toBe('observe');
    expect(configWarnings(c)[0]).toContain('TWITCH_CLIENT_SECRET');
  });
  it.each([{ PORT: 'abc' }, { HOST: '0.0.0.0' }, { DEFAULT_MODE: 'chaos' }, { TWITCH_REDIRECT_URI: 'https://evil.test/auth/callback' }, { PORT: '3001' }])('rejects invalid or unsafe config: %j', env => expect(() => parseConfig(env)).toThrow('Invalid'));
  it('never echoes invalid values in diagnostics', () => expect(() => parseConfig({ LOG_LEVEL: 'secret-value' })).toThrow(/^Invalid configuration: LOG_LEVEL\./));
});
