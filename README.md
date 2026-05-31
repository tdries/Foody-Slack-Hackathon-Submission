<div align="center">

# 🍴 Foody

### *Work hard, skip hangry.*

**A Slack-native group food-ordering bot that fronts takeaway.com.**

Someone in your channel types **“let's eat something.”** Foody picks up, runs the whole order as a conversation, and builds one shared basket from everyone's emoji reactions.

<br>

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Slack Bolt](https://img.shields.io/badge/Slack-Bolt%20·%20Socket%20Mode-4A154B?logo=slack&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer-stealth-40B5A4?logo=puppeteer&logoColor=white)
![No LLM](https://img.shields.io/badge/runtime-deterministic%20·%20no%20LLM-2EB67D)

<br>

### 👉 Want to play with it? See **[DEMO.md](DEMO.md)** — join the Slack workspace and type *“let's eat something.”*

</div>

---

## Why Foody

Every team knows the thread. It's 12:14, someone posts *“lunch?”*, and twenty minutes vanish into scrolling menus, pasting links, copy-pasting orders into a DM, and one poor soul becoming the human spreadsheet who tallies it all and pays.

The food is easy. The **coordination** is the tax.

Foody removes it. The team is already in Slack, and Slack already has a universal, zero-learning-curve input device: the **emoji reaction**. So that's the entire interface. No app to install, no link to chase, no spreadsheet.

---

## The order flow

> A real run, start to finish. Five messages, one shared basket, one tap to order.

### 1 · Someone says “let's eat something”
Foody greets the channel and confirms the delivery address. It's **sticky per Slack user** — asked once, remembered forever.

![Greeting](docs/screenshots/01-greeting.png)

### 2 · Pick a vibe
Eight one-tap cuisine categories. Pick one (or skip straight to the top spots).

![Category picker](docs/screenshots/02-category.png)

### 3 · Top 3 restaurants near you
Ranked and scored, each with rating, ETA, delivery fee and minimum — one tap to open the menu.

![Top 3 restaurants](docs/screenshots/03-restaurants.png)

### 4 · React to build a shared basket
The top 10 dishes land as a **single live message** that Foody pre-reacts to. Anyone on the team taps an emoji to add a dish; un-reacting removes it. The running total updates in place for everyone.

![Menu and shared cart](docs/screenshots/04-menu-cart.png)

### 5 · One tap to order
Hit the green button and Foody builds the basket on takeaway.com — with a live, self-animating progress card while it works.

![Build progress](docs/screenshots/05-progress.png)

### 6 · Done
A clean receipt lands in the thread: items, totals, and an ETA.

![Receipt](docs/screenshots/06-receipt.png)

---

## What makes it different

- **🪄 The interface is just emoji.** No forms, no webview — group ordering is reactions on a message.
- **🧭 Reactions are the source of truth.** The basket is reconciled from the *actual* reactions on the menu message, not a running tally of events — so a dropped Slack event never desyncs the cart. It self-heals.
- **⚙️ Deterministic, not a chatbot.** No LLM in the runtime path. The intent layer is a list of phrase matchers, so a given input always does exactly the same thing — fast and predictable.
- **🔌 Private by default.** Runs over Socket Mode — an outbound WebSocket, no public URL, nothing leaving the workspace.
- **🛒 A real checkout (opt-in).** Beyond the mock flow, Foody can drive an actual takeaway.com basket in *your* signed-in Chrome, ready to confirm.

---

## Architecture

Foody is a small TypeScript app. Each layer owns one thing:

| Layer | Responsibility |
|---|---|
| [`src/slack/app.ts`](src/slack/app.ts) | Bolt + Socket Mode app. Message triggers, action buttons, reaction events, every Block Kit post & update. |
| [`src/slack/blocks.ts`](src/slack/blocks.ts) | Block Kit builders: restaurant cards, the unified menu+cart card, the animated build-progress card, the receipt. |
| [`src/slack/intent.ts`](src/slack/intent.ts) | Phrase matchers for *“let's eat”*, *“order now”*, *“reset”*, *“change address to …”*. A list, not a model. |
| [`src/state.ts`](src/state.ts) | JSON state, keyed two ways: `addr_<user>` for the sticky address book, `sess_<channel>_<thread>` for the live cart. |
| [`src/takeaway.ts`](src/takeaway.ts) + [`src/scrape-live.ts`](src/scrape-live.ts) | Restaurant/dish lookup with an in-memory + 24-hour disk-TTL cache and a daily background prewarm. |
| [`src/checkout.ts`](src/checkout.ts) | Drives your already-running Chrome over the DevTools Protocol to fill the real basket in a background tab. |
| [`src/emojis.ts`](src/emojis.ts) | The dish-emoji pool and the Unicode ↔ Slack-shortcode mapping. |

```
let's eat  →  intent  →  session state  →  discovery (scrape + cache)  →  pre-reacted menu
                                                                              │
                                              react / un-react  ───────────────┘
                                                     │
                                          reconcile cart from message reactions
                                                     │
                                            Order  →  build basket (your Chrome)  →  receipt
```

There's a one-page visual of this in **[docs/Foody-Technical-One-Pager.pdf](docs/Foody-Technical-One-Pager.pdf)**.

---

## Quick start

```bash
npm install
cp .env.example .env
# fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET
npm run dev:slack
```

Then in Slack, in a channel where Foody is a member (`/invite @Foody`), type **`let's eat something`**.

### Slack app setup

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Paste [docs/slack-manifest.yml](docs/slack-manifest.yml).
3. **Install to Workspace**, copy the **Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN`.
4. **Basic Information → App-Level Tokens** → create one with `connections:write` (`xapp-…`) → `SLACK_APP_TOKEN`.
5. **Basic Information → Signing Secret** → `SLACK_SIGNING_SECRET`.
6. Make sure **Socket Mode** is **On**.

### Configuration knobs (`.env`)

| Variable | What it does |
|---|---|
| `FOODY_CHANNELS` | Comma-separated channel IDs to restrict the bot to. Empty = everywhere it's invited. |
| `FOODY_LOG_LEVEL` | `debug` · `info` (default) · `warn` · `error`. |
| `FOODY_DEBUG` | `1` dumps a menu-page snapshot (HTML + screenshot + probe) per cart build to `state/debug-checkout/`. |

---

## The real takeaway.com checkout (opt-in)

The mock flow posts a stubbed receipt. For a **real** basket, Foody connects to your *already-running* Chrome over the DevTools Protocol and builds the order in a background tab — so it lands in your real, signed-in session with your saved address and payment.

**Why connect instead of launching headless?** takeaway.com is fronted by Cloudflare Turnstile, which fingerprints and blocks bundled-Chromium Puppeteer. Your real Chrome already holds a valid clearance and session, so it sails through — and the “Pay” link opens in the same browser, basket intact.

Launch Chrome with the debug port (Foody can also do this for you from a Slack button):

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/foody-chrome
```

> ⚠️ **Status:** the live cart-build is experimental. DOM matching on takeaway.com is sensitive to a logged-out session and layout changes; sign into takeaway.com in that Chrome first. The Slack flow, shared cart, and receipt all work against mock data with zero setup.

---

## CLI (debugging)

State can be driven by hand — handy for poking at sessions without Slack:

```bash
npm run foody -- address <user> --set "Meir 1, Antwerpen"
npm run foody -- restaurants <user>
npm run foody -- menu <user> --index 1
npm run foody -- cart <user> --add "🍕,🍔"
npm run foody -- order <user>
npm run foody -- status <user>
npm run foody -- reset <user>
```

---

## Project docs

| Doc | What it is |
|---|---|
| [DEMO.md](DEMO.md) | How to try Foody live (join link) and how to host your own always-on demo. |
| [docs/DEVPOST.md](docs/DEVPOST.md) | The story: inspiration, what it does, how we built it, challenges, what's next. |
| [docs/Foody-One-Pager.pdf](docs/Foody-One-Pager.pdf) | Commercial one-pager. |
| [docs/Foody-Technical-One-Pager.pdf](docs/Foody-Technical-One-Pager.pdf) | Technical overview one-pager. |
| [STYLE.md](STYLE.md) | Brand & style guide (color, type, voice, Block Kit usage). |

*Screenshots above are generated from [docs/screenshots/flow.html](docs/screenshots/flow.html) via `node scripts/render-screenshots.mjs` — faithful renderings of the real Block Kit messages.*

---

## Tech

`TypeScript` · `Node.js 22` · `@slack/bolt` (Socket Mode) · `Block Kit` · `Puppeteer` + stealth · JSON disk-TTL cache · `tsx`

<div align="center">
<br>

**Foody** · group food ordering for Slack
*Work hard, skip hangry.* 🍴

</div>
