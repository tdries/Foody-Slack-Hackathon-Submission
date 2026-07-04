/**
 * Offline smoke test for the assistant's Claude tool-use loop.
 * No Slack needed: mock restaurant data (FOODY_DISABLE_LIVE=1) + a stubbed
 * start_group_order. Fails loudly if the loop, the tools, or the API break.
 *
 *   cd Foody && FOODY_DISABLE_LIVE=1 npx tsx scripts/smoke-assistant.mts
 */
import { parseEnv } from "node:util";
import { readFileSync as _envRead } from "node:fs";
try { Object.assign(process.env, parseEnv(_envRead(".env", "utf-8"))); } catch {}
import { runAssistantTurn } from "../src/slack/assistant.ts";

const calls: string[] = [];

const reply = await runAssistantTurn({
  history: [
    {
      role: "user",
      content:
        "Find pizza near Veldstraat 1, 9000 Gent and start a group order at the best-rated spot.",
    },
  ],
  userId: "UTEST",
  contextChannel: "C0TEST",
  onStatus: async (s) => calls.push(`status:${s}`),
  startGroupOrder: async (req) => {
    calls.push(`start_group_order:${req.restaurant_id ?? "picker"}`);
    return JSON.stringify({ ok: true, posted: "menu", channel: "<#C0TEST>", link: null });
  },
});

console.log("reply:", reply, "\ncalls:", calls);
if (!reply || reply.length < 10) throw new Error("empty reply");
if (!calls.some((c) => c.startsWith("start_group_order:")))
  throw new Error("start_group_order was never called");
console.log("✅ smoke test passed");
