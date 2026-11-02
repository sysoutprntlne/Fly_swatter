import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// An offline presentation uses its own port and never loads Twitch credentials or saved tokens.
const args = process.argv.slice(2);
const port = args.length === 0 ? 3100 : args.length === 2 && args[0] === '--port' ? Number(args[1]) : NaN;
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Usage: node scripts/demo.mjs [--port 3100]');
  process.exit(1);
}
const root = new URL('..', import.meta.url);
if (!existsSync(new URL('server/dist/index.js', root)) || !existsSync(new URL('dashboard/dist/index.html', root))) {
  console.error('Build the app first with npm run build, or use npm run demo.');
  process.exit(1);
}
const child = spawn(process.execPath, ['server/dist/index.js'], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env,
    PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error',
    TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', OPENAI_API_KEY: '',
    TWITCH_REDIRECT_URI: `http://localhost:${port}/auth/callback`,
    DEFAULT_MODE: 'observe', DEMO_MODE: 'true', SWAT_ALL_GUESSES: 'false',
    PREFILTER_THRESHOLD: '0.35', TRIANGULATION_WINDOW_MS: '300000',
    SWARM_MIN_USERS: '3', SWARM_MIN_SCORE: '3',
    AI_MAX_CALLS_PER_MINUTE: '30', AI_TIMEOUT_MS: '8000', MASCOT_NAME: 'Swatty',
  },
});
console.log(`\nFly Swatter demo: http://localhost:${port}\nFictional chat only. Twitch and OpenAI credentials disabled.\nSelect Assist, choose IRL triangulation and press Play. Stop with Ctrl+C.\n`);
const stop = signal => { child.kill(signal); };
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', () => { console.error('Could not start the demo server.'); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : code ?? 1; });
