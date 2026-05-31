# Foody — Brand & Style Guide

> **Work hard, skip hangry.**

Foody is Slack-native, so its identity deliberately rhymes with Slack: a hashtag
mark, the four Slack brand colors, warm neutral surfaces, and friendly rounded
type. Use this file as the single source of truth for color, type, voice, and how
Foody presents itself inside Slack (Block Kit) and anywhere else.

---

## 1. Logo

The mark is a **`#` hashtag built from four utensils** — fork, spoon, knife, and
chopsticks — each bar in one of the four brand colors. It nods to a Slack channel
(`#`) and to a shared table at once.

**Do**
- Keep generous clear space around the mark — at least the height of one bar.
- Place it on the warm off-white surface (`--foody-bg`) or pure white.
- Keep the wordmark in charcoal (`--foody-ink`), lowercase-friendly, bold.

**Don't**
- Recolor individual utensils outside the four brand colors.
- Add drop shadows beyond the soft, subtle depth already in the mark.
- Stretch, rotate, or crowd the mark.

---

## 2. Color

The core palette **is** the Slack palette — intentional, since Foody lives in Slack.

| Token | Hex | Role | Utensil |
|---|---|---|---|
| `--foody-red` | `#E23B2E` | Primary accent, alerts, "hangry" energy | Fork |
| `--foody-green` | `#2EB67D` | Success, the **Order** button, confirmations | Knife |
| `--foody-yellow` | `#ECB22E` | Highlights, pending/cart-in-progress, reactions | Spoon |
| `--foody-blue` | `#36C5F0` | Links, info, restaurant cards | Chopsticks |

### Neutrals

| Token | Hex | Role |
|---|---|---|
| `--foody-bg` | `#F6F5F1` | App / canvas background (warm off-white) |
| `--foody-surface` | `#FFFFFF` | Cards, sheets |
| `--foody-ink` | `#2D2D2D` | Primary text, wordmark |
| `--foody-ink-soft` | `#5B5B5B` | Secondary text, taglines |
| `--foody-line` | `#E4E2DB` | Borders, dividers |

### Usage rules
- **Green is reserved for the commit action** (Order / confirm). Don't use it decoratively.
- **Red is an accent, not a background** — small doses (the fork, an error pill, a price spike).
- One accent color per surface. Let the food and the content carry the rest.
- Maintain WCAG AA: charcoal on off-white passes; never put `--foody-yellow` text on white.

---

## 3. Typography

Bold, geometric, rounded — the wordmark reads as **Poppins / Nunito** family.

| Role | Font | Weight | Notes |
|---|---|---|---|
| Wordmark / display | **Poppins** | 700 | Tight tracking, the "Foody" look |
| Headings | **Poppins** | 600 | |
| Body / UI | **Inter** | 400–500 | Clean, legible at small sizes |
| Mono (prices, IDs) | **JetBrains Mono** / system mono | 400 | Tabular numerals for cart totals |

Fallback stack: `"Poppins", "Inter", -apple-system, "Segoe UI", system-ui, sans-serif`.

**Scale** (rem): `2.5 / 2 / 1.5 / 1.25 / 1 / 0.875`. Line-height `1.4` for body, `1.15` for display.

---

## 4. Shape & depth

- **Radius:** pill bars (`999px`) for the logo language; `12px` for cards, `8px` for inputs, `999px` for buttons and reaction chips.
- **Elevation:** soft and low. `0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.05)`. No hard shadows.
- **Spacing:** 4px base grid — `4 / 8 / 12 / 16 / 24 / 32 / 48`.

---

## 5. Voice & tone

Foody is the upbeat coworker who just wants everyone fed.

- **Warm, brief, a little playful.** "Foody picks up." "Hit the green button."
- **Action-first.** Tell people the one tap that moves things forward.
- **Never naggy.** Ask the address once, remember it forever.
- Light emoji, on-theme: 🍕 🍔 🛒 ✅. The dish-reaction pool is fixed: `🍕 🍔 🍟 🌮 🌯 🍣 🍜 🍱 🥗 🍝`.

Tagline: **"Work hard, skip hangry."** Use sparingly — splash screens, README, footers.

---

## 6. In Slack (Block Kit)

Slack controls most styling, so Foody's brand shows up through **structure, emoji, and the one styled button**:

- **Order button:** `style: "primary"` (renders green) — the only primary button in a flow.
- **Reset / cancel:** `style: "danger"` (red) only for destructive resets.
- **Restaurant & menu cards:** `section` + `accessory` image, `context` blocks for ratings/ETA in muted text.
- **Cart summary:** a `section` with mono-friendly alignment; totals in a `context` line.
- Lead messages with the dish emoji so the eye lands on food, not chrome.

---

## 7. Tokens

### CSS custom properties

```css
:root {
  /* Brand — the Slack four */
  --foody-red:    #E23B2E;
  --foody-green:  #2EB67D;
  --foody-yellow: #ECB22E;
  --foody-blue:   #36C5F0;

  /* Neutrals */
  --foody-bg:       #F6F5F1;
  --foody-surface:  #FFFFFF;
  --foody-ink:      #2D2D2D;
  --foody-ink-soft: #5B5B5B;
  --foody-line:     #E4E2DB;

  /* Type */
  --foody-font-display: "Poppins", "Inter", system-ui, sans-serif;
  --foody-font-body:    "Inter", -apple-system, "Segoe UI", system-ui, sans-serif;
  --foody-font-mono:    "JetBrains Mono", ui-monospace, monospace;

  /* Shape */
  --foody-radius-card:   12px;
  --foody-radius-input:  8px;
  --foody-radius-pill:   999px;
  --foody-shadow:        0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.05);

  /* Spacing (4px grid) */
  --foody-space-1: 4px;
  --foody-space-2: 8px;
  --foody-space-3: 12px;
  --foody-space-4: 16px;
  --foody-space-6: 24px;
  --foody-space-8: 32px;
}
```

### JSON (for tooling / design handoff)

```json
{
  "color": {
    "red":    "#E23B2E",
    "green":  "#2EB67D",
    "yellow": "#ECB22E",
    "blue":   "#36C5F0",
    "bg":       "#F6F5F1",
    "surface":  "#FFFFFF",
    "ink":      "#2D2D2D",
    "inkSoft":  "#5B5B5B",
    "line":     "#E4E2DB"
  },
  "font": {
    "display": "Poppins",
    "body": "Inter",
    "mono": "JetBrains Mono"
  },
  "radius": { "card": 12, "input": 8, "pill": 999 },
  "tagline": "Work hard, skip hangry"
}
```
