# AGENTS.md — Fly Swatter 🪰

> Context file for a Codex agent building this project from scratch.
> Read this entire file before writing any code. When anything here conflicts with the current official Twitch, OBS, or OpenAI documentation, **the official documentation wins** — verify endpoint paths, scopes, payload shapes, and model names against the live docs before relying on them, and note any correction in `BUILD_LOG.md`.

---

## 0. TL;DR

Fly Swatter is a **private AI safety moderator for Twitch streamers**, especially IRL streamers. It watches Twitch chat (via EventSub) and, optionally, the streamer's own video feed (via OBS WebSocket) for signs that viewers are trying to figure out where the streamer physically is. Its signature feature is **triangulation detection**: noticing when several different chatters converge on the same location guess, which is how real-world stalking, stream sniping, and swatting setups often begin.

It then acts according to a risk level: deleting location-revealing messages, quietly alerting moderators, optionally enabling Shield Mode, and showing everything on a private, playful dashboard starring an original mascot (a fly swatter who swats "flies" — the snoops buzzing around chat).

Built for the **OpenAI Codex x TwitchCon Hackathon**. Hard requirements from the hackathon:
1. It must connect to Twitch (Twitch API, EventSub, chat, Extensions, or overlays). We use EventSub, Helix chat/moderation APIs, and an overlay-style dashboard.
2. It must be built with OpenAI Codex. Keep `BUILD_LOG.md` updated (see §17).

---

## 1. Problem statement (why this exists)

- Swatting and stalking of streamers are ongoing, serious problems, and many recent incidents involve **IRL streams in public places**, where the location leaks through the stream itself rather than through a home address.
- Viewers locate IRL streamers by piecing together visual cues (street signs, storefronts, landmarks) and by **crowdsourcing guesses in chat** ("is that the CVS on Main?" → "yeah that's Main St"). Chat effectively becomes a real-time location-finding tool.
- Standard safety advice is manual: add a stream delay, avoid showing signs, and have a dedicated remote moderator watch chat for oddly specific location questions. Most small and mid-size streamers don't have a dedicated safety mod.
- Existing tools (e.g., Streamlabs' privacy filters, prior hackathon projects using YOLO to blur street signs) focus on **blurring video**. Nothing mainstream watches **chat collectively triangulating** a location. That gap is our differentiator.

**One-sentence pitch:** "Fly Swatter gives every IRL streamer the protection of a dedicated safety mod: it catches chat crowdsourcing your location, swats the snoops, and warns your mods before anyone shows up."

---

## 2. Non-negotiable safety and ethics rules

These are product requirements, not suggestions. Every module must respect them.

1. **Never infer or output a real-world location.** The exposure scorer (§9) rates *how locatable* a frame is and *what kind* of cue caused it. It must never output a place name, address, coordinates, or a "best guess" of where the streamer is. Enforce this in the prompt, in the JSON schema (no fields for location), and with a post-processing check that drops any free-text containing obvious place names or coordinates.
2. **Only analyze the authenticated broadcaster's own channel and own OBS feed.** No mode that accepts an arbitrary channel name or stream URL for analysis. The broadcaster ID always comes from the OAuth token, never from user input. This prevents the tool from becoming a way to locate *other* streamers.
3. **Never repeat a detected location anywhere public.** Bot messages in chat, warnings to users, and moderator alerts sent in chat must never contain the place that was guessed. ("Swatted a location guess" — never "Swatted a guess about Main St".) Place text appears only on the private dashboard.
4. **Never contact police, 911, or any authority automatically.** The escalation feature only *prepares* an incident report the streamer can choose to use. A human always decides.
5. **Default to the least intrusive action.** Start in Observe mode on first run. Deleting messages and enabling Shield Mode require the streamer to have chosen a mode that allows it.
6. **Don't punish innocent viewers harshly.** Default actions are delete + optional warning. Timeouts/bans are never automatic in the default config.
7. **Minimize data retention.** Don't store video frames to disk by default. Chat logs are kept in memory for the session; incident reports are written only when the streamer exports one.
8. **Secrets never leave the machine.** Tokens live in a gitignored local file. Never log tokens or API keys.
9. **Stay location-blind.** Fly Swatter must never be given, store, or infer the streamer's true location (no config, prompt, or setting for it), and no action may depend on whether a chat guess is *correct*. Deletions are decided only by how chat behaves (phrasing, confidence, how many chatters converge). Otherwise deleting the right guesses would confirm them to snoops. Exposure scoring may raise the overall risk level but must never be compared with chat place guesses. The optional `SWAT_ALL_GUESSES` setting deletes every guess so deletions also hide which guess the crowd agrees on. Enforced by `server/test/locationBlindness.test.ts`.

---

## 3. Feature scope

### MVP (must ship — build in this order)
1. Twitch OAuth (authorization code flow, localhost) and token storage/refresh/validation.
2. EventSub WebSocket client receiving `channel.chat.message` for the broadcaster's channel.
3. Rule-based prefilter that scores every message and flags candidates.
4. AI classifier (OpenAI, structured JSON output) for flagged candidates, batched.
5. Triangulation tracker: clusters place mentions across users in a sliding window.
6. Risk engine: combines signals into a 0–100 score and a named level with hysteresis.
7. Action engine: delete messages, send mod alert messages, per-mode policy, dry-run support.
8. Private dashboard (web) with live risk meter, fly feed, swarm view, action log, mode controls.
9. **Demo mode**: scripted chat simulator that runs the whole pipeline without Twitch (for a reliable on-stage demo).

### Stretch (only after MVP works end to end)
10. Exposure scorer using OBS WebSocket screenshots + vision model.
11. Raid awareness (`channel.raid` EventSub) and new-account weighting.
12. Shield Mode activation at the highest level; panic button (switch OBS to a BRB scene + Shield Mode).
13. Incident report export (Markdown + JSON) for the streamer to optionally share with local authorities or an anti-swatting registry.
14. Chat warnings via the Warn Chat User endpoint.
15. Sound effects and swat animations polish.

### Explicitly out of scope
- Blurring/editing the video stream itself (others do this; not our differentiator).
- Audio transcription of the streamer's speech (possible future work slide).
- Doxx audits of data broker sites (paid services already do this).
- Any feature that analyzes channels other than the authenticated broadcaster's.
- Contacting authorities automatically.

---

## 4. Tech stack

Use these unless there's a strong reason not to (document deviations in `BUILD_LOG.md`).

- **Runtime:** Node.js 20+ with **TypeScript** (strict mode).
- **Package manager:** npm workspaces (monorepo with `server` and `dashboard`).
- **Server:** Fastify (HTTP + static serving) and `ws` (for both the EventSub client and the dashboard socket).
- **Dashboard:** Vite + React + TypeScript. Plain CSS with CSS variables (no Tailwind compiler needed). Framer Motion is fine for fly/swat animations.
- **Validation:** `zod` for config, AI outputs, and Twitch payloads.
- **Logging:** `pino` with a redaction list for tokens/keys.
- **AI:** official `openai` Node SDK, using structured outputs (JSON schema). Model names come from env vars — **check the current OpenAI docs** for a fast, inexpensive text model and a vision-capable model and put them in `.env.example`.
- **OBS:** `obs-websocket-js` (v5 protocol; OBS 28+ has obs-websocket built in, default port 4455).
- **Fuzzy matching:** a small string-similarity helper (implement Jaro-Winkler or token-set ratio yourself, or use a tiny dependency).
- **Tests:** `vitest`.
- **Optional dev tool:** the Twitch CLI (`twitch`) for minting test tokens and possibly mocking EventSub WebSocket events. Verify which event types its mock WebSocket server supports before relying on it; demo mode (§12) is the guaranteed fallback.

---

## 5. Repository layout

```
fly-swatter/
├── AGENTS.md                 # this file
├── BUILD_LOG.md              # Codex usage log for judges (§17)
├── README.md                 # setup + run + demo instructions
├── .env.example
├── .gitignore                # must include .env, .tokens.json, reports/, node_modules
├── package.json              # npm workspaces: ["server", "dashboard"]
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  # boot: config → auth → pipeline → http/ws
│       ├── config.ts                 # zod-validated env + runtime settings
│       ├── logger.ts
│       ├── types.ts                  # shared domain types (see §6)
│       ├── bus.ts                    # typed in-process event bus
│       ├── twitch/
│       │   ├── auth.ts               # OAuth code flow, refresh, validate loop
│       │   ├── helix.ts              # thin Helix client w/ rate-limit handling
│       │   ├── eventsub.ts           # EventSub WebSocket client
│       │   └── users.ts              # user lookup + account-age cache
│       ├── pipeline/
│       │   ├── prefilter.ts
│       │   ├── classifier.ts         # batching + OpenAI structured output
│       │   ├── placeNormalizer.ts
│       │   ├── triangulation.ts
│       │   ├── exposure.ts           # stretch: OBS screenshot → vision score
│       │   ├── riskEngine.ts
│       │   └── actionEngine.ts
│       ├── obs/
│       │   └── obsClient.ts
│       ├── demo/
│       │   ├── simulator.ts
│       │   └── scenarios/
│       │       ├── irl-triangulation.json
│       │       ├── false-positive-check.json
│       │       └── raid-swarm.json
│       ├── reports/
│       │   └── incidentReport.ts
│       ├── server/
│       │   ├── http.ts               # Fastify routes (§11)
│       │   └── dashboardSocket.ts    # pushes state to dashboard
│       └── prompts/
│           ├── classifier.system.md
│           └── exposure.system.md
│   └── test/
│       ├── prefilter.test.ts
│       ├── placeNormalizer.test.ts
│       ├── triangulation.test.ts
│       ├── riskEngine.test.ts
│       ├── actionEngine.test.ts
│       └── fixtures/labeled-messages.json   # eval set (§15)
└── dashboard/
    ├── package.json
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── socket.ts
        ├── theme.css
        ├── components/
        │   ├── Mascot.tsx            # original SVG mascot, multiple moods
        │   ├── RiskMeter.tsx
        │   ├── FlyFeed.tsx
        │   ├── SwarmView.tsx
        │   ├── ExposureMeter.tsx
        │   ├── ActionLog.tsx
        │   ├── ModeControls.tsx
        │   ├── PanicButton.tsx
        │   └── ReportButton.tsx
        └── assets/sounds/            # short original or CC0 swat/buzz sounds
```

---

## 6. Core domain types

Define these in `server/src/types.ts` and share them with the dashboard (copy or a small shared package).

```ts
export type RiskLevel = "quiet" | "few_flies" | "buzzing" | "swarm";

export type Mode = "observe" | "assist" | "guardian";

export interface ChatMessage {
  id: string;                 // Twitch message_id
  userId: string;
  userLogin: string;
  userName: string;
  text: string;
  timestamp: number;          // ms epoch (from EventSub metadata)
  isBroadcaster: boolean;
  isModerator: boolean;
  isVip: boolean;
  isSubscriber: boolean;
  replyToMessageId?: string;
  source: "twitch" | "demo";
}

export interface PrefilterResult {
  messageId: string;
  score: number;              // 0..1
  matchedRules: string[];     // rule ids
  candidate: boolean;         // score >= threshold
}

export type Category =
  | "location_question"       // "what city is that?"
  | "location_guess"          // "is that the CVS on Main?"
  | "location_confirmation"   // "yeah that's Main St"
  | "location_share"          // posting an address / coordinates / precise directions
  | "approach_intent"         // "I'm coming", "I'm nearby", "on my way"
  | "swat_or_threat"          // threats of violence, "calling the cops on you"
  | "benign";

export type Granularity =
  | "none" | "country" | "region" | "city"
  | "neighborhood" | "street" | "venue" | "exact";

export interface Classification {
  messageId: string;
  category: Category;
  confidence: number;         // 0..1
  severity: 0 | 1 | 2 | 3;    // 3 = most dangerous
  place?: {
    rawText: string;          // span as written in chat
    canonical: string;        // model's normalized name, lowercase
    granularity: Granularity;
  };
  rationale: string;          // short, for dashboard only
  source: "ai" | "rules_fallback";
}

export interface PlaceCluster {
  id: string;
  canonical: string;          // representative place text (dashboard only!)
  granularity: Granularity;
  mentions: Array<{ messageId: string; userId: string; category: Category; confidence: number; at: number }>;
  distinctUsers: number;
  score: number;              // see §8
  firstSeen: number;
  lastSeen: number;
  isSwarm: boolean;
}

export interface ExposureReading {
  at: number;
  granularityExposed: Granularity;
  score: number;              // 0..100
  cues: Array<{ type: ExposureCueType; description: string }>;
  recommendation: string;
}

export type ExposureCueType =
  | "street_sign" | "storefront" | "landmark" | "license_plate"
  | "house_number" | "transit" | "document" | "screen" | "other";

export interface RiskState {
  score: number;              // 0..100
  level: RiskLevel;
  components: { chat: number; triangulation: number; exposure: number; raid: number };
  updatedAt: number;
}

export interface ActionRecord {
  id: string;
  at: number;
  kind: "delete_message" | "mod_alert" | "warn_user" | "shield_mode_on" | "shield_mode_off"
      | "obs_brb_scene" | "report_prepared";
  targetMessageId?: string;
  targetUserId?: string;
  dryRun: boolean;
  success: boolean;
  error?: string;
  reason: string;             // dashboard only, may mention category but never place text in chat
}
```

All modules communicate through the typed event bus (`bus.ts`) with events like `chat.message`, `prefilter.result`, `classification`, `cluster.updated`, `exposure.reading`, `risk.updated`, `action.taken`. The dashboard socket subscribes to the bus and forwards relevant events.

---

## 7. Twitch integration details

> Verify every endpoint, scope, and payload against https://dev.twitch.tv/docs before implementing. The details below are a starting point.

### 7.1 App registration (manual, by the human)
- Create an application in the Twitch Developer Console.
- OAuth redirect URL: `http://localhost:3000/auth/callback`.
- Category: anything appropriate (e.g., Chat Bot or Application Integration).
- Put the Client ID and Client Secret in `.env`.

### 7.2 OAuth
- Use the **authorization code grant** flow:
  - `GET /auth/login` on our server redirects to `https://id.twitch.tv/oauth2/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `scope` (space-separated), and a random `state` (validate it on callback).
  - `GET /auth/callback` exchanges the code at `https://id.twitch.tv/oauth2/token` for an access token + refresh token.
- Store tokens in `.tokens.json` (gitignored), with `obtainedAt` and `expiresIn`.
- On startup and then **every hour**, call `GET https://id.twitch.tv/oauth2/validate`; Twitch requires apps to validate tokens periodically. Use the response to get the `user_id` and `login` — this is the **broadcaster ID** (rule §2.2: it always comes from the token).
- Refresh with `grant_type=refresh_token` on 401 or before expiry. If refresh fails, surface "Re-login required" on the dashboard.
- **Assumption for the MVP:** the streamer authorizes with their own broadcaster account, so the token user is both broadcaster and moderator. (A later version could use a separate bot account that is a mod in the channel; if you implement that, `moderator_id` and `sender_id` become the bot's user ID.)

### 7.3 Scopes to request (verify names in docs)
- `user:read:chat` — receive `channel.chat.message` over EventSub.
- `user:write:chat` — send chat messages (mod alerts / bot notices).
- `moderator:manage:chat_messages` — delete chat messages.
- `moderator:manage:shield_mode` — read/update Shield Mode (stretch).
- `moderator:manage:warnings` — warn chat users (stretch).
- `moderator:read:chatters` — optional, if you need the chatter list.

Request only what the enabled features need; define the scope list in `config.ts`.

### 7.4 EventSub WebSocket client (`twitch/eventsub.ts`)
- Connect to `wss://eventsub.wss.twitch.tv/ws`.
- First message is `session_welcome` with `payload.session.id` and `keepalive_timeout_seconds`. **Create subscriptions promptly** (Twitch closes the connection if you don't subscribe within a short window, ~10 seconds).
- Create subscriptions with `POST https://api.twitch.tv/helix/eventsub/subscriptions`, headers `Authorization: Bearer <user token>`, `Client-Id`, JSON body:
  ```json
  {
    "type": "channel.chat.message",
    "version": "1",
    "condition": { "broadcaster_user_id": "<broadcasterId>", "user_id": "<tokenUserId>" },
    "transport": { "method": "websocket", "session_id": "<sessionId>" }
  }
  ```
- Stretch subscription: `channel.raid` with condition `{ "to_broadcaster_user_id": "<broadcasterId>" }`.
- Message types to handle via `metadata.message_type`:
  - `session_welcome` → subscribe.
  - `session_keepalive` → reset the keepalive timer.
  - `notification` → parse by `metadata.subscription_type`, emit on bus.
  - `session_reconnect` → connect to `payload.session.reconnect_url`; keep the old socket until the new one sends its welcome; subscriptions carry over (don't resubscribe on a reconnect URL).
  - `revocation` → log, show on dashboard, attempt re-auth.
- If no message arrives within `keepalive_timeout_seconds` (+ a small grace), treat the connection as dead and reconnect from scratch with exponential backoff (1s, 2s, 4s… max 30s) and resubscribe.
- **Deduplicate** notifications by `metadata.message_id` (keep a small LRU of recent IDs).
- Map `channel.chat.message` event → `ChatMessage`: key fields are `message_id`, `chatter_user_id`, `chatter_user_login`, `chatter_user_name`, `message.text`, `badges` (derive broadcaster/moderator/vip/subscriber from badge `set_id`s), and `reply` if present. Use `metadata.message_timestamp` for time.

### 7.5 Helix client (`twitch/helix.ts`)
- Base URL `https://api.twitch.tv/helix`. Always send `Authorization: Bearer` and `Client-Id`.
- Respect rate limits: read `Ratelimit-Remaining` / `Ratelimit-Reset` headers; on 429, wait until reset and retry once.
- Endpoints we use (verify):
  - **Delete chat message:** `DELETE /moderation/chat?broadcaster_id=&moderator_id=&message_id=`. Note limits: you can't delete the broadcaster's or moderators' messages, and only recent messages can be deleted. Treat failures as non-fatal and log them.
  - **Send chat message:** `POST /chat/messages` with `{ broadcaster_id, sender_id, message }` (≤500 chars).
  - **Shield Mode:** `PUT /moderation/shield_mode?broadcaster_id=&moderator_id=` with `{ "is_active": true|false }`.
  - **Warn chat user:** `POST /moderation/warnings?broadcaster_id=&moderator_id=` with `{ "data": { "user_id", "reason" } }`.
  - **Get users:** `GET /users?id=...` (up to 100 IDs) → `created_at` for account age.

### 7.6 Users / account age (`twitch/users.ts`)
- Cache `created_at` per user ID for the session. Batch lookups (collect IDs for 500 ms, then one request).
- Account age is used as a weight in the risk engine (§10), never as a reason to act alone.

---

## 8. Chat pipeline

### 8.1 Prefilter (`pipeline/prefilter.ts`)
Purpose: cheap, synchronous scoring so only suspicious messages cost an AI call. Every message gets a `PrefilterResult`.

Rule groups (each rule has an id and weight; score = 1 − ∏(1 − weight) over matched rules, capped at 1):
- **Location question phrases** (w 0.5): `where (are|r) (you|u)`, `what (city|town|state|country|street|area|neighborhood)`, `where is (this|that)`, `which (city|street|mall|park|station)`, `what part of`.
- **Guess phrasing** (w 0.45): `is (that|this) (the|in|on|near)`, `are you (in|at|near|by)`, `looks like`, `i think (that's|thats|you're|youre)`, `that's (the|in|on)`.
- **Confirmation phrasing** (w 0.4): `yeah (that's|thats|it's|its)`, `100%`, `confirmed`, `i know (that|this) place`, `i live (near|by|there)`, `that's right by`.
- **Place-type nouns** (w 0.3): street, st, ave, avenue, road, rd, blvd, highway, exit, mall, station, park, plaza, campus, hotel, airport, bridge, pier, downtown, uptown, intersection, corner of, block.
- **Chain/venue names** (w 0.25): a configurable list (e.g., common chains: Walmart, Target, CVS, Walgreens, Starbucks, McDonald's, 7-Eleven, Costco, Whole Foods…). Store in `config` so it's easy to extend.
- **Address/coordinate patterns** (w 0.9): street number + street suffix (`\b\d{1,6}\s+\w+(\s\w+)?\s(st|street|ave|avenue|rd|road|blvd|ln|lane|dr|drive|ct|court|way)\b`), ZIP/postcode patterns, decimal coordinate pairs, map links (`maps.google`, `goo.gl/maps`, `maps.app.goo.gl`, `apple.co`, `what3words`).
- **Approach intent** (w 0.6): `(i'm|im|i am) (coming|outside|nearby|close|near you|on my way)`, `see you soon`, `i see you`, `turn around`, `look behind you`, `wave at me`.
- **Threat / swat phrases** (w 0.8): `swat`, `calling the cops`, `call 911 on`, `you're getting raided` (in a police sense), `i'll find you`, `i know where you live`, plus violent threat terms.
- **Capitalized proper-noun heuristic** (w 0.15): two or more consecutive capitalized words not at sentence start.

Settings: candidate threshold default **0.35**. Messages from the broadcaster are still scored (to alert the streamer if *they* say something revealing) but are never deleted. Normalize text first: lowercase copy for matching, collapse repeated letters (`stttt` → `st`), strip zero-width characters, and handle simple obfuscation (`m a i n s t` → `main st`, leetspeak `3`→`e`, `0`→`o`) in a separate "deobfuscated" copy that's also matched.

Also keep a **per-user rolling context** (last 5 messages per user, last 30 messages overall) to pass to the classifier.

### 8.2 Classifier (`pipeline/classifier.ts`)
- Queue candidates; flush a batch every **2 seconds** or at **10 messages**, whichever comes first. Deliver high-weight rule hits (address patterns, threats) immediately without waiting.
- Each batch request includes: the candidate messages (id, username, text), the last 30 overall chat lines for context (usernames + text), and the streamer's display name. Never include tokens or other secrets.
- Use OpenAI structured outputs with a JSON schema mirroring `Classification` (minus `source`). Validate with zod; drop invalid items.
- Timeout 8 s. On failure or timeout: **rules fallback** — derive a `Classification` from prefilter rules (e.g., address pattern → `location_share`, severity 3, confidence 0.7; threat phrase → `swat_or_threat`; guess phrasing + place noun → `location_guess`, confidence 0.4), mark `source: "rules_fallback"`. The pipeline must keep working with no OpenAI access at all.
- Cost guard: max N AI calls per minute (config, default 30). If exceeded, use rules fallback and show a small "AI budget reached" badge on the dashboard.
- Cache classification by normalized text (identical spam shouldn't cost repeated calls).

#### Classifier system prompt (`prompts/classifier.system.md`)
Use this as the starting prompt; iterate using the eval set (§15).

```
You are the classification engine of Fly Swatter, a safety moderator protecting a Twitch streamer
from viewers who try to figure out where the streamer physically is.

For each chat message you receive, decide whether it helps someone locate the streamer in the
real world or threatens them. Use the recent chat context to interpret short replies
(e.g., "yeah that's it" after someone guessed a place is a location_confirmation).

Categories:
- location_question: asks where the streamer is (city, street, venue, area).
- location_guess: proposes a specific place the streamer might be.
- location_confirmation: agrees with or confirms an earlier location guess.
- location_share: posts an address, coordinates, map link, or precise directions to the streamer.
- approach_intent: says they are coming to, near, or watching the streamer in person.
- swat_or_threat: threatens violence, police calls, swatting, or says they know where the streamer lives.
- benign: anything else, including talking about places unrelated to the streamer's current location
  (e.g., "I'm from Ohio lol", "I love Starbucks", game locations, fictional places, the streamer's
  publicly announced event venue like "TwitchCon").

Rules:
- Places inside video games, movies, or fiction are benign.
- A viewer sharing their OWN location ("I'm watching from Brazil") is benign unless it's paired with
  intent to meet or approach.
- Be careful with jokes; use confidence to express uncertainty rather than over-flagging.
- If a place is mentioned in a non-benign message, extract it: rawText exactly as written,
  canonical as a lowercase normalized name (expand abbreviations: "st" -> "street", "ave" -> "avenue";
  remove filler words), and granularity.
- severity: 0 benign, 1 vague question, 2 specific guess/confirmation or approach intent,
  3 address/coordinates/map link, swatting, or explicit threat.
- rationale: one short sentence.
- Do not add any information about where the streamer actually is. Only analyze what chat said.

Return only JSON matching the provided schema.
```

### 8.3 Place normalizer (`pipeline/placeNormalizer.ts`)
- Input: `canonical` from the classifier (or a regex-extracted span in fallback mode).
- Steps: lowercase → strip punctuation → expand abbreviations (st→street, ave→avenue, rd→road, blvd→boulevard, hwy→highway, n/s/e/w→north/south/east/west when adjacent to street words, mt→mount, ft→fort) → remove stopwords ("the", "on", "near", "by", "at", "in", "that") → collapse whitespace.
- Produce a `clusterKey` (normalized string) and token set for fuzzy matching.
- Two places match the same cluster if token-set similarity ≥ 0.8 **or** one's token set is a subset of the other's with ≥ 2 shared meaningful tokens (so "cvs main street" and "main street" can join, but "main street" and "main mall" don't).
- Unit-test lots of variants: "Main St", "main street", "the CVS on main", "mainst", "MAIN ST!!!".

### 8.4 Triangulation tracker (`pipeline/triangulation.ts`)
This is the star feature. Make it well-tested and clearly visualized.

- Sliding window: **5 minutes** (config). Mentions older than the window drop off; clusters with no mentions are removed.
- Only categories `location_question` (if it contains a place), `location_guess`, `location_confirmation`, `location_share`, and `approach_intent` (with a place) contribute.
- Mention weight = `categoryWeight × granularityWeight × confidence`
  - categoryWeight: question 0.5, guess 1.0, confirmation 1.3, share 2.0, approach_intent 1.5
  - granularityWeight: country 0.2, region 0.4, city 0.6, neighborhood 0.8, street 1.0, venue 1.1, exact 1.5
- Cluster score = sum over **distinct users** of each user's max mention weight (one user spamming the same guess shouldn't build a swarm by themselves), multiplied by a **convergence bonus**: `1 + 0.25 × (distinctUsers − 1)`.
- A confirmation that replies to (or follows within 60 s of) a guess in the same cluster gives +0.5 bonus to the cluster.
- **Swarm** = `distinctUsers ≥ 3` and `score ≥ 3.0` within the window (both configurable). Emit `cluster.swarm` once when a cluster becomes a swarm (with dedupe so alerts don't repeat every message).
- Also track **question pressure**: count of distinct users asking location questions (even without a place) in the last 2 minutes. This feeds the risk engine separately.
- Expose a snapshot method for the dashboard: clusters sorted by score, with mentions (usernames, message excerpts, timestamps).

---

## 9. Exposure scorer (stretch) — `pipeline/exposure.ts`

- Connect to OBS WebSocket (`OBS_WS_URL`, default `ws://127.0.0.1:4455`, password from env).
- Every **20 seconds** (config; also on-demand via a dashboard button) call `GetSourceScreenshot` for the configured source (`OBS_SOURCE_NAME`, e.g., the webcam or the program scene) with `imageFormat: "jpg"`, width ~768, compression quality ~60. The response contains a data URI.
- Send the image to a vision-capable model with the prompt below and a strict JSON schema matching `ExposureReading` (`granularityExposed`, `score`, `cues[{type, description}]`, `recommendation`). **No location fields in the schema.**
- Post-check (rule §2.1): reject/scrub any `description` or `recommendation` containing digits that look like addresses, coordinate patterns, or text in quotes copied from signs; replace with a generic description (e.g., "Readable street sign visible").
- Never write frames to disk unless `DEBUG_SAVE_FRAMES=true`.
- Smooth readings: exposure component = max of the last 3 readings (so a sign that flashed by still counts briefly), decaying after.
- Streamer setup tip to show in README and dashboard: enable an OBS **stream delay** so the scorer and alerts happen before viewers see the frame. Fly Swatter analyzes the source feed via OBS, which is ahead of the delayed public stream.

#### Exposure system prompt (`prompts/exposure.system.md`)
```
You are a privacy auditor for a livestreamer. You will see one frame from their own live stream.
Your job is to rate how easily a viewer could figure out where the streamer physically is from this
frame alone, and to name the KINDS of visual cues that make it possible.

Never state, guess, or hint at the actual location. Never transcribe sign text, addresses, house
numbers, license plates, or business names. Describe cues generically, e.g., "readable street sign
in the background", "distinctive storefront with legible name", "house number visible on door".

Granularity scale (choose the most precise level a determined viewer could reach):
none, country, region, city, neighborhood, street, venue, exact.

score: 0-100, where 0 = nothing identifying, 50 = city or neighborhood could be inferred,
80+ = street, venue, or exact location could be inferred.

recommendation: one short, practical sentence (e.g., "Angle the camera away from the window").

Return only JSON matching the provided schema.
```

---

## 10. Risk engine (`pipeline/riskEngine.ts`)

Combines components into one score (0–100), recalculated on every relevant event and on a 1-second tick (for decay).

Components (each 0–100, each with exponential decay toward 0, half-life configurable):
- **chat** (half-life 90 s): increases per classified message: `severity × 8 × confidence`, plus question pressure: `+10` per distinct questioning user beyond the first in 2 minutes. `swat_or_threat` with severity 3 jumps chat to at least 70.
- **triangulation** (computed directly from the top cluster, no decay beyond the window): `min(100, topClusterScore × 22)`; if any swarm exists, at least 75.
- **exposure** (half-life 60 s): latest smoothed exposure score.
- **raid** (half-life 5 min, stretch): on `channel.raid`, set to `min(40, 10 + viewers / 10)`. Increase chat-component increments by 1.5× for messages from accounts younger than 7 days while raid > 0.

Account-age weighting (stretch): multiply a message's chat increment by 1.3 if the account is < 7 days old, 1.15 if < 30 days.

Overall score = `min(100, max(triangulation, chat, exposure) × 0.7 + (sum of the other components) × 0.15 + raid × 0.5)` — tune it so one strong signal dominates but multiple signals stack. Keep the formula in one function with comments and tests.

Levels (with **hysteresis** to avoid flicker — go up immediately, go down only after the score stays below the lower bound for 20 s):
| Level | Name on UI | Score |
|---|---|---|
| `quiet` | Quiet | 0–24 |
| `few_flies` | A Few Flies | 25–49 |
| `buzzing` | Buzzing | 50–74 |
| `swarm` | Swarm Incoming | 75–100 |

Emit `risk.updated` (throttled to max 4/s for the dashboard) and `risk.level_changed`.

---

## 11. Action engine (`pipeline/actionEngine.ts`)

### 11.1 Modes
- **Observe** (default on first run): no Twitch actions. Everything is logged as `dryRun: true` so the dashboard shows what *would* have happened.
- **Assist:** delete messages with `location_share` (any confidence ≥ 0.6) and `location_guess`/`location_confirmation` with severity ≥ 2 and confidence ≥ 0.7, or any message contributing to a swarm cluster; send mod alerts on level changes to `buzzing`/`swarm` and on swarms.
- **Guardian:** everything in Assist, plus delete `location_question` messages while level ≥ `buzzing`, warn users on repeat offenses (2+ deleted messages in 10 minutes), and turn on Shield Mode when level reaches `swarm` (auto-off is manual only — show a button).

### 11.2 Policy rules
- Never delete broadcaster or moderator messages (the API won't allow it anyway); instead raise a private dashboard alert ("You may have revealed a location").
- Never take action on `benign`.
- Idempotency: one action of each kind per message ID; dedupe mod alerts (same kind max once per 60 s, swarm alerts once per cluster).
- Every action produces an `ActionRecord` (success/failure, error text), shown on the dashboard.
- All actions go through one `execute(action)` function so dry-run is enforced in one place.

### 11.3 Bot message copy (mascot voice — never include place text, rule §2.3)
Keep these in a config file so they're easy to change. Examples:
- Mod alert, buzzing: `🪰 Fly Swatter: chat is fishing for the streamer's location. Mods, stay sharp.`
- Mod alert, swarm: `🪰🪰🪰 Fly Swatter: multiple chatters are converging on a location guess. Swatting messages now. Mods, check the dashboard.`
- Public notice after deletions (optional, rate-limited to once per 5 min): `🪰 Location guesses get swatted here. Keep the streamer safe!`
- Warning reason text: `Please don't guess or share the streamer's location.`
All bot messages are ≤ 300 characters.

### 11.4 Panic button (stretch)
Dashboard button that, in one click: switches OBS to the configured BRB scene (`OBS_BRB_SCENE`), turns on Shield Mode, and sends the swarm mod alert. Requires a confirmation click (or press-and-hold for 1 s) to avoid accidents.

### 11.5 Incident report (stretch) — `reports/incidentReport.ts`
- Dashboard button "Prepare incident report" → server builds Markdown + JSON in `reports/` containing: time range, channel name, risk timeline, flagged messages (username, user ID, text, timestamp, category), clusters, actions taken, and exposure readings (without frames).
- Include a header paragraph explaining what swatting is and that the streamer is a known potential target, so it's useful if they choose to share it with local police or an anti-swatting registry where one exists.
- The tool **never sends** the report anywhere (rule §2.4). The dashboard shows the file path and a download link.

---

## 12. Demo mode (critical for the hackathon)

Live demos fail; demo mode must not. `DEMO_MODE=true` (or a dashboard toggle) runs the full pipeline with a simulator instead of EventSub.

- Simulator reads scenario JSON files from `server/src/demo/scenarios/`:
  ```json
  {
    "name": "IRL triangulation",
    "speed": 1.0,
    "events": [
      { "t": 0,     "type": "chat", "user": "cozyviewer", "text": "this walk is so chill" },
      { "t": 2500,  "type": "chat", "user": "lurker_99", "text": "what city is that??" },
      { "t": 6000,  "type": "chat", "user": "sniffer22", "text": "is that the CVS on Maple Ave?" },
      { "t": 9000,  "type": "chat", "user": "brandnew_acc", "text": "yeah thats maple ave 100%", "accountAgeDays": 1 },
      { "t": 12000, "type": "chat", "user": "sniffer22", "text": "im like 10 min away lol" },
      { "t": 15000, "type": "chat", "user": "cozyviewer", "text": "guys stop that's weird" },
      { "t": 18000, "type": "raid", "fromUser": "randomraider", "viewers": 150 }
    ]
  }
  ```
- Use **made-up place names** in all scenarios (e.g., "Maple Ave", "Brightwater Mall"), never real addresses.
- Include a `false-positive-check.json` scenario full of benign place talk ("I'm from Texas", "Elden Ring's Limgrave is huge", "Starbucks is overrated", "see you at TwitchCon!") to prove the classifier doesn't over-flag. This makes a great 10-second demo moment.
- Demo actions run in dry-run against Twitch but are displayed as if live (clearly labeled "DEMO" in the UI corner).
- Dashboard has a scenario picker, Play/Pause/Reset, and speed control (0.5×, 1×, 2×).
- Also support a **"type as a viewer"** box on the dashboard in demo mode that injects a message as a chosen fake user, for live audience interaction during the pitch.
- If OpenAI is unreachable, demo mode still works via rules fallback.

Additionally, for a live (non-simulated) demo, the README should explain how to use a second Twitch account as the "snoop" in a real channel.

---

## 13. Dashboard

Private web app served by the server at `http://localhost:3000/`. It's the streamer's (and optionally a trusted mod's) cockpit. **Never expose it publicly** — bind the server to `127.0.0.1` by default.

### 13.1 Server API (`server/http.ts`)
- `GET /auth/login`, `GET /auth/callback`, `GET /auth/status`
- `GET /api/state` → full snapshot (risk, clusters, recent classifications, actions, exposure, mode, demo state)
- `POST /api/mode` `{ mode }`
- `POST /api/panic`
- `POST /api/shield` `{ active: boolean }`
- `POST /api/exposure/scan` (on-demand scan)
- `POST /api/report` → `{ path, downloadUrl }`
- `GET /reports/:file`
- Demo: `GET /api/demo/scenarios`, `POST /api/demo/play` `{ name, speed }`, `POST /api/demo/pause`, `POST /api/demo/reset`, `POST /api/demo/inject` `{ user, text }`
- WebSocket `/ws` → pushes bus events (`risk.updated`, `classification`, `cluster.updated`, `action.taken`, `exposure.reading`, `status`).

Protect mutating routes with a random local session secret generated at startup and passed to the dashboard via an httpOnly cookie after OAuth (simple CSRF protection since this is localhost-only).

### 13.2 Layout
- **Header:** Fly Swatter logo + mascot, connection status pills (Twitch, EventSub, OpenAI, OBS), mode selector, DEMO badge when relevant.
- **Left column:** Risk meter (big, animated, color-coded) + level name + component breakdown bars (chat, triangulation, exposure, raid). Exposure meter with cue chips and recommendation (stretch).
- **Center:** **Swarm view** — the hero visual. Each flagged message is an animated fly. Flies drift around; when several users mention the same cluster, their flies converge around a pin labeled with the cluster's place text (dashboard-only) and distinct user count. When a swarm forms, the pin pulses red and the mascot reacts. When a message is deleted, its fly gets swatted (swatter animation sweeps in, fly squashes into a little "thwap" particle burst, optional sound).
- **Right column:** Fly feed (scrolling list of flagged messages: username, text, category chip, confidence, severity, action taken) and the action log.
- **Footer controls:** Panic button (press-and-hold), Shield Mode toggle, Prepare report, demo controls (in demo mode).

### 13.3 Mascot (original art only)
- Create an **original** mascot as inline SVG in `Mascot.tsx`: a friendly, slightly scrappy fly swatter character (rounded mesh head with a face, a handle as the body, small arms, maybe a tiny moderator headset or badge). Do not imitate any existing character, brand, or logo.
- Moods tied to risk level: `quiet` (relaxed, napping or sipping coffee), `few_flies` (alert, eyes tracking), `buzzing` (determined, swatter raised), `swarm` (action pose, motion lines). Animate transitions subtly.
- Suggested name for the mascot itself: "Swatty" (configurable).
- Flies are simple original SVGs too (cartoon fly with tiny wings). Make the snoop flies look mischievous, not gross.

### 13.4 Visual style
- Playful but readable: rounded corners, chunky outlines, bold type for levels. Respect light and dark mode via CSS variables on `:root` with a `@media (prefers-color-scheme: dark)` override.
- Risk colors: quiet green, few_flies yellow, buzzing orange, swarm red — but **never rely on color alone**: always show the level name and an icon.
- Accessibility: keyboard-navigable controls, `aria-live="polite"` region announcing level changes, respect `prefers-reduced-motion` (disable fly drift and swat animations, show static states instead).
- Sounds off by default; toggle in header.

### 13.5 Optional OBS overlay
A minimal route `/overlay` showing only the mascot and a "Protected by Fly Swatter" badge for use as an OBS Browser Source. It must **not** show any flagged messages or places (it's public on stream). Only show the mascot mood if the streamer enables it.

---

## 14. Configuration

`.env.example` (document every variable in README):

```
# Server
PORT=3000
HOST=127.0.0.1
LOG_LEVEL=info

# Twitch
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_REDIRECT_URI=http://localhost:3000/auth/callback

# OpenAI (check current docs for appropriate model names)
OPENAI_API_KEY=
OPENAI_MODEL_TEXT=
OPENAI_MODEL_VISION=
AI_MAX_CALLS_PER_MINUTE=30
AI_TIMEOUT_MS=8000

# OBS (stretch)
OBS_ENABLED=false
OBS_WS_URL=ws://127.0.0.1:4455
OBS_WS_PASSWORD=
OBS_SOURCE_NAME=Webcam
OBS_BRB_SCENE=BRB
EXPOSURE_INTERVAL_MS=20000
DEBUG_SAVE_FRAMES=false

# Behavior
DEFAULT_MODE=observe
PREFILTER_THRESHOLD=0.35
TRIANGULATION_WINDOW_MS=300000
SWARM_MIN_USERS=3
SWARM_MIN_SCORE=3.0
DEMO_MODE=false
MASCOT_NAME=Swatty
```

Validate with zod at startup; print a friendly error listing missing variables. Features with missing config degrade gracefully (e.g., no OpenAI key → rules-only mode with a dashboard banner; OBS disabled → exposure panel shows "Connect OBS to enable").

---

## 15. Testing and evaluation

### Unit tests (vitest) — required
- **prefilter:** each rule group, obfuscation handling, threshold behavior, broadcaster messages scored but flagged as non-deletable.
- **placeNormalizer:** abbreviation expansion, matching/non-matching pairs (see §8.3).
- **triangulation:** one user spamming doesn't create a swarm; three users converge → swarm; window expiry removes mentions; confirmation bonus; different places stay separate clusters.
- **riskEngine:** decay over simulated time (inject a clock), hysteresis, level thresholds, swarm forces ≥ 75.
- **actionEngine:** mode gating, dry-run enforcement, dedupe, never acting on benign or broadcaster/mod messages, bot copy never contains place text (test by asserting cluster canonical text is absent from every outgoing chat message).
- **eventsub:** message routing, dedupe by message_id, keepalive timeout triggers reconnect, session_reconnect handling (use a fake WebSocket server in tests).

Use an injectable clock everywhere time matters.

### AI evaluation set
- Create `server/test/fixtures/labeled-messages.json` with at least **80 labeled examples**, roughly: 25 benign-but-tricky (game locations, viewers' own hometowns, chain names in unrelated contexts, "TwitchCon"), 15 location questions, 15 guesses, 10 confirmations (with preceding context), 5 shares (fake addresses/coordinates), 5 approach intents, 5 threats. All places must be fictional.
- Script `npm run eval` sends them through the classifier and prints precision/recall per category plus a confusion matrix. Target: ≥ 0.85 precision on non-benign categories, and **benign false-positive rate ≤ 10%**. Tune the prompt, not the test labels.
- Record eval results in `BUILD_LOG.md` as you iterate (it's great evidence for judges).

---

## 16. Reliability and performance requirements

- The process must never crash from a single bad message, API error, or malformed AI output. Wrap per-message handling in try/catch and log.
- End-to-end latency target: chat message → dashboard display < 500 ms (pre-AI); → classification and action < 4 s typical.
- Twitch disconnects reconnect automatically with backoff; dashboard shows status.
- OpenAI failures switch to rules fallback within one timeout period; auto-retry AI after 60 s.
- Memory: cap stored messages (last 2,000) and classifications (last 1,000) in ring buffers.
- Graceful shutdown on SIGINT: close sockets, flush logs.

---

## 17. Codex usage log (`BUILD_LOG.md`) — hackathon requirement

The hackathon requires the project to be built with OpenAI Codex, and judges may consider how effectively it was used. Maintain `BUILD_LOG.md` throughout development:
- A dated entry per milestone: what was asked of Codex (paraphrased prompt), what it produced, what needed fixing, and what was learned.
- Note any place where official docs differed from this AGENTS.md and what changed.
- Record eval results over time (§15).
- Keep commits small and descriptive so the Git history shows the progression.

---

## 18. Milestones and acceptance criteria

Work through these in order. Don't start a milestone until the previous one's acceptance criteria pass.

**M1 — Skeleton:** monorepo, TypeScript configs, lint, vitest, Fastify serving a placeholder dashboard, config validation, logger with redaction.
✅ `npm run dev` starts server + dashboard; missing env vars produce a clear message.

**M2 — Twitch auth:** OAuth code flow, token storage, refresh, hourly validate, `/auth/status`.
✅ Logging in shows the broadcaster's login on the dashboard; restarting the server reuses the stored token.

**M3 — EventSub chat:** WebSocket client, subscription, keepalive, reconnect, dedupe; messages stream into the dashboard fly feed (unfiltered debug view).
✅ Typing in the real Twitch chat appears on the dashboard within ~1 s; killing the network and restoring it reconnects automatically.

**M4 — Demo mode:** simulator + scenarios + dashboard controls + inject box.
✅ The "IRL triangulation" scenario plays end to end with no Twitch or OpenAI connection.

**M5 — Prefilter + classifier + fallback:** batching, structured outputs, zod validation, cost guard, cache.
✅ Eval script runs and meets targets (or documents the gap); with no API key, rules fallback still classifies.

**M6 — Triangulation + risk engine:** clusters, swarm detection, decay, hysteresis.
✅ Unit tests pass; the demo scenario reaches "Swarm Incoming" and the benign scenario stays "Quiet" or "A Few Flies."

**M7 — Action engine:** modes, delete, mod alerts, dry-run, dedupe, copy safety test.
✅ In Assist mode on a real channel, a test account's "is that the CVS on Maple Ave?" is deleted and mods get an alert with no place text.

**M8 — Dashboard polish:** risk meter, swarm view with converging flies and swat animation, mascot moods, accessibility, light/dark.
✅ A first-time viewer understands what's happening within 10 seconds of watching the demo scenario.

**Stretch (in this order):** M9 exposure scorer → M10 raid + account age → M11 Shield Mode + panic button → M12 incident report → M13 warnings → M14 overlay route + sounds.

---

## 19. README requirements

The README must cover: what Fly Swatter is (one paragraph + screenshot/GIF), the safety principles from §2 in plain language, prerequisites (Node 20+, a Twitch developer app, an OpenAI API key, optionally OBS 28+), step-by-step setup, running in demo mode, running live with a second "snoop" test account, recommended OBS stream delay setup, configuration reference, how to run tests and the eval, known limitations (AI can misclassify; tool reduces risk but can't make swatting impossible; deletion only works on recent messages), and a "Built with OpenAI Codex" section linking to `BUILD_LOG.md`.

---

## 20. The demo the project is building toward (keep this in mind for every decision)

1. Open with real context: recent swatting incidents against streamers, many during IRL streams.
2. Show the dashboard in "Quiet" with a relaxed mascot.
3. Play the IRL triangulation scenario (or use live test accounts): a viewer asks "what city is that?", another guesses a (fictional) street, a brand-new account confirms it.
4. Flies converge on a pin, the meter climbs to "Swarm Incoming," the mascot goes into action, flies get swatted, and a mod alert appears in chat with no location in it.
5. Play the false-positive scenario: lots of harmless place talk, and the meter stays calm. This proves it's smart, not just a keyword filter.
6. (Stretch) Hold a printed fake street sign up to the webcam and watch the exposure meter jump with "Readable street sign visible — angle the camera away."
7. Close with the safety principles (no auto-police, no locating other streamers, human always in control) and the "Built with Codex" slide.

Every feature should make this story clearer, faster, or more reliable. If something doesn't serve it, it's a stretch goal.