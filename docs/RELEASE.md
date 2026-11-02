# Local release procedure

## Public source release

The initial public preview is `v0.1.0`. Download the tagged source or clone the repository, install with `npm ci` on Node.js 22.12+, then run `npm run demo` for the offline presentation. No accounts or API keys are needed for the demo. This release distributes source; it does not host the private dashboard.

GitHub Actions runs type checks, lint, tests, production builds and the credential-free smoke test on main and pull requests. Keep `.env`, saved tokens, incident reports and local video material out of commits and release attachments. The release notes must retain the live-verification limitations below.

## Local verification

Fly Swatter ships as a private local app. The release candidate has offline regression and production smoke coverage. Assist deletion passed on a real Twitch channel; live swarm/mod-alert and first-time-viewer acceptance remain pending.

## Build and rehearse

Use Node.js 22.12+ from the repository root:

```sh
npm ci
npm run check
npm run smoke
node scripts/demo.mjs
```

Open http://localhost:3100. The dedicated demo launcher starts in Practice with Twitch and OpenAI credentials disabled. Select Assist and play IRL triangulation at 2×. Confirm the danger score rises to Swarm Incoming, several people appear around the same guess, and actions say Practice. Reset, then run False positive check: risk should stay Quiet or A Few Flies. Both scenarios work without API credentials. See [the presenter guide](DEMO.md) for the pitch. Use `npm start` and http://localhost:3000 for normal use with your own configuration.

`npm run smoke` automates the production HTTP/WebSocket checks on its own temporary port, with credentials disabled. It checks the built page and assets, scenario playback, a swarm, Guardian dry runs, review verdicts, reset, benign risk and rejected foreign origins. It does not verify browser rendering or Twitch permissions.

## Remaining acceptance

1. Follow README → **Verify moderation live (M7 acceptance)** with the authenticated broadcaster and a separate viewer account. A fictional shared address tests deletion with two accounts; the convergence check needs multiple distinct viewers. Record the result and date in BUILD_LOG.md. Return to Observe afterward.
2. Show a person unfamiliar with the app the first ten seconds of the IRL practice scenario. Ask them to explain what chat is doing and whether Twitch is being changed. Record whether they identify the location guesses, increasing danger and practice status. This is the M8 acceptance gate.

The current source has no OBS exposure scorer, live raid/account-age integration, panic button, incident export, public overlay or sounds. Those features are outside this release. Rules-only detection misses some risky phrasing; the held-out set catches 79% of risky messages.

## Stop or recover

Switch to Observe to stop automatic moderation. Requests already sent to Twitch may still complete. Observe does not switch off a previously enabled Shield Mode: use **End lockdown** explicitly if needed. Stop the server with Ctrl+C; restart with `npm start`. A restart clears chat, reviews and risk history, and the saved Twitch login is reused when valid. Startup mode follows `DEFAULT_MODE` in `.env` (Observe by default).

No public hosting or deployment is part of this release. Keep the dashboard on loopback and off stream.
