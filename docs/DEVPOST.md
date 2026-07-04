<div align="center">

# 🍴 Foody

### *Work hard, skip hangry.*

**A Slack-native group food-ordering agent.** Someone types **“let's eat something”** and Foody takes the whole team from hungry to ordered — without anyone leaving the channel.

</div>

---

## Inspiration

Every team knows the thread. It's 12:14, someone posts *“lunch?”*, and twenty minutes vanish into scrolling menus, pasting links, copy-pasting orders into a DM, and one person becoming the human spreadsheet who tallies it all up and pays.

The food is easy. The **coordination** is the tax.

So we looked for the simplest interface imaginable — and realised the team is *already* in Slack, which already has a universal, zero-learning-curve input device: the **emoji reaction**. Everyone knows how to tap one. What if ordering lunch together was just… reacting to a message? No new app, no link, no spreadsheet. That idea became Foody.

---

## What it does

Foody is a **headless agent** that lives in your Slack workspace — it has no interface of its own; Slack *is* the interface. Drop **“let's eat something”** in a channel and it runs the whole order as a conversation:

1. **📍 Address** — sticky per Slack user. Asked once, remembered forever; change it anytime with *“change address to …”*.
2. **🏠 Top 3 restaurants** near you — ranked, shown as one-tap Block Kit cards.
3. **🍽️ Top 10 dishes** — posted as a single message that Foody **pre-reacts** to with `🍕 🍔 🍟 🌮 🌯 🍣 🍜 🍱 🥗 🍝`.
4. **🛒 Shared basket** — anyone's reaction adds a dish, un-reacting removes it; the running total updates live for the whole team.
5. **✅ One-tap order** — hit the green button and Foody assembles the real basket on Takeaway.com, ready to confirm.

The entire experience is the chat itself: messages, cards, buttons, and reactions. Nothing to install, nothing to learn.

---

## How we built it

Foody is a small TypeScript app that runs **headless** behind your firewall — a background worker with no public URL and no frontend. It uses **Slack's AI capabilities** as its front door: a full **AI-app assistant surface** (assistant threads, live status updates, suggested prompts) where **Claude with tool use** plans the order in natural language — compare restaurants, fit a budget, pick photo or compact menus. When you say go, the assistant's `start_group_order` tool hands off to a deliberately **deterministic** channel flow (phrase matchers, emoji reactions, reconciliation), so the shared basket itself always behaves exactly the same way: fast, predictable, debuggable.

| Layer | Responsibility |
|---|---|
| **`app.ts`** | Slack on **Bolt + Socket Mode**: triggers, buttons, reaction events, every Block Kit post & update. |
| **`blocks.ts`** | Block Kit builders: restaurant cards, the unified menu+cart card, the animated build-progress card, the receipt. |
| **`intent.ts`** | Plain phrase matchers for *“let's eat”*, *“order”*, *“reset”*, *“change address to …”*. A list, not a model. |
| **`state.ts`** | JSON persistence keyed two ways: `addr_<user>` for the sticky address book, `sess_<channel>_<thread>` for the live cart. |
| **`takeaway.ts` + `scrape-live.ts`** | Restaurant/dish discovery with an in-memory + 24-hour disk-TTL cache and a daily background prewarm. |
| **`checkout.ts`** | Assembles the real basket on Takeaway.com, ready to confirm. |

Three design decisions we're proud of:

- **🛰️ Headless and private, with no public URL.** Foody talks to Slack over an **outbound WebSocket (Socket Mode)**, so it runs as a background worker behind your firewall — nothing inbound, nothing leaving the workspace. The agent never needs a UI of its own, because Slack is the UI.
- **🩹 Reactions are the source of truth.** The basket is reconciled from the *actual* emoji reactions on the menu message — not a running tally of events. Any single interaction re-derives the entire cart from ground truth, so it stays perfectly in sync with what the team can see and **self-heals** by construction.
- **🤖 Slack AI capabilities, used for real.** The assistant pane (assistant threads + live status + suggested prompts) is the planning brain — Claude with tools. The order flow it hands off to stays deterministic: every reaction maps to exactly one outcome, which keeps the shared basket easy to trust.

The food layer is deliberately **swappable**: today Foody discovers menus through a **headless browser** and assembles the basket in your signed-in session, all behind a clean interface — so the exact same Slack experience can sit on top of an official partner API with zero changes above it (see *What's next*).

---

## What makes it special

- **🪄 The interface is just emoji.** No forms, no webview — the entire group-ordering UX is reactions on a message, and it feels effortless.
- **🩹 A self-healing basket.** Because the cart is reconciled from the message's real reactions, it converges to the correct state every time — robust by construction, not by luck.
- **🛰️ A genuinely headless agent.** No frontend, no public endpoint; it runs quietly as a worker and speaks only Slack. Simple to host, easy to trust, safe to run anywhere.
- **🛒 A real checkout.** Not a mocked receipt — Foody assembles an actual Takeaway.com basket with your address ready to confirm.
- **🎨 A brand of its own.** A utensil-hashtag mark in the Slack palette, a tagline (*“Work hard, skip hangry”*), and a small design system — down to an animated, constantly-moving build-progress card.

---

## What we learned

- **Design for the message, not the event.** Treating the visible state (reactions on a message) as the source of truth — *reconcile, don't accumulate* — turns a fragile event stream into something inherently robust. It's the single idea the whole product rests on.
- **Headless + Socket Mode is a sweet spot for agents.** An outbound WebSocket with no public URL makes a Slack agent simple to deploy, private by default, and safe to run anywhere — exactly what you want for something that lives inside a workspace.
- **Constraints make better UX.** Limiting the interface to emoji reactions forced a design that's faster and friendlier than any custom form we could have built.

---

## What's next for Foody

- **🔌 Fully headless ordering via an official partner API.** The Slack experience stays identical; the food layer swaps from a headless browser to **Just Eat Takeaway.com's partner API** — making the whole agent cloud-native and deployable anywhere, with real orders, payment, and **live delivery tracking** pushed straight back into the thread.
- **🍱 Real dish-photo emojis.** Menu-item images uploaded as workspace custom emojis, so the team reacts with the *actual* dish.
- **💸 Built-in bill splitting.** Automatic per-person totals and a “you owe” summary posted to the thread when the order closes.
- **⏰ Scheduled & recurring lunches.** “Every Friday at 12:00, ask the channel,” plus one-tap re-orders of last week's favourite.
- **🗳️ Smarter consensus.** Quick polls, dietary filters, and budget caps so the group converges even faster.
- **🌍 Broader coverage.** More cities and providers behind the same emoji interface.

<div align="center">

---

**Foody** · group food ordering for Slack · `/invite @Foody` → type *“let's eat something”*

*Work hard, skip hangry.* 🍴

</div>
