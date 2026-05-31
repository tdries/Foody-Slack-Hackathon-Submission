<div align="center">

# 🍴 Foody

### *Work hard, skip hangry.*

**A Slack-native group food-ordering bot that fronts takeaway.com.**
Someone types **“let's eat something”** and Foody takes the whole team from hungry to ordered, without anyone leaving the channel.

</div>

---

## Inspiration

Every team knows the thread. It's 12:14, someone posts *“lunch?”*, and what follows is twenty minutes of scrolling menus, pasting links, copy-pasting orders into a DM, and one poor soul becoming the human spreadsheet who tallies it all up and pays.

The food part is easy. The **coordination** is the tax.

We kept coming back to one observation: the team is *already* in Slack, and Slack already has a perfect, universal, zero-learning-curve input device, the **emoji reaction**. Everyone knows how to tap one. So what if ordering lunch together was just… reacting to a message? No new app, no link, no spreadsheet. That idea became Foody.

---

## What it does

Foody lives in your Slack workspace. Drop **“let's eat something”** in a channel and it runs the whole order as a conversation:

1. **📍 Address**: sticky per Slack user. Asked once, remembered forever. Change it anytime with *“change address to …”*.
2. **🏠 Top 3 restaurants** near you: ranked, shown as one-tap Block Kit cards.
3. **🍽️ Top 10 dishes** posted as a single message that Foody **pre-reacts** to with `🍕 🍔 🍟 🌮 🌯 🍣 🍜 🍱 🥗 🍝`.
4. **🛒 Shared basket**: anyone's reaction adds a dish, un-reacting removes it. The running total updates live for the whole team.
5. **✅ One-tap order**: hit the green button and Foody builds the real basket on takeaway.com in your browser, ready to confirm.

The entire interface is the chat itself: messages, cards, buttons, and reactions. There is nothing to install and nothing to learn.

---

## How we built it

Foody is a small, **deterministic** TypeScript app. There is deliberately **no LLM in the request path**, so a given input always does exactly the same thing.

| Layer | Responsibility |
|---|---|
| **`app.ts`** | Slack plumbing on **Bolt + Socket Mode**: triggers, buttons, reaction events, every Block Kit post & update. |
| **`blocks.ts`** | Block Kit builders: restaurant cards, the unified menu+cart card, the animated build-progress card, the receipt. |
| **`intent.ts`** | Plain phrase matchers for *“let's eat”*, *“order”*, *“reset”*, *“change address to …”*. A list, not a model. |
| **`state.ts`** | JSON persistence, keyed two ways: `addr_<user>` for the sticky address book, `sess_<channel>_<thread>` for the live cart. |
| **`takeaway.ts` + `scrape-live.ts`** | Restaurant/dish lookup with an in-memory + 24-hour disk TTL cache and a daily background prewarm. |
| **`checkout.ts`** | Drives your **already-running Chrome over the DevTools Protocol** to fill the real basket in a background tab. |

A few design choices we leaned on:

- **Socket Mode, not webhooks.** Foody runs behind your firewall over an outbound WebSocket. No public URL, nothing leaves the workspace.
- **Reactions are the source of truth.** The basket is reconciled from the *actual* reactions on the menu message, not a running tally of events.
- **Two browsers, on purpose.** A stealth headless browser scrapes listings, while checkout attaches to *your* Chrome so the basket lands in your signed-in, Cloudflare-cleared session.

---

## Challenges we ran into

Building something that *feels* like a simple conversation turned out to require a lot of resilience underneath:

- **🌐 Dropped events silently desynced the cart.** Slack's Socket Mode doesn't replay events missed during a disconnect, so on a flaky network a reaction would land on the message but never reach the bot, and the basket would quietly drift from what everyone could see. We rebuilt the cart logic to **reconcile from the message's real reactions** via `reactions.get`, so a single delivered event (or the Order click) re-syncs the whole basket. It now self-heals.
- **👯 A phantom second bot.** For a while, the same fixes seemed to “half-work”: bugs appeared intermittently. The culprit was an **old clone of the app still running and connected to the same Slack token**, and Socket Mode was load-balancing clicks between the new code and the stale one. Every interaction was a coin flip.
- **♻️ State that didn't survive a restart.** Live-scraped restaurants only lived in an in-memory cache, so a process restart between *picking* a restaurant and *ordering* it produced “couldn't find that restaurant anymore.” We started **snapshotting** the picked restaurant and menu into the session and re-warming the cache from it.
- **🏠 The disappearing address.** A sticky address is the whole promise, yet edge cases could load a session that had lost it. We made every step **recover the address from the address book** instead of dead-ending the user.
- **🛡️ Cloudflare vs. headless Chrome.** takeaway.com is fronted by Cloudflare Turnstile, which fingerprints and blocks bundled-Chromium Puppeteer. That's exactly why checkout **connects to the user's real Chrome** over CDP: it already holds a valid clearance and the signed-in session.

---

## Accomplishments that we're proud of

- **🪄 The interface is just emoji.** No forms, no webview: the entire group-ordering UX is reactions on a message, and it genuinely feels effortless.
- **🩹 A self-healing basket.** Even with the network dropping under it, Foody converges to the correct cart. Reconciling from ground truth turned a fragile event tally into something robust.
- **🛒 A *real* checkout.** Not a mocked receipt: Foody drives an actual takeaway.com basket in your browser, with your saved address and payment ready to confirm.
- **⚙️ Deterministic by design.** No model in the runtime path means it's fast, predictable, and debuggable. It does the same thing every single time.
- **🎨 A brand that's all its own.** A utensil-hashtag mark in the Slack palette, a tagline (*“Work hard, skip hangry”*), and a tiny design system, right down to an animated, constantly-moving build-progress bar.

---

## What we learned

- **Design for the message, not the event.** The biggest reliability win came from treating the visible state (reactions on a message) as the source of truth, rather than trusting a stream of deltas. *Reconcile, don't accumulate.*
- **Socket Mode has sharp edges.** It's wonderfully simple for local/private apps, but it won't replay what you miss, and it'll happily fan events out across every connected instance. One token, one running instance.
- **Sometimes the right browser is the user's.** Fighting Cloudflare with a fresh headless instance is a losing battle; borrowing the session that already passed the challenge is the pragmatic, robust path.
- **Idempotent, self-contained state pays for itself.** Snapshotting just enough into each session made the whole flow survive restarts, and made debugging dramatically easier.

---

## What's next for Foody: *Work hard, skip hangry*, a group food ordering app

- **🍱 Real dish-photo emojis.** Replacing the thematic standard emojis with actual menu-item images uploaded as workspace custom emojis, so the team reacts with the *real* dish.
- **💸 Built-in bill splitting.** Automatic per-person totals and a “you owe” summary posted to the thread when the order closes.
- **⏰ Scheduled & recurring lunches.** A “every Friday at 12:00, ask the channel” trigger, plus one-tap re-orders of last week's favourite.
- **🗳️ Smarter consensus.** Quick polls, dietary filters, and budget caps so the group converges even faster.
- **🌍 Broader coverage.** More cities and restaurants, and a clean path to swap the takeaway.com layer for any delivery provider behind the same interface.
- **🤖 An optional AI concierge.** Kept *out* of the deterministic core, but available on the side for “surprise us” or “something light under €12” style requests.

<div align="center">

---

**Foody** · group food ordering for Slack · `/invite @Foody` → type *“let's eat something”*

*Work hard, skip hangry.* 🍴

</div>
