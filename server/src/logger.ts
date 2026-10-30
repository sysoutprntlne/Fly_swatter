import pino from 'pino';
import type { Config } from './config.js';
export function createLogger(level: Config['LOG_LEVEL'] = 'info', stream?: pino.DestinationStream) {
  const options: pino.LoggerOptions = {
    level,
    redact: { paths: ['access_token', 'refresh_token', 'client_secret', 'apiKey', 'token', '*.access_token', '*.refresh_token', '*.client_secret', '*.apiKey', '*.token', 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'TWITCH_CLIENT_SECRET', 'OPENAI_API_KEY', 'OBS_WS_PASSWORD'], censor: '[REDACTED]' },
    // OAuth query strings contain codes. Do not serialize URLs, headers or bodies.
    serializers: { req: req => ({ method: req.method }), res: res => ({ statusCode: res.statusCode }), err: () => ({ message: 'Internal failure; sensitive details omitted' }) },
  };
  return stream ? pino(options, stream) : pino(options);
}
