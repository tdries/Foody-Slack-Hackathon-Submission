# Foody — Demo Voiceover Script (ElevenLabs)

**Style:** modern tech-demo smooth — warm, confident, unhurried. Think a polished product launch
narrator, not a hype ad. Land each line, small breath between segments. ~45–55s total.

## How to record (this is also what makes audio + video sync)

Record **each segment as its own clip** and export it named `vo-0.mp3 … vo-9.mp3` into
`docs/demo/`. The render pipeline holds each on-screen segment for the exact length of its
matching clip, so the picture can never drift from the narration. (One long file works too,
but per-segment is what guarantees the click animations land on the right words.)

### Suggested ElevenLabs settings
- **Voice:** a calm, modern narrator — e.g. *Adam*, *Brian*, or *Rachel* (pick male/female to taste).
- **Model:** Eleven Multilingual v2 (or Turbo v2.5 for speed).
- **Stability:** ~45–50  · **Similarity:** ~75  · **Style:** ~10–15 (low = natural, not theatrical) · **Speaker boost:** on.
- Keep punctuation as written — the em-dashes and commas are pacing cues.

---

## The script (per segment)

**vo-0** — *(Maya: "Anyone else starving?")*
> It's noon — and the team is already starving.

**vo-1** — *(Tom & Dana reply: deciding takes forever)*
> Normally, agreeing on lunch burns twenty minutes and everyone's patience.

**vo-2** — *(Maya types "let's eat something")*
> Not today. Someone just types — *let's eat something.*

**vo-3** — *(Foody replies, already knows the address)*
> Foody answers instantly… and it already knows where the team is sitting.

**vo-4** — *(cuisine buttons appear, cursor taps "Kebab")*
> One tap picks the cuisine.

**vo-5** — *(top-3 restaurants appear, cursor taps "See menu")*
> Foody pulls up the top-rated spots nearby — and opens the menu.

**vo-6** — *(menu card appears, empty shared basket)*
> Now here's the part that actually saves the lunch.

**vo-7** — *(the taps: Maya, Tom, Dana each tap a different dish emoji — shared basket fills)*
> The whole team reacts at once. Maya taps the dürüm, Tom adds a pizza, Dana grabs a salad — and every emoji drops straight into one shared basket.

**vo-8** — *(cursor taps "Order now" → Foody works on takeaway.com)*
> One tap to order — and Foody rebuilds that exact basket on takeaway-dot-com, live.

**vo-9** — *(receipt lands in thread, Tom: "fed in under a minute")*
> Done. The receipt lands right back in the thread. Lunch — sorted in under a minute. Foody: work hard, skip hangry.

---

## One-block version (if you prefer a single take)

> It's noon — and the team is already starving. Normally, agreeing on lunch burns twenty minutes and everyone's patience. Not today. Someone just types — *let's eat something.* Foody answers instantly… and it already knows where the team is sitting. One tap picks the cuisine. Foody pulls up the top-rated spots nearby, and opens the menu. Now here's the part that actually saves the lunch: the whole team reacts at once. Maya taps the dürüm, Tom adds a pizza, Dana grabs a salad — and every emoji drops straight into one shared basket. One tap to order, and Foody rebuilds that exact basket on takeaway-dot-com, live. Done — the receipt lands right back in the thread. Lunch, sorted in under a minute. Foody: work hard, skip hangry.
