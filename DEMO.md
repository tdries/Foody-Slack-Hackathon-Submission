<div align="center">

# 🍴 Try Foody in 30 seconds

*Work hard, skip hangry.*

</div>

Foody lives **inside Slack**, so "playing with it" means hopping into the **Foody developer sandbox** (a Slack Developer Program workspace, per the hackathon rules) where Foody is running, and typing one phrase.

**👉 The workspace:** <https://app.slack.com/client/E0BA2TY9PRR> — open **`#foody-demo`** and type *“let's eat something”*, or ask the **✨ AI assistant**. Developer sandboxes are invite-by-email (no public join links): judges are pre-invited, everyone else can request a seat from the maintainer (see README).

---

## 👩‍⚖️ For judges — the fastest path

> 1. **Accept the sandbox invite** (sent to `slackhack@salesforce.com` / `testing@devpost.com`), then open **<https://app.slack.com/client/E0BA2TY9PRR>**.
> 2. Open the **`#foody-demo`** channel — or the ✨ **Foody assistant** in the AI-apps pane and try *“start a photo order for pizza”*.
> 3. Type: **`let's eat something`**
> 4. Pick a cuisine → pick a restaurant → **tap the emoji reactions** under the dishes to build a shared basket → hit **🛒 Order now**.

That's the whole thing. Try reacting to a few dishes and watch the total update live; un-react to remove. Invite a teammate into the channel and you'll both add to the *same* basket.

**Other commands to try:**
- `change address to Grote Markt 1, 2000 Antwerpen` — the address is sticky per person
- `reset` — clear the session and start over

> The demo runs in **mock-data mode**: instant, deterministic, and identical every time — perfect for judging. (The optional live takeaway.com checkout, which drives a real browser basket, is described in the [README](README.md#the-real-takeawaycom-checkout-opt-in).)

---

## 🎥 Prefer to watch?

A 2–3 minute walkthrough is in the submission, and the full flow is captured step-by-step with screenshots in the [README](README.md#the-order-flow).

---

## 🚀 Host your own demo (for the team)

Foody talks to Slack over **Socket Mode** — an outbound WebSocket — so it needs **no public URL** and exposes **no inbound port**. It runs anywhere that can keep a Node process alive.

### 1. Create the Slack app
Follow [README → Slack app setup](README.md#slack-app-setup) (paste [docs/slack-manifest.yml](docs/slack-manifest.yml), grab the three secrets).

### 2. Deploy as an always-on worker

**Render (one blueprint, included):**
1. Render dashboard → **New → Blueprint** → point at this repo (it reads [`render.yaml`](render.yaml)).
2. Set the three secrets: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`.
3. Deploy. `FOODY_DISABLE_LIVE=1` is already set for bulletproof mock mode.

**Railway / Fly / any Docker host:** the included [`Dockerfile`](Dockerfile) builds a self-contained worker.
```bash
docker build -t foody .
docker run -e SLACK_BOT_TOKEN=xoxb-… -e SLACK_APP_TOKEN=xapp-… \
           -e SLACK_SIGNING_SECRET=… -e FOODY_DISABLE_LIVE=1 foody
```

**Just your laptop (simplest for a live judging session):**
```bash
npm install
cp .env.example .env   # fill in the three SLACK_* secrets
npm run start:demo     # mock mode, no Chrome needed
```

### 3. Open it up to your testers
- Create a `#foody-demo` channel and `/invite @Foody`.
- In a **developer sandbox**, invite testers by email (Developer Program dashboard → your sandbox → *Invite collaborators*; seats are limited). In a regular workspace, a shareable invite link works too (**Admin → Invite People**).
- Anyone who joins can immediately type `let's eat something` — or open the ✨ assistant.

> 💡 Keep the demo workspace separate from any real workspace, and remove guest seats after judging.
