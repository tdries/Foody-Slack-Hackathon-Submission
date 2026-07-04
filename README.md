# Foody

A Slack-native group food-ordering bot that fronts takeaway.com.

Someone in your channel types **"let's eat something"**, Foody picks up. It walks the thread through:

1. **Address** — sticky per Slack user. Asked once, remembered forever, change with _"change address to ..."_.
2. **Top 3 restaurants** near you — Block Kit cards, one click to open a menu.
3. **Top 10 dishes** — posted as a single message. Foody pre-reacts with `🍕 🍔 🍟 🌮 🌯 🍣 🍜 🍱 🥗 🍝` so the whole team can **click to add** with one tap.
4. **Shared cart** — anyone's reaction adds; unreacting removes. Cart summary posts after each change.
5. **Order** — hit the green button. Receipt with totals and ETA lands in the thread.

Or skip the phrase triggers entirely and just *talk to it* — see the AI assistant below.

## AI assistant (Slack AI capabilities) 🤖

Foody is a Slack **AI app**: it ships the split-pane assistant surface built on Slack's AI-apps platform (`assistant_view`, `Assistant` class in Bolt, suggested prompts, live status updates, thread context). Open Foody from the workspace's AI apps entry point and describe what you want in plain language:

> *"Something spicy for 6 people under €15, we're at Veldstraat 1, 9000 Gent"*

The assistant (a Claude tool-use loop, [src/slack/assistant.ts](src/slack/assistant.ts)) maps free text onto Foody's deterministic machinery through four tools:

| Tool | What it does |
|---|---|
| `find_restaurants` | Top delivery spots near an address, optional cuisine filter |
| `get_menu` | Top 10 dishes with prices — powers "is there something vegetarian under €12?" |
| `save_default_address` | Updates the sticky per-user address book |
| `start_group_order` | The handoff: posts the restaurant cards (or a menu with pre-reacted emojis) into the channel you opened the assistant from, where the classic reaction-cart flow takes over |

While it works you see live status ("*is scanning takeaway.com near Veldstraat 1…*"), and the end state of a conversation is a group order running in your channel — the AI plans, the team taps emojis, and nobody typed a search filter.

## Architecture

| Layer | What it owns |
|---|---|
| [src/slack/app.ts](src/slack/app.ts) | Bolt + Socket Mode app. All Slack plumbing — message triggers, action buttons, reaction events, block posting. |
| [src/slack/blocks.ts](src/slack/blocks.ts) | Block Kit builders for the restaurants card, menu card, cart update, receipt. |
| [src/slack/assistant.ts](src/slack/assistant.ts) | The AI assistant pane: Bolt `Assistant` wiring + the Claude tool-use loop and its four tools. |
| [src/slack/intent.ts](src/slack/intent.ts) | Phrase matchers for "let's eat", "order now", "reset", "change address to ...". |
| [src/state.ts](src/state.ts) | JSON state files in [state/](state/). Two keyings: `addr_<slackUserId>` for the sticky address book, `sess_<channel>_<threadTs>` for the live thread cart. |
| [src/takeaway.ts](src/takeaway.ts#L42) | Restaurant + dish lookup. Mock-data first, stubbed `fetchLive()` for a real takeaway.com integration. |
| [src/emojis.ts](src/emojis.ts) | The fixed 10-emoji pool + Unicode ↔ Slack shortcode mapping. |
| [src/cli.ts](src/cli.ts) | Original CLI — left in place for debugging state by hand. |

The channel flow is deterministic code — the phrase matcher is a list, buttons and reactions drive everything. The LLM lives in exactly one place: the assistant pane, where Claude turns free text into calls against that same deterministic machinery. Kill `ANTHROPIC_API_KEY` and the channel flow still works.

## Install

```bash
npm install
cp .env.example .env
# Fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET
# + ANTHROPIC_API_KEY for the AI assistant pane
```

### Slack app setup

1. Go to https://api.slack.com/apps → **Create New App** → **From a manifest**.
2. Paste [docs/slack-manifest.yml](docs/slack-manifest.yml).
3. **Install to Workspace**, copy the **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`.
4. **Basic Information** → **App-Level Tokens** → create one with `connections:write` → copy (`xapp-...`) → `SLACK_APP_TOKEN`.
5. **Basic Information** → **Signing Secret** → `SLACK_SIGNING_SECRET`.
6. Invite the bot into a channel: `/invite @Foody`.

> Upgrading an existing Foody install? Re-apply [docs/slack-manifest.yml](docs/slack-manifest.yml) under **App Manifest** — the AI assistant needs the `assistant_view` feature, the `assistant:write` scope, and the `assistant_thread_*` events — then reinstall to the workspace.

### Run

```bash
npm run dev:slack
```

Then in Slack: `let's eat something` in a channel where Foody is a member, or open the **Foody assistant** from the AI apps split pane and just tell it what you're craving.

## Knobs

`.env`:

- `FOODY_CHANNELS` — comma-separated channel IDs to restrict the bot to. Empty = listen everywhere it's been invited.
- `FOODY_LOG_LEVEL` — `debug`, `info` (default), `warn`, `error`.

## CLI (debug only)

```bash
npm run foody -- address <user> --set "Veldstraat 1, 9000 Gent"
npm run foody -- restaurants <user>
npm run foody -- menu <user> --index 1
npm run foody -- cart <user> --add "🍕,🍔"
npm run foody -- order <user>
npm run foody -- status <user>
npm run foody -- reset <user>
```

`<user>` is just a state key — pass a Slack userId or anything you want; state is keyed by that string.

## Custom dish emojis (optional but worth it)

The bot ships with thematic standard emojis (`🍕 🌶️ 🧀 …`) per dish. You can replace them with real dish photos uploaded as workspace custom emojis. Two steps:

### 1. Fetch the images

```bash
node scripts/fetch-dish-images.mjs
```

For every dish in the mock data this tries TheMealDB → Wikipedia page-image → category fallback. Results land in `data/dish-images/<slug>.png` (128×128 PNG, ≤128 KB each). It's idempotent — already-downloaded files are skipped. A `data/dish-images/manifest.json` keeps the dishId → slug map.

### 2. Upload them to your Slack workspace

Slack's bot API can't upload emojis (the official `admin.emoji.add` is Enterprise Grid only). So we go through the same path the Slack web client uses, authenticated with your *user* session token + `d` cookie. **This is against Slack's ToS, fine for personal/demo workspaces, not for anything you ship publicly.**

Extract from your own browser session:

| Value | Where |
|---|---|
| `FOODY_SLACK_TEAM_DOMAIN` | Workspace subdomain — the part before `.slack.com` in your URL (e.g. `biztory`). |
| `FOODY_SLACK_D_COOKIE` | DevTools → Application → Cookies → `https://app.slack.com` → copy the value of `d`. |
| `FOODY_SLACK_XOXC` | DevTools → Console → run `JSON.parse(decodeURIComponent(window.localStorage.localConfig_v2)).teams` → find your workspace entry → copy `token` (`xoxc-…`). |

Drop those into `.env`, then:

```bash
node scripts/upload-emojis.mjs
```

The script uploads each `foody_<slug>` once, skips ones that already exist, and writes `uploaded: true` back into the manifest. Restart the bot (`npm run dev:slack`) — the manifest is loaded at startup and Foody now prefers your custom emojis, falling back to the thematic standard one for any dish that didn't get uploaded.

## Real takeaway.com cart-build (opt-in)

The bot has one **real** Belgian restaurant baked in — **Pizza Roma** in 9000 Gent — scraped from takeaway.com into `data/takeaway-real.json`. When you trigger Order on the real restaurant (not on the mock ones), Foody drives a Puppeteer session that:

1. Connects to your **already-running Chrome** via remote debugging (so the cart appears in your *real, signed-in* browser, with your saved address and payment methods).
2. Opens a new tab → sets the delivery address → navigates to the Pizza Roma menu page.
3. For each dish in the shared Slack cart, finds the dish card by name and clicks through the modal to add it.
4. Leaves the tab open at the cart screen — you finish payment manually.

### Launch Chrome with remote debugging

Quit Chrome first, then start it with the debug port:

**macOS**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/foody-chrome
```

(The separate `--user-data-dir` keeps this debug instance independent of your normal Chrome profile — recommended for sanity. To use your real profile and its saved logins, omit `--user-data-dir`. Quit your normal Chrome first if you do.)

You can confirm the debug interface is live: `curl http://localhost:9222/json/version`.

### Run an order

In Slack: `let's eat something` → pick *Pizza Roma* → react to add dishes → hit **🛒 Order**. Foody posts "Building your cart on takeaway.com…", a new Chrome tab pops up, items get added, and a follow-up Slack message links you to the cart in your browser.

The mock restaurants in `data/takeaway-mock.json` still go through the stubbed receipt path — only the real `takeawayUrl`-flagged ones drive a Puppeteer build.

### Re-scrape

If Pizza Roma's menu changes (or you want a different real restaurant), edit `scripts/scrape-pizza-roma.mjs` (the constants at the top) and re-run it.

```bash
node scripts/scrape-pizza-roma.mjs
```

## Wiring real takeaway.com

[src/takeaway.ts:42](src/takeaway.ts#L42) — replace the body of `fetchLive()` so it returns `{ restaurants, dishes }` in the same shape as [data/takeaway-mock.json](data/takeaway-mock.json). Everything downstream — top-3 ranking, top-10 dishes, the Slack flow — runs unchanged on real data.
