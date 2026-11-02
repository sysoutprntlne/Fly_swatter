# Fly Swatter — Codex build log

## 2026-10-28 · M1 foundation (verification pending)

Request: build the attached Fly Swatter specification from scratch in milestone order. Preserved the brief as AGENTS.md. Codex created npm workspaces, strict TypeScript, Fastify, Vite/React, plain CSS, ESLint, Vitest, config validation and redacted logging. The initial dashboard explicitly says monitoring is not active. No external deployment.

Node minimum is 22.12 (within the brief's Node 20+ requirement) to support the selected Vite version and the installed runtime. Credentials are optional for local startup; missing configuration is shown by name, never by value. The server binds only to loopback and rejects unexpected Host headers. No live scopes are requested before their features exist.

Validation results will be recorded after execution. The supplied .git directory is an empty read-only mount, so Git commits are unavailable here.

## Documentation verified before authentication implementation

- [Twitch authorization code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/): confidential local app, code exchange, random state.
- [Token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/): validate on startup and hourly; identity comes from validation; client ID must match.
- [Token refresh](https://dev.twitch.tv/docs/authentication/refresh-tokens/): official guidance recommends reactive refresh on 401 rather than assuming expiry is the only invalidation signal. Use reactive refresh with a single shared refresh operation and persist rotated refresh tokens.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): checked for the future classifier. No AI implementation or model selection before M5.

## Acceptance gates

M1 verification passed (see below). M2 requires a real broadcaster login and restart test; user will configure .env locally. Under AGENTS.md §18, M3 and later must wait for M2 acceptance. Fake upstream tests will be labeled as such, not substituted for live verification.

### M1 verification completed

`npm run check` passed: strict type checks, lint, 9 tests, production build. `npm run dev` starts Fastify on 127.0.0.1:3000 and Vite on 127.0.0.1:5173; missing credential names are reported. The environment requires elevated execution to bind local sockets. npm audit initially flagged older static-serving, Zod and Vitest dependencies; upgraded those packages to patched releases and obtained 0 vulnerabilities. M1 accepted; M2 implementation begins.


## 2026-10-28 · M2 Twitch authentication (live acceptance pending)

Codex implemented authorization-code login, browser-bound expiring state, token exchange, identity/client validation, atomic 0600 storage, startup/hourly validation, single-flight reactive refresh, safe failure status, and dashboard account display. No tokens are returned to the dashboard. Local session cookies and Origin checks protect the revalidation POST; Host validation rejects DNS rebinding. Error bodies, OAuth codes and credential values are excluded from logs.

Documentation clarification: OAuth credentials must travel to Twitch over HTTPS, so “secrets never leave the machine” means local-only storage and no disclosure to logs, UI or unrelated services. Only identity authentication is implemented; no chat/moderation scopes are requested yet. An httpOnly cookie alone does not prevent CSRF, so mutation checks also require an allowed Origin.

Validation: `npm run check` passed (21 tests, lint, strict types, server/dashboard builds). Tested real HTTP responses from localhost:3000 and Vite's localhost:5173 proxy. Rendered the production dashboard in an isolated headless Chrome profile and visually inspected `docs/setup.png`. npm audit reports zero vulnerabilities after dependency updates. The browser screenshot contains setup text only, no credentials.

Fixed during verification: initial package ranges selected vulnerable older static-serving/Zod/Vitest releases; updated to patched versions and reran the complete checks. The local execution sandbox forbids socket binding, so authorized elevated execution was needed to start the dev servers and inspect localhost. No public hosting is used.

Remaining gate: user is configuring `.env` locally. No real Twitch credentials or broadcaster session were present at the last check. Real login plus server-restart acceptance is **not claimed**. M3–M8, eval and stretch work have not started, following AGENTS.md §18: “Don't start a milestone until the previous one's acceptance criteria pass.”

## 2026-10-28 · Live sign-in troubleshooting

User reported that sign-in did not work. Confirmed the local dashboard returns HTTP 200 and login redirects to Twitch with the expected callback. Confirmed Twitch accepts the configured app credentials through a temporary client-credentials request; immediately revoked that diagnostic token and never printed or persisted it. The app had reported only “Re-login required,” losing the cause of the original failed exchange.

Added allowlisted login diagnostics distinguishing token exchange, account validation, and local storage failures. Diagnostics expose HTTP status or schema field names only, never upstream bodies, codes, token values, or raw exception text. Added three regression tests for safe diagnostics. All 24 tests, lint and type checks pass; production build checked as part of npm run check. A fresh browser authorization is required to identify the original failure; no live success is claimed yet.

## 2026-10-28 · No-permission OAuth scope handling

The user's retry localized the failure to the `scopes` field in Twitch's validation response. The login-only build requests no permissions. Updated the response schema to normalize missing/null scopes to an empty list; malformed non-array values remain invalid. Client ID, broadcaster identity and all required-scope checks remain strict. This handles the inferred no-grants response without inventing permissions. The raw response was not recorded, so null versus omitted is not claimed as observed.

Rechecked https://dev.twitch.tv/docs/authentication/validate-tokens/ : the documentation describes a String[] scope list but does not describe the empty-grant omission/null case. Added regression coverage for omitted, null and empty arrays across login and restart, and rejection of all three when a chat scope is required. Validation: 30 tests pass, lint and type checks pass. Live browser sign-in still needs a fresh attempt because the failed authorization code was already consumed.

## 2026-10-28 · OAuth browser-session recovery

User encountered invalid/expired state after a fresh Connect Twitch attempt. Synthetic local cookie round trips passed; the precise browser cause is not yet established. Found and fixed two flow weaknesses: alternate loopback hosts could set a cookie on 127.0.0.1 before Twitch returned to localhost, and simultaneous attempts shared one cookie name. Login now redirects to the configured callback host before issuing a cookie, and cookies are isolated per random state. Callback errors distinguish missing cookie, mismatched state, and consumed/expired/restarted state, with a fixed local restart URL. State expiry and one-use enforcement remain intact.

Added regression tests for host canonicalization, concurrent login cookies, and restart-versus-missing-cookie diagnostics. All 33 tests, lint, types and production build pass. Switching the active login test to npm start avoids development-watch restarts during authorization. Real OAuth completion still awaits the user's retry; these changes are not claimed to prove the exact previous browser failure.

## 2026-10-28 · M2 live acceptance

User confirmed the dashboard connected. The running local API independently reported connected=true with a validated broadcaster identity. Restarted the built server and checked authentication again to exercise token-file reuse and startup validation. No token values were printed. M2 live login and restart gate passed against the actual Twitch account: the post-restart check again reported connected=true and a broadcaster identity. M3 work is now allowed.


## 2026-10-28 · M3 EventSub and live dashboard feed (live chat check pending)

Continued after the real M2 login/restart gate passed. Added the read-only `user:read:chat` scope, preserving login-only sessions while requiring chat permission before any EventSub connection. Added the typed event bus, chat domain type, Helix subscription client, EventSub client, dashboard WebSocket and unfiltered chat panel. Identity always comes from token validation; no arbitrary channel input. Shared-chat events from other source channels are ignored. No message-sending or moderation APIs exist yet.

Official sources checked: [EventSub WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/), [chat subscription payload and scope](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage), and [subscription management](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/). Twitch requires prompt subscription after welcome, preserves subscriptions on directed handoff, and does not replay missed messages after an ordinary disconnect. Implemented distinct handling for both reconnect cases and surfaced gap limitations in the UI/README.

Validation: 45 tests pass, including real local fake-server WebSocket tests for mapping, routing, dedupe, keepalive loss, reconnect/resubscription, transferred sessions without resubscription, revocation, malformed events, foreign channel exclusion, 2,000-message memory cap and dashboard-origin rejection. Helix tests verify own-channel conditions, a single 401 refresh and bounded 429 retries. npm audit reported zero vulnerabilities after installing ws and its types. Type checks, lint and production build are run before starting the new version.

Remaining acceptance: user must grant the new read permission and type a test message in their own channel. Actual Twitch message delivery latency and real network-loss recovery have not been claimed. M4 remains behind the M3 live gate; synthetic tests do not substitute for that gate.

## 2026-10-30 · M3 review fixes

A code review of M3 found that a failed subscription after a reconnect was swallowed: the welcome handler marked the socket as welcomed before subscribing, and the catch block only reconnected while the status was `connecting`. The unsubscribed socket stayed in "reconnecting" until Twitch closed it for being unused. Subscription errors now always trigger the normal backoff reconnect. Added a regression test, and confirmed it fails without the fix. Helix now drains every subscription response body so connections are released. Replaced Fastify's deprecated top-level `disableRequestLogging` with a `LogController`. Validation: 46 tests, lint, strict types and production build pass. The M3 live gate (real chat message on the dashboard plus a network-loss recovery) is still pending and is not claimed.

## 2026-10-30 · M3 live acceptance

User granted `user:read:chat` and typed in their own channel while offline (going live is not required). The local API received both messages, about 0.34 s and 0.9 s after Twitch's message timestamp; the watcher polled once per second. The user reported the network-recovery check as working. However, the watcher never saw the status leave "connected", so a full keepalive-timeout reconnect against real Twitch was **not observed**. Automatic reconnect remains covered by the fake-server tests. M3 accepted on live delivery.

## 2026-10-30 · M4 demo mode

Added `Simulator` (`server/src/demo/simulator.ts`). It replays zod-validated scenario JSON onto the bus as `source: "demo"` chat messages and `raid` events, using an injectable clock. It supports play, pause/resume (keeping scenario time), speed changes mid-play (0.5×/1×/2×), reset, and "type as a viewer" injection. Account age from scenarios is kept for the later risk engine. Created the three scenario files with fictional places only. Malformed or out-of-order files are skipped.

Routes: `GET /api/demo/scenarios`, `POST /api/demo/{mode,play,pause,reset,inject}`, all validated. `/api/state` and the dashboard socket now include demo state, raids and clears. Dashboard: demo panel, DEMO badge, and a feed filtered by source, so live chat never mixes into a rehearsal.

Deviation from AGENTS.md §13.1: the CSRF session cookie was issued only after OAuth, which would block demo controls without Twitch. It is now issued by `GET /api/session` on dashboard load. Cross-site use is still blocked by SameSite=strict, the Origin allowlist and the Host check.

Incident: an interrupted write left a run of NUL bytes in `dashboard/src/theme.css`. It was stripped, and the source tree was scanned to confirm no other file was affected.

Validation: 59 tests pass (13 new: simulator timing, speed, pause/resume, reset, gating, injection, scenario loading, route auth and validation), plus lint, strict types and the production build. Acceptance: an isolated build on port 3100 had no Twitch credentials and no OpenAI key. It played "IRL triangulation" at 2× end to end through the HTTP API (15/15 events, raid fired, injected message ordered correctly). A headless Chrome screenshot (`docs/demo.png`) shows the dashboard mid-scenario. `.tokens.json` was untouched. M4 accepted. Next: M5 prefilter, classifier and rules fallback.

## 2026-10-30 · M5–M7 detection, triangulation, risk and actions (live M7 check pending)

The user asked to complete everything possible in one sitting without breaking the rules. Per §18, work stops at the M7 real-channel gate; M8 polish was not started.

**Docs verified this session.** Twitch API reference: Delete Chat Messages is `DELETE /moderation/chat`, 204, with optional `message_id`. **Omitting it clears the entire chat**, so the Helix client refuses any delete without a valid ID; a test covers this. Send Chat Message is `POST /chat/messages`, 200, `is_sent`. Warn Chat User is `POST /moderation/warnings`, 200, body `{data:{user_id,reason}}`, reason ≤ 500 characters. Update Shield Mode is `PUT /moderation/shield_mode`, 200. All match AGENTS.md. OpenAI: the models page lists `gpt-6-luna` as the cheapest model, and all current models accept images (`gpt-6.1-terra` noted for the vision stretch goal). Structured outputs use the Responses API `text.format` `json_schema` with `strict: true`. The brief did not name an API, so the Responses API was used, with `store: false`.

**Built.**
- Prefilter: rule groups, normalization, de-obfuscation, and rolling context.
- Classifier: batching, immediate path, budget, cache (never caches confirmations), 60 s AI retry, rules fallback.
- Place normalizer: abbreviations, glued suffixes, Jaro-Winkler token matching.
- Triangulation: per-user max, convergence bonus, confirmation bonus (including placeless replies), swarm emitted once, question pressure; mods and broadcaster excluded.
- Risk engine: decaying components, hysteresis, raid and account-age weights.
- Action engine: three modes, a single `execute()` choke point, dry runs for Observe and demo, dedupe, private broadcaster alert, Guardian warnings and Shield Mode.
- Helix moderation methods; pipeline orchestrator; `/api/mode` and `/api/shield`; dashboard panels (risk meter with level name and icon, triangulation clusters, fly feed, action log, mode radio group, aria-live level announcements).

**Deviations, all documented.**
- The overall-score formula from §10 caps a single signal at 70. Explicit floors were added: an active swarm is at least 75, and chat ≥ 70 (severe threat) is at least 50.
- Login now requests moderation scopes. Monitoring still needs only `user:read:chat`, so existing tokens keep working in Observe.
- Live-chat account-age lookups (`users.ts`, stretch M10) are not built; demo scenarios supply account ages.

**Bugs found while testing.**
- The hysteresis 20 s timer started at the next read, not at the drop. Fixed.
- The tool input layer converted `​` escapes into literal invisible characters, which tripped lint. The zero-width regex is now built from code points, and the source tree was checked for invisible characters.

**Eval (rules fallback, no key), 80 examples:** non-benign exact-category precision **93%** (target ≥ 85%); benign false-positive rate **8%** (target ≤ 10%); 95% of risky messages flagged as some risk. Seven misses: "which city has the best tacos", "Gotham looks like that street", "is that downtown? where exactly", a possessive "Mall's", "pretty sure that's Lindell Square", "yes!! that's Quillon Park" (guess, not confirmation), and spoken directions without an address. **Caveat:** the fixture was written in the same session as the rules, so these numbers are likely optimistic; the AI path has not been evaluated (no key).

**Validation.** 158 tests pass (unit tests for every §15 module, plus an end-to-end run of all three scenarios). Lint, strict types and the build pass. Isolated built server on port 3100 with no Twitch and no OpenAI, Assist mode, IRL scenario at 2×: risk 96, Swarm Incoming; "maple avenue" cluster with 5 chatters, score 5.94; 5 swats and 2 mod alerts, all dry runs. False-positive scenario: stays Quiet (only "best tacos" is flagged). Raid scenario: Brightwater Mall swarm. The screenshot is `docs/demo.png`. `.tokens.json` was untouched.

**Remaining gate (needs the user):** re-authorize with moderation permissions, then run the second-account test in Assist mode from README "Verify moderation live". Actual deletion, the in-chat alert and the absence of place text in chat have not been observed live, and are not claimed.

## 2026-10-30 · Location-blind hardening, QA pass on M5–M7

The user asked whether snoops could reverse-engineer deletions ("whatever disappears is the location"). Analysis: no. Fly Swatter never knows the true location, so decisions cannot depend on correctness. Residual signal: swarms form where viewers agree, and viewers agree more often on the truth. Added AGENTS.md §2.9 "Stay location-blind" and `locationBlindness.test.ts`, which replays identical chat naming Maple, Oak and a nonsense place and requires identical actions and risk. Added `SWAT_ALL_GUESSES` (env and dashboard toggle, default off) to delete every guess so deletions also hide crowd agreement. README now has mod tips (delete consistently, don't react on camera) and OBS stream-delay setup.

**QA findings (each fixed and covered by a regression test):**
1. **Meme numbers were deleted as addresses.** "69420", "11111" and any bare 5-digit number matched the ZIP rule: location_share, severity 3, deleted in Assist. "apple.com" matched the map-link rule. ZIPs now count only after `zip`/`postcode` or a US state code (e.g. "TX 78701"); the map rule requires `apple.co/`.
2. **Common phrases became location messages:** "looks like fun", "yeah that's funny", "100% agree", "i see you got…", "im here for…", "pull up the map", "SWAT 4". Split the rules into strong and weak groups, so weak phrasing counts only next to a real place. A placeless "yeah that's…" must explicitly confirm ("that's it/right"); otherwise it could attach to a recent guess and help build a fake swarm. Threat rules now need a target ("swat you", "get you swatted", "swat time").
3. **Expired clusters never left the dashboard.** The tick compared the pruned cluster count with itself. It now emits on any change in cluster id, mentions or score.
4. **Duplicate swarm alerts.** The level change and the new cluster each posted the swarm alert within milliseconds. Both now share the 60 s dedupe (§11.2).
5. **A failed manual Shield Mode returned HTTP 200.** It now returns 502 with the error, so the dashboard shows it.
6. **Rules-only mode waited 2 s to batch for nothing.** It now classifies immediately.
7. The idempotency set grew without limit over long streams. It is now capped.
Rule improvements found by eval misses: possessive place names ("Mall's"), "square", "pretty sure/that has to be", "yes!! that's", "where exactly", spoken directions, "corner of X and Y".

**Eval (rules fallback).** Tuning set (80 examples): 98% non-benign precision, 4% benign false positives. **These are overfit**, because the rules were tuned on this set. Added a **held-out set** (`holdout-messages.json`, 31 new fictional examples), measured once and never tuned on: **94% precision, 8% benign false positives (both meet targets), but only 79% of risky messages detected.** Misses include "where's this at??", "whats the name of this street", "bet you're at…" and "correct, that's…", plus one false positive ("is this the same camera…"). Rules-only recall is the honest weakness; the AI path is meant to close it but is unevaluated without a key.

**Validation.** 193 tests, lint, strict types, build, `npm audit` 0, no hidden or invisible characters in source. Built-server QA on port 3100 over HTTP:
- Security: no cookie, foreign Origin and a rebinding Host all get 403.
- False-positive scenario: Quiet (2.7). Raid: Swarm (Brightwater, 3 chatters). IRL: Swarm (maple avenue, 5 chatters).
- Injected memes ("69420", "looks like fun", "yeah thats true", "100% agree", "SWAT 4 is peak", "check apple.com"): 0 flagged.
- Swat-all + Guardian: a single vague guess is swatted (dry run).
- Demo Shield Mode: dry run.
All actions were dry runs; `.tokens.json` untouched. The M7 live gate is still pending.

## 2026-10-30 · Dashboard redesign (M8 in progress) with the taste skill

The user asked for the dashboard to be redesigned with the installed design skill (`.agents/skills/design-taste-frontend`, app-screen rules). Done by Claude Code following the skill's redesign run: record the before, deal a style, build, inspect, and look at the screenshots for three rounds.

**Before** (`inspect.mjs --app`): 5 FAIL, 7 WARN. Failures: no h1, tiny tracked uppercase labels, emoji (⚠ 📍), 46 text blocks under 11px, a brand line wrapping to 3 lines on phones. Only 2 of 8 blocks were on the first 1440×900 screen; the swarm view and fly feed started below the fold.

**Style.** The data-terminal style (seed 695119143), dark first. A streamer keeps the dashboard open beside OBS for a whole stream, often at night, and colour should mean danger only. Light mode maps the same roles under `prefers-color-scheme: light` (§13.4). Public Sans is self-hosted via `@fontsource-variable/public-sans`, so it makes no request to Google and still loads offline. Deviation from the sheet: no icon rail, because Fly Swatter has one screen; a top bar holds the product, the scope and the connection states instead.

**The screen's question:** "Is chat closing in on where I am, right now?" The risk figure and the swarm board form the top row. A finding line under the h1 is built from live data ("5 chatters are converging on one street guess. 5 would have been swatted this session (dry run)."). The mode switch and Shield Mode sit in the title row, one click away.

**Signature element: the swarm board.** One original fly per distinct chatter, lined up along a lane toward a pin, with the swarm threshold marked on the lane. Flies slide in as chatters join, and a swatted fly squashes. The lead cluster lists its mentions with category pills and a tally (messages, chatters, time span, swats). With no clusters, it shows location questions that name no place. Swatty (`Mascot.tsx`, original SVG) has four moods: eyes shut when quiet, glancing for a few flies, brows down when buzzing, mid-swing with motion lines at swarm. It appears in the top bar and on the risk card. Each level has its own shape (ring, dot, diamond, triangle) as well as its name, so colour is never the only signal.

**Risk timeline.** The last 5 minutes are sampled once a second in the browser tab. Gridlines sit on the level boundaries (25/50/75) and the bands are labelled with the level names. History starts when the page opens; nothing is invented before that.

**Other changes.** The demo controls are a one-line strip under the top bar, so they stay on the first screen during a pitch. The fly feed is a table: time, chatter and message, kind, confidence, action. The scenario picker now follows the scenario the server is playing (previously it could name a different one). ESLint ignores `.agents/**` (vendored skill browser scripts were failing `npm run check`); `.taste-skill/` (inspector output) is gitignored.

**After:** 0 FAIL, 2 WARN at 1440/768/390.
- `tiny-text`: 54% of text is the 12px meta size the dense style specifies.
- `panel-void`: 76px above the swarm board's pinned tally, which the skill allows as a total at a card's foot.

Skill lint: 0 FAIL; 1 WARN for the card shadow, which the dealt dark style specifies. Dark and light screenshots were checked for both the IRL scenario (Swarm Incoming, 94–95) and the false-positive scenario (Quiet, 3). `npm run check`: 193 tests, lint, types and build pass. Verified on an isolated built server on port 3100 with Twitch blanked and demo mode on; all actions were dry runs. `docs/demo.png` was refreshed (dark, IRL scenario).

**Incident.** Stopping the port-3100 server with `pkill -f "node dist/index.js"` also stopped the user's own `npm start` server on port 3000. `.tokens.json` was not touched. In future, stop isolated servers by their PID or job, never by command-line pattern.

## 2026-10-30 · Dashboard restyled as a specimen ledger (M8)

The user asked to replace the data-terminal dashboard with the look of the standalone wireframe-fly page (`specimen/index.html`), keeping every dashboard feature. Built by Claude Code with the impeccable and taste skills.

**Look.**
- Charcoal ground `#121211`, bone ink at stepped opacities, 1px hairlines at 8–22% opacity.
- IBM Plex Mono throughout, self-hosted via `@fontsource/ibm-plex-mono`, which replaces Public Sans.
- Labels are small tracked capitals; anything people read (chat, the finding, reasons) stays in sentence case.
- Blocks are ledger entries (a rule above, a label row) rather than boxes.
- Level colours are desaturated earth tones (sage, ochre, clay, faded brick), always beside the level's name and shape.
- Light mode is bone paper (`#ecebe6`) with the same roles (§13.4).
- Buttons depress to `scale(.96)` with an inset shadow over 150ms, feather on hover (0.3s), and give off a faint glow after a click.

**The specimen.** The top row is Risk | Specimen | Swarm (3 + 5 + 4 columns). `SpecimenFly.tsx` renders the procedural housefly; the geometry, ported to TypeScript, is in `flyGeometry.ts`.
- The fly stands for the snoops in chat: dim and slow at Quiet, brighter wire and a faster turn as the risk score climbs.
- It keeps the cursor spotlight, the pixel probe (`X Y | PX_VAL`, read from the canvas), drag-to-turn with inertia, and arrow keys.
- Reduced motion stops the turn and the parallax.

Swatty (`Mascot.tsx`) and the swarm-board flies are redrawn as hairline wire. Swatty stays in the top bar with its four moods.

**Unchanged:** the finding line, mode switch, Shield Mode, swarm board and tally, flagged-messages table, action log, response settings, demo strip, unfiltered chat, connection statuses, and every state and label.

**Checks.** `npm run check`: 193 tests, lint, types and build pass. Taste inspector (`--app`): 0 FAIL. Rules allowed because the user's brief asks for them: tracked capitals, monospace, 10px labels, and font-not-dealt (the stale Public Sans sheet). Two WARNs:
- heavy-borders: the inspector reads the 1px hairlines as solid colour.
- panel-void: blank space above the swarm board's pinned tally.

Captured on an isolated port-3100 server, stopped by its task ID this time: dark and light during the IRL scenario (95, Swarm Incoming), dark during the false-positive scenario (3, Quiet), and the phone layout. No console errors. `docs/demo.png` was refreshed.

## 2026-10-30 · Dashboard distilled to a minimal single column

The user asked for the ledger dashboard to be "extremely minimalist". This was an impeccable distill pass: no feature removed, secondary material behind disclosure, repeats cut.

**Layout.** One centred column, 880px wide:
- Top line: Swatty with the name, then connection state as plain words. Only a problem gets a colour.
- The demo strip.
- The wireframe fly with its quiet title.
- The answer: score (56px light), level name and shape, one finding sentence, the mode switch and Shield Mode.
- "Converging": swarm lanes, rendered only while a cluster exists.
- "Flies": one ledger of flagged messages (time, chatter, message, kind, action). The classifier's reasoning moved to a hover tooltip.
- Four closed rows: Risk breakdown (timeline and components), Actions, Chat, and Settings. Settings holds the mode's meaning, swat-all, the classifier, moderation, and the config warnings that used to be a banner.

**Cut as repeats.** The KPI-style risk block, the swarm mention list (the same messages are in Flies), the separate status chips, the rotation readout, and the at-rest "drag to turn" hint (the grab cursor says it). The pixel probe shows only while the pointer is over the fly. Shield Mode's label is shortened to "Shield Mode" / "Shield off".

**Checks.** `npm run check` passes (193 tests). Taste lint: 0 FAIL. Inspector `--app`: 0 FAIL, with the user-briefed rules allowed. Two WARNs:
- kpi-size: the one 56px figure is the screen's answer.
- no-data-hue: the only chart is in the closed breakdown row.

Captures: dark and light during the IRL scenario (95, Swarm Incoming), dark during the false-positive scenario (3, Quiet), and the phone layout. No console errors. The test server on port 3100 was stopped by its task ID. `docs/demo.png` was refreshed.

## 2026-10-30 · Title, hackathon line, and segmented risk and chat

At the user's request:
- The specimen heading now reads "Fly Swatter", with "Twitch × Codex Hackathon 2026" as the subtle line under it.
- The top-left title is removed. Swatty stays there as the home link (labelled "Fly Swatter, home"), so the mascot stays on screen (§13.3).
- The risk graph (5-minute timeline and components) and the live chat moved out of their closed rows into a two-part block under the fly and its score: one hairline frame with a hairline divider. It stacks on phones.
- Actions and Settings stay behind disclosure.

`npm run check` passes, taste lint has 0 FAIL, and an IRL-scenario capture was checked; `docs/demo.png` refreshed.

## 2026-10-30 · Plain-language pass for non-expert streamers and mods

The user asked to simplify the statistics and wording, assuming the streamer and mods don't know the jargon. This was a clarify pass, dashboard only. The server keeps its precise wording for logs and reports, and `dashboard/src/plain.ts` translates it.

- **Numbers become words.** Score parts show None / Low / Some / High / Very high, with the 0–100 number on hover. Classifier confidence is Not sure / Fairly sure / Very sure. "score 5.94" is gone from the converging lane. The big score is labelled "Danger score, out of 100".
- **Terms become everyday phrases:**
  - Triangulation → "People agreeing on a place"; Exposure → "What your camera shows".
  - Message kinds: "Asked where", "Guessed a place", "Agreed with a guess", "Says they're coming".
  - Swat / dry run → Delete / practice; Shield Mode → "Lock down chat" (the tooltip names Shield Mode).
  - Status line: "Twitch not set up", "Waiting for chat", "Basic detection".
- **Sentences instead of shorthand.** The finding says "5 people in chat agree on the street you're on. It would have deleted 5 messages, but this is practice mode, so nothing was deleted." The selected mode's meaning shows under the mode switch. The lane has a legend ("Each fly is one person…"). Action reasons and flag reasons are rewritten ("It was a guess about where you are. Reason: several people agreed on the same place.").
- Mode and level names (Observe / Assist / Guardian, Quiet … Swarm Incoming) are unchanged, so they still match the README and the mod alerts.

`npm run check` passes (193 tests). Taste lint: 0 FAIL. Inspector: 0 FAIL, 2 WARNs as before. Checked with the closed rows open during the IRL scenario.

## 2026-10-30 · Cursor effect removed; main buttons flicker on click

- Removed the cursor effect on the specimen: the spotlight around the pointer, the brighter wire near it, and the X/Y/PX_VAL readout. Drag-to-turn, arrow keys and the slight drift with the pointer remain.
- The main buttons (Lock down chat, the mode switch, and the demo Play, Reset and Send) now flicker for about 0.4s when clicked: uneven opacity steps 1 → .25 → 1 → .45 → .9 → .3 → 1, like a tube light catching. This replaces the glow pulse. The press depression stays, and reduced motion turns the flicker off.
- Verified in a real browser by sampling the button's opacity after a click. `npm run check` passes (193 tests); taste lint has 0 FAIL.

**Follow-up:** the user asked for the flicker to feel like static that briefly changes the button's shape. The opacity flicker became a 0.36s `static-burst`: the button tears into horizontal slices that jump sideways, squash and skew, with a faint offset ghost of the label, then snaps back. It uses clip-path insets, transforms and text-shadow in bone only. It was checked by freezing the animation at 9 moments and photographing the buttons. Reduced motion still turns it off. `npm run check` passes.

**Follow-up:** the user found the static disorienting and asked for something more subtle. The burst is now 0.22s with nudges of 1–2px, a lean of 3° at most, a squash or stretch of 3–5%, and a fainter label ghost. Opacity stays at 0.87 or above. The torn clip-path strips are gone, so the frame and label stay whole. Checked frame by frame; `npm run check` passes.

**Follow-up:** the user asked to remove the click effect entirely. The `static-burst` animation and its click listener are gone. Buttons keep the plain press (`scale(.96)` with an inset shadow) and the 0.3s hover fade. `npm run check` passes.

## 2026-10-30 · One-line description

Added a subtle one-line description under the "Fly Swatter" heading, later changed at the user's pick to "For the flies in chat that want to know where you are." It is in sentence case, 11px, in the muted tone (60%, which passes 4.5:1), above the hackathon line, and also set as the page's meta description. The fly sits slightly lower in its plate so the title block has room. `npm run check` passes.

## 2026-10-30 · Mod review board (chat)

The user asked for a place where mods can cross-check whether the model was right. Their choices: chat review now (there is no video feed; the OBS camera check was never built) and verdicts kept for the session only.

- **Dashboard.** Each row in Flagged messages opens into a review panel showing:
  - the four chat lines before it, with the message's place words highlighted
  - "What Fly Swatter noticed": the place named, the word signals in plain language (new `ruleLabel` in `plain.ts`), its call and why, how sure it was and whether that came from word rules or the AI, and what it did
  - Right call / Wrong call buttons; a wrong call lets the mod pick "It was really…"

  Clicking an active verdict again clears it. Rows carry a Right/Wrong tag, and the heading counts "· N checked".
- **Server.** New `Review` type, a `review` bus event broadcast to every dashboard, and in-memory storage in the pipeline (dropped on reset and when a flagged message ages out of the 1,000 cap). New protected route `POST /api/review` `{ messageId, verdict: "right" | "wrong" | null, shouldBe? }`, which 404s for messages the model never flagged. Nothing goes to Twitch or to disk.
- **Not built, by decision:** video clips. Twitch Clips were ruled out because clips are public and would publish the revealing moment (AGENTS.md §2.3). Local OBS replay-buffer clips remain possible later as an opt-in, because §2.7 says no frames go to disk by default.
- Rule reasons that repeated the category label were reworded (e.g. "Phrased as a guess and names a place").
- **Tests.** `server/test/review.test.ts` (3 tests): verdict set, replace and clear with bus events; only flagged messages accepted; cleared on reset; the route checks cookie and origin, validates input and returns 404. 196 tests pass. Driven end to end in a browser: opened a row, marked it wrong, picked "Asked where", and the server snapshot and the row tag agreed.

## 2026-11-02 · Release hardening under the two-hour shipping brief

**Request.** Assess the existing app and ship a dependable local release within a two-hour budget. Prioritized the existing MVP and its release checks; kept stretch features outside this pass. Preserved existing README edits, videos and reference artifacts.

**Fixed.** Practice Shield Mode no longer changes the action engine's knowledge of real Shield Mode. An automatic practice lockdown previously marked the live state as enabled, suppressing later Guardian protection; a practice unlock could erase knowledge of a real lockdown. Real state and practice state are now separate, with practice state cleared on reset. Observe dry-run deletions no longer accumulate real repeat-offender warnings.

Reset and mode changes now invalidate pending swarm follow-ups. Reset/stop also prevent a completed old classification from emitting a swarm, prevent pending action records from repopulating a cleared session, and clear trailing risk notifications. In-flight AI responses from before reset cannot update classifier status or cache; cached classifications are cleared between sessions, while call-budget history is retained. Shutdown stops the pipeline before closing the HTTP app. Requests already sent to Twitch cannot be undone.

**Release checks.** Added `npm run smoke`, which launches the compiled server on an isolated loopback port with Twitch/OpenAI credentials explicitly disabled. Through real HTTP and WebSocket connections it verifies compiled dashboard assets, initial Observe mode, Guardian practice actions, complete IRL and benign scenario playback, swarm/risk broadcasts, review verdicts, reset and foreign-origin rejection. It closes its own server afterward and leaves local credentials untouched. Added `docs/RELEASE.md` and corrected the README's live test: three low-confidence rules-only guesses do not necessarily meet the score threshold; five distinct viewers do. A separate fictional address provides a two-account deletion check.

Initial `npm run check` exposed lint scanning the untracked presentation video tree (including a bundled third-party library). Excluded `video/` from application lint, without changing the video files. The sandbox initially prevented local WebSocket binds; reran with loopback permission.

**Evidence.** `npm run check`: 209 tests passed across 20 files, type checks and lint passed, both production workspaces built. Production smoke passed. Held-out rules-only evaluation, run with the API key explicitly disabled: 94% exact-category non-benign precision, 8% benign false positives, 79% risky-message detection (31 examples). No tuning against the held-out examples. Added 13 regression tests for practice/live state separation, cancellation, dry-run warning history and classifier reset behavior. No API paths, scopes or models changed in this pass.

**Remaining gates.** M7 real-channel moderation acceptance and M8 first-time-viewer understanding are still unverified. This pass does not claim live Twitch or browser visual acceptance. No OBS, raid/account-age lookup, panic, incident reports, overlay or sound features added.

## 2026-11-02 · Assist deletion verified on Twitch

Guided the user through the live moderation check. Initial test messages came from the broadcaster account: the running pipeline correctly marked them non-deletable and produced private alerts. Confirmed Assist was selected, Practice was disabled and moderation permissions were granted. After instructions to send from a separate non-moderator viewer account, the user reported it working. The local action log independently confirmed a successful `delete_message` with `dryRun: false` while Assist was active and demo mode was off.

Updated README and release status to reflect this partial M7 acceptance. Live multi-user convergence and public mod-alert content remain pending, as do Guardian live behaviors and M8 first-time-viewer acceptance. No application code changed for this verification.

## 2026-11-02 · Requested automated verification after live deletion

The user asked Codex to test the app for them. Reran `npm run check`: all 209 tests across 20 files, type checks, lint and both production builds passed. Reran `npm run smoke` against a separate production server with credentials disabled: built assets, HTTP/WebSocket, simulated swarm, Guardian dry-run protection, review verdicts, reset, benign scenario and origin rejection passed. No application code changed. This verifies simulated multi-viewer behavior; the five-account live Twitch swarm/mod-alert check and first-time-viewer acceptance remain pending.

## 2026-11-02 · Production demo preparation

**Request.** Make the app ready to present for the Codex hackathon. Kept the existing local MVP and visual design, with an independent offline presentation workflow.

**Launch and rehearsal.** Added `npm run demo`: builds the production workspaces, then starts `scripts/demo.mjs` on localhost:3100 (custom port supported by the script). The launcher explicitly disables Twitch/OpenAI credentials, avoids loading the saved broadcaster session, overrides behavior settings for repeatable rules-only playback, and leaves `.env` untouched. It starts in Observe with Practice enabled, forwards shutdown signals and reports missing builds or invalid ports. The production smoke test now exercises this launcher and asserts that Twitch is unconfigured/disconnected and paid AI is disabled. Added `docs/DEMO.md` with a 90-second pitch, controls, recovery, current evidence and feature boundaries. Updated README/release instructions and the fictional screenshot.

**Dashboard.** Practice shows simulated viewers and a direct statement that Twitch stays unchanged. Live Twitch setup warnings stay out of the practice presentation. The title and fly occupy separate vertical space in Practice, preserving the fly while avoiding text overlap on phones. Added the original swatter as a favicon after browser QA caught the missing default icon. Fixed playback speed synchronization between dashboards. Reworded location findings as unverified guesses and explained that both viewer count and confidence determine a swarm; the screen never claims chat found the real location.

**Reliability.** Dashboard controls share local-session bootstrap, so a first click waits for the cookie. After a server restart rejects an old cookie, a control renews the local session and retries once. Added three regression tests covering shared initialization, restart recovery and bounded retries.

**Verification.** `npm run check` passed with 212 tests across 21 files, types, lint and production builds. The production smoke passed through the new launcher. Rebuilt and linted the final CSS/favicon changes. Headless Chrome drove the built UI through Assist practice, speed selection, pause/resume, full IRL swarm, review verdict, reset and the harmless scenario. Verified keyboard focus, no horizontal overflow at 1440/768/390, light/dark and reduced-motion rendering, and no browser errors. Screenshots inspected and saved under `.taste-skill/release-demo/`; `docs/demo.png` refreshed with fictional chat only. Stopped the owned preview server after QA.

**Design check.** Applied design-taste-frontend and retained the existing Data terminal direction (seed 695119143), IBM Plex Mono and original fly, with no redraw. The screen's question is whether chat is converging on a guess; the risk figure answers first, the fly remains the product's face and the clusters supply evidence. Inspector: 0 FAIL, 3 WARN. Kept prior documented allowances for micro labels, the existing font, monospace and small metadata. Warnings are justified: the 56px score is the one leading danger figure; a Quiet zero trace stays neutral; the border warning ignores rgba alpha (the checker forces alpha to 1), while the actual low-opacity rules remain quiet in the screenshots. Source taste lint: 0 FAIL; inherited mono and button press shadows retained.

Live multi-account swarm/public alerts, Guardian live behavior and first-time-viewer acceptance remain pending. Browser QA does not replace those checks. No external API contracts or model names changed, and no public hosting or OBS/stretch features were added.

## 2026-11-02 · Launch film, gallery and public-repo preparation

Done with Claude Code, not Codex. Built a launch film with HyperFrames from real practice-mode captures, Kokoro narration and catalog music. Made brand images in `docs/brand/` and explanatory Devpost images in `docs/gallery/`, using dashboard crops from the offline practice server. All footage uses fictional chat.

Before publishing, scanned the working tree and history for secret patterns and the local Twitch credentials and tokens: no matches. Added the MIT license notice for the vendored `design-taste-frontend` skill. `video/`, `docs.zip` and `docs/video-reference/` stay local because of size and unverified music licensing. `npm run check` passes with 212 tests, and the production smoke test passes.

Tool history to confirm before publishing claims about it: local Codex sessions for this project are dated Oct 28 and Nov 2, and Claude Code sessions are dated Oct 28, Oct 30–31 and Nov 2. Live swarm and mod-alert acceptance remains pending.

## 2026-11-02 · Public GitHub release preparation with Codex

The user requested a public GitHub release. Inspected the clean release branch and existing private origin, fetched remote state, and scanned all 241 reachable history blobs for common credential patterns and exact local Twitch/OpenAI credential values without printing them. No matches, tracked private runtime files or blobs over 50 MiB were found. Local video material remains excluded.

Added GitHub Actions for reproducible Node 22 installation, type checks, lint, tests, production builds and the credential-free production smoke. Documented the initial v0.1.0 public preview as a source release with the dashboard remaining local. The sandbox blocks loopback test servers; release verification therefore runs with loopback permission. Existing live swarm/mod-alert, Guardian and first-time-viewer acceptance limitations remain explicit. No application behavior, API contracts or model names changed.

Release verification passed: all 212 tests across 21 files, type checks, lint, both production builds and the real HTTP/WebSocket production smoke (swarm, dry-run protection, reviews, reset, benign scenario and origin rejection).
