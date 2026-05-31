# Foody — Messaging Kit

The single source of truth for how we describe Foody. Copy from here so every surface
(Devpost, LinkedIn, README, deck, video) stays consistent.

---

## Name & tagline
- **Product:** Foody
- **Tagline:** *Work hard, skip hangry.*
- **Category:** Group food-ordering agent for Slack

## One-liner (≤ 100 chars)
> Foody lets your whole team order lunch in Slack by tapping emoji reactions.

## Elevator pitch — short (1 sentence)
> Foody is a Slack agent that turns the daily "what's for lunch?" thread into one shared basket built from emoji reactions, then places the order on Just Eat Takeaway.com.

## Elevator pitch — medium (2–3 sentences)
> Every team knows the 12:14 lunch thread: twenty minutes of scrolling menus, pasting links, and one person tallying everyone's order by hand. Foody removes that coordination tax. Someone types "let's eat something," the team taps emoji reactions to build one shared basket, and Foody places the order on Just Eat Takeaway.com — all without leaving Slack.

## Elevator pitch — long (paragraph)
> Foody is a group food-ordering agent that lives entirely inside Slack. The food is easy; the *coordination* is the tax — so Foody makes the entire ordering flow a conversation. Drop "let's eat something" in a channel and Foody greets the team, remembers each person's delivery address, surfaces the top-rated restaurants nearby, and posts the top dishes as a single message it pre-reacts to. Anyone adds a dish by tapping its emoji; un-reacting removes it. The running total updates live for everyone, the basket is reconciled from the *actual* reactions on the message (so it self-heals even if Slack drops an event), and one tap places the order on Just Eat Takeaway.com. No app to install, no links to chase, no spreadsheet — the whole interface is the emoji reaction every team already knows how to use.

---

## The problem (use verbatim)
> It's 12:14. Someone posts "lunch?" and twenty minutes vanish into scrolling menus, pasting links, copy-pasting orders into a DM, and one poor soul becoming the human spreadsheet who tallies it all and pays. The food is easy. The coordination is the tax.

## The solution (use verbatim)
> The team is already in Slack, and Slack already has a universal, zero-learning-curve input device: the emoji reaction. So that's the entire interface. Group ordering is just reacting to a message.

---

## Key features (pick what fits the surface)
- 🪄 **Emoji is the interface** — group ordering with zero new UI, no forms, no webview.
- 🧭 **Self-healing shared basket** — reconciled from the real reactions on the message, not a fragile event tally; a dropped Slack event never desyncs the cart.
- 📍 **Sticky address book** — asked once per person, remembered forever; change it with "change address to …".
- 🛒 **Real checkout** — drives an actual Just Eat Takeaway.com basket, ready to confirm.
- ⚙️ **Deterministic by design** — no LLM in the runtime path; same input, same result, every time.
- 🔌 **Private by default** — runs over Slack Socket Mode (outbound WebSocket); no public URL, nothing leaves the workspace.

## Value props by audience
- **For teams:** lunch goes from a 20-minute thread to a few emoji taps.
- **For the coordinator:** nobody has to be the human spreadsheet anymore.
- **For IT/security:** nothing leaves the workspace; no inbound port, no public URL.
- **For developers:** deterministic, debuggable, self-hostable in ~5 minutes.

---

## Hackathon framing
- **Event:** Slack Agent Builder Challenge (Slack / Salesforce)
- **Track:** New Slack Agent
- **Submission deadline:** July 13, 2026

## Fact sheet
| | |
|---|---|
| What | Group food-ordering agent for Slack |
| Trigger | "let's eat something" in any channel |
| Interface | Emoji reactions on a Block Kit message |
| Integration | Just Eat Takeaway.com |
| Transport | Slack Bolt over Socket Mode (no public URL) |
| Stack | TypeScript · Node.js 22 · Block Kit · Puppeteer |
| Runtime | Deterministic — no LLM in the request path |
| Repo | github.com/tdries/Foody-Slack-Hackathon-Submission |
| Demo | https://www.youtube.com/watch?v=TJ0aVqwF8wQ |

## Boilerplate (the "About" paragraph)
> Foody is a group food-ordering agent for Slack. Type "let's eat something," and the whole team builds one shared basket by tapping emoji reactions — then Foody places the order on Just Eat Takeaway.com, all without leaving the channel. Built for the Slack Agent Builder Challenge. *Work hard, skip hangry.*

---

## X / short social post
> Ordering lunch as a team takes 20 minutes and one human spreadsheet.
>
> Foody fixes it: type "let's eat something" in Slack, the team taps emoji to build one shared basket, and it orders on Just Eat Takeaway.com. No app, no links, no spreadsheet.
>
> 60-sec demo 👇 https://www.youtube.com/watch?v=TJ0aVqwF8wQ

## Do / don't
- ✅ "Just Eat Takeaway.com" (full brand on first mention).
- ✅ "agent" (matches the Agent Builder Challenge framing).
- ✅ Lowercase trigger phrase in quotes: "let's eat something".
- ❌ Don't call it a "chatbot" — it's deterministic, not conversational AI.
- ❌ Don't claim AI/LLM in the runtime path — there isn't one (that's a feature).
