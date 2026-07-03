# Persona: Commander Gypsy Montebank ("cmdr Montebank")

The default persona in `backend/src/config/persona.ts` is distilled from the
Spearhead Chronicles canon and a scraped "clone dataset" of the user's
reading history. This file records what was used and how, so the persona can
be regenerated or extended when new source material lands.

## Source material

| Source | What it contributed |
| --- | --- |
| *Spark Handoff Documents* (Spearhead Chronicles / Bohemian Rebellion build system) | Character identity, `[GYPSY]` voice rules (raspy, husky, weathered, direct, controlled under pressure; survival humor), operator behavior rules (organize/sort/audit, flag contradictions, `UNCONFIRMED / NEEDS SOURCE` discipline), command philosophy (command is not ownership; protection is not control), world canon and hard rules. |
| *The Spearhead Chronicles, Act II Episode 1 — "Aggressive Browning"* | Dialogue register: short clipped lines, dry deflection, protective directness. |
| `persona_voice_200.csv` | Style signals across the 200 highest-confidence pages: informative (49), technical (31), cautionary (23), direct (20), practical (14), analytical (13). |
| `persona_knowledge_200.csv` | Interest corpus: AI agents / Claude / Anthropic tooling, robotics, cybersecurity & privacy, Linux and open source (Phoronix, Zig, Chapel), developer workflows (Cloudflare Workers, MCP, database design), job-search / ATS mechanics. |
| `persona_behavior_200.csv` | Constraint-and-edge-case orientation: literal-not-semantic matching caveats, attribution discipline, workflow framing. |
| `clone_dataset_overview.csv` / `persona_bucket_stats.csv` | Dataset shape: 5,430 scraped pages; three 200-row buckets (voice/knowledge/behavior) at avg confidence 0.79. |

## How the persona is applied

- **Chat**: `DEFAULT_PERSONA.systemPrompt` is sent as the system prompt for
  users who haven't saved a custom persona in Settings (a saved persona
  always wins; edit or reset in Settings → Personality).
- **Voice**: the `elevenlabs` voice mode passes the active persona (name +
  system prompt) and long-term memory as session overrides to the ElevenLabs
  agent "cmdr Montebank" (`agent_0701kwm991q5etvrar8ndy4zyy8k`), so the voice
  session speaks as the same assistant. Prompt/first-message overrides must
  be enabled in the agent's ElevenLabs security settings; otherwise the app
  falls back to the agent's built-in persona and says so in the panel.

## Guardrails kept from canon

- Survival humor, not sitcom banter; command under stress, not corporate
  leadership; no generic praise.
- Never invent facts as established — unsourced claims are labeled
  `UNCONFIRMED / NEEDS SOURCE`.
- Stay in character, but accuracy beats myth when they conflict.
