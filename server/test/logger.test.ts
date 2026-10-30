import { expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';
it('redacts credentials and omits callback query strings', () => {
  let output = '';
  const log = createLogger('info', { write: line => { output += line; } });
  log.info({ access_token: 'access-secret', refresh_token: 'refresh-secret', client_secret: 'client-secret', req: { method: 'GET', url: '/auth/callback?code=code-secret', headers: { cookie: 'cookie-secret' } }, err: new Error('error-secret') }, 'Test');
  for (const secret of ['access-secret','refresh-secret','client-secret','code-secret','cookie-secret','error-secret']) expect(output).not.toContain(secret);
  expect(output).toContain('[REDACTED]');
});
