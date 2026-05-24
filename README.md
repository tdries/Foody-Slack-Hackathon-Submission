# Foody

A WhatsApp-native food-ordering agent that fronts takeaway.com. You text "let's eat something" and Foody walks you through: address → top 3 restaurants → top 10 dishes → emoji-driven cart → confirmed order.

## How it fits together

Two layers, on purpose:

1. **The `foody` CLI** (this repo) — owns data, state, and cart math. Per-user state files live in [state/](state/). Restaurant + menu data lives in [data/takeaway-mock.json](data/takeaway-mock.json). The real takeaway.com integration is a stub in [src/takeaway.ts](src/takeaway.ts#L42) — `fetchLive()` returns `null`, so the CLI falls back to the mock.

2. **The `foody` Claude Code skill** at [~/.claude/skills/foody/SKILL.md](~/.claude/skills/foody/SKILL.md) — owns the WhatsApp conversation. Detects food-order intent on inbound messages, calls the CLI, renders the JSON back as a WhatsApp-friendly reply, and sends it via the `plugin:whatsapp-evolution:whatsapp` MCP `reply` tool.

Keeping the CLI presentation-free means you can iterate on the WhatsApp tone in the skill without touching code, and vice versa.

## Install

```bash
npm install
```

Then point any WhatsApp instance running the `plugin:whatsapp-evolution:whatsapp` MCP plugin at Claude Code. The skill takes over on food-order intent.

## CLI usage

All commands output JSON.

```bash
npm run foody -- address <user> --set "Veldstraat 1, 9000 Gent"
npm run foody -- restaurants <user>
npm run foody -- menu <user> --index 1
npm run foody -- cart <user> --add "🍕,🍔,🍔"
npm run foody -- cart <user>
npm run foody -- order <user>
npm run foody -- status <user>
npm run foody -- reset <user>
```

`<user>` should be the WhatsApp `remoteJid` (or stripped phone number). State is keyed by that and persisted in [state/](state/).

## Wiring a real takeaway.com

Replace the body of `fetchLive()` in [src/takeaway.ts](src/takeaway.ts#L42) so it returns the same shape as the mock (`{ restaurants: [...], dishes: [...] }`). Everything downstream — restaurants ranking, top-10 dishes, cart, order — already runs on that shape.

## Data shape

See [data/takeaway-mock.json](data/takeaway-mock.json) for the schema. Restaurants are filtered by Belgian postcode (extracted from the address string) and ranked by `rating, reviewCount`. Dishes are ranked by `popularity` to produce the top-10.
