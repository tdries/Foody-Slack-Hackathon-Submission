<div align="center">

# 🍴 Foody

### *Work hard, skip hangry.*

**A Slack-native group food-ordering agent, built on Slack's AI capabilities.** Ask Foody's ✨ AI assistant for *"something spicy for six under €15"* — or just type **"let's eat something"** — and it takes the whole team from hungry to ordered, without anyone leaving Slack.

</div>

---

## Inspiration

Every team knows the thread. It's 12:14, someone posts *"lunch?"*, and twenty minutes vanish into scrolling menus, pasting links, copy-pasting orders into a DM, and one person becoming the human spreadsheet who tallies it all up and pays.

The food is easy. The **coordination** is the tax.

So we looked for the simplest interface imaginable — and realised the team is *already* in Slack, which already has a universal, zero-learning-curve input device: the **emoji reaction**. Everyone knows how to tap one. What if ordering lunch together was just… reacting to a message? And what if *planning* the order was just telling an assistant what you're in the mood for? No new app, no link, no spreadsheet. That idea became Foody.

---

## What it does

Foody is a **Slack AI app**: it lives in the ✨ AI-apps pane with a full assistant surface — **assistant threads, live status updates, and suggested prompts** — powered by **Claude with tool use**. It has no interface of its own; Slack *is* the interface.

**Start with the AI assistant** — *"top pizza spots near the office? what does the best one charge for a margherita?"* — and Claude compares restaurants, answers budget and menu questions, remembers your delivery address, and shows a live status (*"is scanning takeaway.com…"*) while it works. When you say go, its `start_group_order` tool posts the order into your channel. Or skip the chat and type **"let's eat something"** — both doors lead to the same flow:

1. **📍 Address** — sticky per Slack user. Asked once, remembered forever; change it anytime with *"change address to …"*.
2. **🏠 Top 3 restaurants** near you — ranked, shown as one-tap Block Kit cards.
3. **🍽️ Top 10 dishes** — one single message that Foody **pre-reacts** to. Compact emoji grid, or **📸 photo view** with real dish photography from the restaurant — the order starter picks.
4. **🛒 Shared basket** — anyone's reaction adds a dish, un-reacting removes it; the running total updates live for the whole team.
5. **✅ One-tap order** — hit the green button and Foody assembles the real basket on Takeaway.com, ready to confirm.

The entire experience is the chat itself: an assistant conversation, messages, cards, buttons, and reactions. Nothing to install, nothing to learn.

---

## How we built it

Foody is a small TypeScript app that runs **headless** behind your firewall — a background worker with no public URL and no frontend. **Slack's AI capabilities are the front door**: the assistant surface hosts Claude with tools to plan the order in natural language. The moment an order starts, the assistant hands off to a deliberately **deterministic** flow — phrase matchers, reactions, reconciliation — so the shared basket itself always behaves exactly the same way: fast, predictable, debuggable.

| Layer | Responsibility |
|---|---|
| **`assistant.ts`** | The Slack AI assistant: assistant threads, live status, suggested prompts, Claude tool use, and the `start_group_order` bridge into the channel flow. |
| **`app.ts`** | Slack on **Bolt + Socket Mode**: triggers, buttons, reaction events, every Block Kit post & update. |
| **`blocks.ts`** | Block Kit builders: restaurant cards, the unified menu+cart card (emoji grid or photo view), the animated build-progress card, the receipt. |
| **`intent.ts`** | Plain phrase matchers for *"let's eat"*, *"order"*, *"reset"*, *"change address to …"*. |
| **`state.ts`** | JSON persistence keyed two ways: `addr_<user>` for the sticky address book, `sess_<channel>_<thread>` for the live cart. |
| **`takeaway.ts` + `scrape-live.ts`** | Restaurant/dish discovery with an in-memory + 24-hour disk-TTL cache and a daily background prewarm. Market-configurable: Belgium by default, any Just Eat Takeaway country by env switch. |
| **`checkout.ts`** | Assembles the real basket on Takeaway.com, ready to confirm. |

Three design decisions we're proud of:

- **🧠 AI where it helps, deterministic where it counts.** Claude plans, compares, and negotiates budgets in the assistant pane. The basket itself is pure reconciliation — every reaction maps to exactly one outcome. The AI can never "hallucinate" your lunch: it only ever hands off to a flow the whole team can see and verify.
- **🩹 Reactions are the source of truth.** The basket is reconciled from the *actual* emoji reactions on the menu message — not a running tally of events. Any single interaction re-derives the entire cart from ground truth, so it stays perfectly in sync with what the team can see and **self-heals** by construction.
- **🛰️ Headless and private, with no public URL.** Foody talks to Slack over an **outbound WebSocket (Socket Mode)** — nothing inbound, nothing leaving the workspace. The agent never needs a UI of its own, because Slack is the UI.

The food layer is deliberately **swappable**: today Foody discovers menus through a headless browser and assembles the basket in your signed-in session, all behind a clean interface — so the exact same Slack experience (assistant included) can sit on top of an official partner API with zero changes above it (see *What's next*).

---

## What makes it special

- **✨ Slack AI capabilities, used for real.** Assistant threads for multi-turn planning, live status while tools run, suggested prompts for one-tap starts — the assistant isn't a chatbot bolted on, it's the front door that hands off to the group.
- **🪄 The interface is just emoji.** No forms, no webview — the entire group-ordering UX is reactions on a message, and it feels effortless.
- **📸 Menus you can taste.** One tap flips the menu from a compact emoji grid to real dish photography, straight from the restaurant.
- **🩹 A self-healing basket.** Because the cart is reconciled from the message's real reactions, it converges to the correct state every time — robust by construction, not by luck.
- **🛒 A real checkout.** Not a mocked receipt — Foody assembles an actual Takeaway.com basket with your address ready to confirm.
- **🎨 A brand of its own.** A utensil-hashtag mark in the Slack palette, a tagline (*"Work hard, skip hangry"*), and a small design system — down to an animated, constantly-moving build-progress card.

---

## What we learned

- **Pair the model with a machine.** An LLM is brilliant at the fuzzy front (*"spicy, six people, under €15"*) and wrong for the exact back (money, shared state). Letting Claude plan and a deterministic flow execute gave us both — and Slack's assistant surface is precisely the seam to split them along.
- **Design for the message, not the event.** Treating the visible state (reactions on a message) as the source of truth — *reconcile, don't accumulate* — turns a fragile event stream into something inherently robust.
- **Headless + Socket Mode is a sweet spot for agents.** An outbound WebSocket with no public URL makes a Slack agent simple to deploy, private by default, and safe to run anywhere.
- **Constraints make better UX.** Limiting the interface to emoji reactions forced a design that's faster and friendlier than any custom form we could have built.

---

## What's next for Foody

- **🔌 Fully headless ordering via an official partner API.** The Slack experience — assistant included — stays identical; the food layer swaps from a headless browser to **Just Eat Takeaway.com's partner API**: real orders, payment, and **live delivery tracking** pushed straight back into the thread.
- **💸 Built-in bill splitting.** Automatic per-person totals and a "you owe" summary posted to the thread when the order closes.
- **⏰ Scheduled & recurring lunches.** "Every Friday at 12:00, ask the channel," plus one-tap re-orders of last week's favourite.
- **🗳️ Smarter consensus.** Dietary filters and budget caps the assistant already understands, promoted into quick polls for the whole group.
- **🌍 Broader coverage.** Any Just Eat Takeaway market is already a config switch (🇧🇪🇳🇱🇩🇪…); more providers behind the same emoji interface next.

<div align="center">

---

**Foody** · group food ordering for Slack · `/invite @Foody` → type *"let's eat something"* — or just ask the ✨ assistant

*Work hard, skip hangry.* 🍴

</div>
