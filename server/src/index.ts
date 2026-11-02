import { loadConfig, configWarnings } from './config.js';
import { Bus } from './bus.js';
import { TwitchAuth } from './twitch/auth.js';
import { Helix } from './twitch/helix.js';
import { EventSub } from './twitch/eventsub.js';
import { createApp } from './server/http.js';
import { Simulator, loadScenarios } from './demo/simulator.js';
import { Pipeline } from './pipeline/index.js';
import { OpenAiClient } from './pipeline/classifier.js';

try {
  const config = loadConfig();
  const auth = new TwitchAuth(config);
  const bus = new Bus();
  const helix = new Helix(config.TWITCH_CLIENT_ID, auth);
  const receiver = new EventSub({ bus, getSession: () => auth.getChatSession(), subscribe: (id, signal) => helix.subscribeChat(id, signal) });
  const simulator = new Simulator(bus, loadScenarios(), config.DEMO_MODE);
  const pipeline = new Pipeline({
    bus, config, moderation: helix, isDemo: () => simulator.enabled(),
    ai: config.OPENAI_API_KEY ? new OpenAiClient(config.OPENAI_API_KEY, config.OPENAI_MODEL_TEXT) : undefined,
    streamer: () => auth.status().login ?? 'the streamer', accountAgeDays: userId => simulator.accountAgeDays(userId),
  });
  const app = await createApp(config, auth, { bus, receiver, simulator, pipeline });
  pipeline.start();
  for (const warning of configWarnings(config)) app.log.warn(warning);
  await app.listen({ host: config.HOST, port: config.PORT });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    pipeline.stop();
    await app.close();
    app.log.flush();
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
} catch (error) {
  // Config errors only name keys. Never print arbitrary upstream exceptions.
  const message = error instanceof Error && error.message.startsWith('Invalid ') ? error.message : 'Startup failed. Check the local port and configuration.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
