# Working agreements

Rules for Claude (and anyone else) working in this repo. They came out of the
Orchestration Hub post-mortem and are meant to be extended: when a project
teaches us something, add a rule here with the incident that earned it.

## Before building

1. **Check prior art first (don't reinvent the wheel).** Before designing a
   feature, search all three states and record the result in
   `docs/prior-art/<feature>.md`:
   - **Open source** — frameworks, self-hostable apps, reference repos.
   - **Purchase** — one-time licenses (e.g. bring-your-own-key clients).
   - **Subscription** — hosted SaaS and aggregator platforms.

   For each candidate note: what it covers, what it misses for us, license or
   price, and maintenance risk (abandoned, acquired, pivoted). Then decide
   explicitly: **adopt**, **adapt**, or **build**, with the reason. Prefer
   adopting a maintained dependency over writing a new one. Search summaries
   are leads, not facts — open the vendor docs or repo before relying on a
   claim, and say so when we haven't.
2. **Surface assumptions before coding.** State the two or three riskiest
   assumptions in one message and let the user correct them (auth and billing
   model, deploy target, base branch). Don't bury them in the summary.
   *Incident:* "my LLM accounts" meant consumer subscriptions (ChatGPT, Claude,
   Gemini plans), and the hub was built on pay-per-token API keys instead. When
   a request names a vendor product or account type, ask which access path
   (API, subscription, CLI, browser) the user means before designing.
3. **Read the vendor's current terms before automating a consumer account.**
   Quote the relevant clauses in the prior-art doc; if a page can't be fetched,
   say so and don't assume it's allowed.
4. **Load the relevant skill first** when writing against a provider API
   (e.g. `claude-api` for Anthropic). Don't hard-code model names from memory.

## While building

5. **Match the codebase.** Read the existing patterns first and follow them
   (DatabaseAdapter, router and `asyncHandler` style, SSE helpers).
6. **Test the core logic first**, using a mocked `fetch` where needed.
   Peripheral code (storage, helpers) is not a substitute.
7. **Anything long-running must survive restarts.** Persist its state and
   reconcile it on boot (e.g. reset sessions stuck in `running`).
8. **Anything that calls paid APIs needs a cost and limits review**: token or
   spend caps, bounded rounds, bounded context growth.
9. **Validate user-supplied URLs** that the server will fetch.

## Before merging

10. **CI must run tests and gate merges.** A preview deploy is not a test.
11. **Report verification honestly.** Say what was exercised and what was not.
    "Tests pass" is only true for the code the tests cover.
12. Ask about the base branch and deploy target up front rather than guessing.

## Known open items (Orchestration Hub)

- Sessions can stay stuck on "Running" after a backend restart (the running
  flag is in memory; the database status is never reconciled).
- No token or spend cap on hub runs; each turn resends up to 30k characters.
- The orchestrator, the API provider clients (OpenAI, Anthropic, Google) and the
  UI still have no tests. Only the storage, CLI runner and agent routes do.
- Model-name placeholders in the agent form are likely stale.
- CLI agents (subscription logins, local only) are tested with fake CLIs only; the
  real `claude`, `codex` and `gemini` flags and the Antigravity replacement for
  Gemini are unverified.
- Prior-art review for the hub: `docs/prior-art/orchestration-hub.md`.
