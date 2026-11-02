# Fly Swatter · presenter guide

## Launch

From the project root, with Node.js 22.12+ and dependencies installed:

```sh
npm run demo
```

Open **http://localhost:3100**. This command builds the production app, then starts a separate offline presentation server. It overrides Twitch and OpenAI credentials, starts in Observe with Practice enabled, uses the built-in rules and leaves your `.env` and saved Twitch login untouched. It cannot moderate your real channel. The normal app can continue on port 3000.

For another rehearsal with an unchanged build:

```sh
node scripts/demo.mjs
```

Use `node scripts/demo.mjs --port 3200` if 3100 is occupied. Stop with Ctrl+C.

## A 90-second pitch

| Time | Show | Say |
| --- | --- | --- |
| 0–15 s | Quiet dashboard, Practice notice | “Viewers can work together to locate an IRL streamer. Fly Swatter watches that collective behavior.” |
| 15–40 s | Select Assist, IRL triangulation, 1×, Play | “One viewer asks where. Others guess and confirm the same street. Each fly represents a different person.” |
| 40–55 s | Swarm, flagged messages, open What Fly Swatter did | “It detects convergence and would delete the contributing messages. This is fictional chat; Twitch is unchanged.” |
| 55–70 s | Open one flagged message, show review controls | “A moderator can inspect the evidence and mark a wrong call. Reviews stay local to the session.” |
| 70–80 s | Select False positive check, 2×, Play | “Talking about a hometown, a game or a coffee shop shouldn’t cause a swarm.” |
| 80–90 s | Close on the product | “It never knows where you actually are. It reacts to chat behavior, defaults to Observe and leaves people in control. Built with OpenAI Codex.” |

Finish on harmless chat, then replay IRL triangulation if the audience wants another look at the swarm.

## Presenter controls

- **Pause / Resume** keeps the scenario position. **Reset** clears simulated chat, risk, actions and reviews.
- Playing a different scenario starts a fresh practice session. At 2×, IRL takes about 12 seconds and False positive check about 10 seconds.
- **Type as a viewer** allows an audience member's fictional message. Change the viewer name to represent a different person. Repeating one user's guess does not create a multi-user swarm.
- If a request fails after restarting the server, controls renew their local session automatically once. The dashboard reconnects and receives a fresh snapshot.

## Evidence and boundaries

The release has automated unit/integration coverage and a production HTTP/WebSocket smoke test. Real Twitch Assist deletion was verified separately. Live multi-account convergence and public mod alerts still need acceptance; so do Guardian's live warning/Shield behavior and a first-time viewer's understanding.

The offline demo uses rules, not an AI API call. The app supports optional OpenAI classification during normal use. OBS video analysis, live raids/account-age lookups, panic, reports, overlay and sounds are outside this release. Do not present them as working features.

## Recovery

Use Reset and replay if the story gets interrupted. If the page disconnects, restart `node scripts/demo.mjs` and reload http://localhost:3100. If the build is missing or changed, use `npm run demo`. Keep this private dashboard off the actual stream; a screen recording for the pitch should use only this fictional offline session.
