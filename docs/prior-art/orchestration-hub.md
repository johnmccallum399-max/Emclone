# Prior art: multi-LLM orchestration hub

Researched 2026-10-09 from web search summaries only. **Nothing here was
verified against vendor docs or repos**; prices and provider-support claims
conflicted between sources. Confirm before acting on any row.

## What we built

A self-hosted hub inside the personal assistant: agents (OpenAI, Anthropic,
Google, any OpenAI-compatible API) take turns over a shared transcript in
discussion, debate or pipeline mode, with persistent sessions, user
interjection, and a final synthesis turn. See `backend/src/hub/`.

## Open source

| Candidate | What it covers | Gap for us | Notes |
| --- | --- | --- | --- |
| [llm-council](https://github.com/OliWoods-Org/llm-council) pattern (Karpathy original and forks) | Models answer, critique each other, a chairman synthesizes | A one-shot deliberation experiment, not persistent sessions or a chat product | Closest match to our debate + synthesis modes |
| [Open WebUI](https://agence-scroll.com/en/blog/open-webui) | Self-hosted UI, any OpenAI-compatible API, same prompt to several models side by side | Parallel answers, not models responding to each other | Very widely adopted |
| [LibreChat](https://toolhalla.ai/blog/open-webui-vs-anythingllm-vs-librechat-2026) | Self-hosted, all major providers, switch or compare mid-chat | Same gap; needs MongoDB | |
| [multi-model-chat](https://github.com/seehiong/multi-model-chat) | Side-by-side comparison, React + TypeScript | Same gap | Small project |
| [LangGraph](https://www.langchain.com/resources/ai-agent-frameworks), [CrewAI](https://pickaxe.co/post/crewai-vs-langgraph-vs-autogen) | Agent graphs and roles, multi-provider | Python libraries to build on, not an app; our backend is TypeScript | Provider-mixing claims for CrewAI conflict between sources |
| AutoGen / Microsoft Agent Framework | Conversation-loop agents | Python/.NET; AutoGen is in maintenance mode | Don't start new work on AutoGen |
| [Dify](https://dify-hosting.com/en/guides/dify-pricing/), [Flowise](https://www.lindy.ai/blog/flowise-pricing), n8n | Visual agent/workflow builders, free self-host | Separate apps with their own UI and auth, not embedded in ours | Flowise reportedly now owned by Workday: roadmap risk |

## Purchase (one-time license)

| Candidate | What it covers | Gap for us |
| --- | --- | --- |
| [TypingMind](https://www.typingmind.com/guide/use-openrouter-api-key-to-chat-with-ai) | Bring-your-own-key chat client, many providers | Chat client, not agent-to-agent relay. Reported $39 to $198, sources disagree |

## Subscription

| Candidate | What it covers | Gap for us |
| --- | --- | --- |
| [Poe](https://agentarius.ai/ai-guide/compare/openrouter-vs-poe), [ChatHub](https://chathub.gg/), [T3 Chat](https://geekflare.com/guides/top-multi-ai-chat-clients/) | Many models in one subscription, side-by-side answers | Comparison, not collaboration; models are the vendor's, not your own accounts |
| [Suprmind](https://suprmind.ai/hub/platform/) and similar aggregators | Multi-model platforms | Not evaluated. Check whether any offer true model-to-model orchestration |
| [OpenRouter](https://sourceforge.net/software/compare/OpenRouter-vs-Poe/) | One API key for hundreds of models (pay per token, platform fee about 5%) | A gateway, not an orchestrator, but see "Decision" |
| [Zapier Agents](https://a8gent.com/platforms/zapier-agents), [Relevance AI](https://www.eesel.ai/blog/relevance-ai-pricing), Lindy | Hosted no-code agents | Usage-metered, hard to forecast; Lindy's product has changed, so old reviews are stale |

## Decision

**Build, but thinly.** No candidate found offers all of: your own accounts,
agents responding to each other, persistent sessions with user interjection,
and living inside our existing app. The orchestration loop itself is small.

Things we should have weighed before writing them:

- **Provider client.** OpenRouter (or any gateway) is reachable through our
  existing `openai_compatible` provider with
  `https://openrouter.ai/api/v1`, so one key could replace three provider
  integrations. Worth documenting as the default setup.
- **Debate and synthesis prompts.** The llm-council forks are the reference
  for peer-review and ranking steps we don't have yet.
- **If orchestration grows** (branching, tool use, human approval gates),
  adopt LangGraph or a similar framework rather than extending our loop.

## Open questions

- Do any subscription aggregators offer real model-to-model relay? Not
  confirmed either way.
- **Resolved:** the user meant consumer subscriptions (ChatGPT, Claude, Gemini
  plans) talking freely, not API keys. Consumer plans have no API access, so
  the shipped hub does not cover that. Candidate paths, none verified:
  1. Drive each vendor's own CLI (Claude Code, Codex CLI, Gemini CLI), which
     can sign in with a subscription, from the hub as a new provider type.
     Must run on a machine where those CLIs are logged in, not on Render.
     Check each vendor's current terms for automated or third-party use.
  2. Cheap or free API tiers, if the goal is cost rather than the account.
  3. Automating the consumer web UIs. Likely against vendor terms and fragile.
     Not recommended.

## Vendor terms check (2026-10-26)

Fetched from vendor pages where reachable. This is not legal advice; read the
linked pages yourself.

**Anthropic (Claude Code), verified from the page.** Source:
https://code.claude.com/docs/en/legal-and-compliance
- OAuth login "is intended exclusively for purchasers of Claude Free, Pro, Max,
  Team, and Enterprise subscription plans and is designed to support ordinary
  use of Claude Code".
- "Advertised usage limits for Pro and Max plans assume ordinary, individual
  usage of Claude Code and the Agent SDK."
- Developers building products "should use API key authentication"; Anthropic
  "does not permit third-party developers ... to route requests through Free,
  Pro, or Max plan credentials on behalf of their users", and developers "may
  not collect, store, or intermediate Claude.ai credentials or session tokens".
- It does not prevent "an end user from signing in to the unmodified Claude Code
  binary with their own Claude subscription".
- Reading: running the real `claude` binary yourself on your own machine for
  your own use fits. Hosting it for others, or on a server with a copied token,
  does not. Heavy multi-agent loops may exceed "ordinary, individual usage".

**OpenAI (Codex CLI), not verified.** The official auth pages
(learn.chatgpt.com, developers.openai.com) could not be reached from the build
environment. Secondary sources describe copying `~/.codex/auth.json` and
device-code login for remote machines and say to treat the file like a password.
No terms on automation were found. Read OpenAI's terms before relying on it.

**Google (Gemini CLI), partly verified.** The Gemini CLI README states: "Unpaid
tier and Google One users: Gemini CLI was replaced by Antigravity CLI on June
18th, 2026." The terms page could not be reached. Antigravity CLI's headless
interface was not researched, so the `gemini` preset may not work for a personal
Google subscription.

**Decision.** Local, single-user, off by default (`HUB_ENABLE_CLI_AGENTS`).
Not for hosting or sharing. Hosted use would need API keys.

## Packaging for a personal computer or phone (2026-10-26)

Not researched against current docs; from general knowledge, so treat every row
as unverified until checked. No installer has been built.

| Option | What it gives | Catch |
| --- | --- | --- |
| `scripts/local.mjs` (built, tested on Linux) | One command or double-click, first-run setup, opens the browser | Needs Node.js installed |
| Node single-executable application | One binary | Cannot embed the native `better-sqlite3` module; it would have to ship beside the binary, or the storage layer would move to Node's built-in SQLite |
| Electron plus electron-builder | A normal installer per OS, bundles Node | Large (about 100 MB or more); native module must be rebuilt for Electron; must build on each OS (CI matrix); Windows and macOS installers may show unsigned-app warnings |
| Tauri | Smaller installer | Still needs a Node sidecar for this backend, so little gained |
| Android app | Remote control from the phone | Phones cannot run the vendor CLIs, so it can only talk to the Hub on the computer. The existing LCDR app would need new Hub screens in Kotlin |
| Installable web app (PWA) | Already built into the frontend | Installing needs HTTPS; plain LAN HTTP gives only a bookmark. Tailscale can provide HTTPS |

**Decision (updated).** Portable bundles instead of an installer: a zip for
Windows 10 and a tar.gz for Linux, each carrying its own Node and dependencies,
built and smoke-tested by `.github/workflows/hub.yml`. No Electron, no installer,
no code signing. The tablet uses the installed web app over Tailscale rather
than a new Android app, because the Hub cannot run on the tablet anyway.

Checked while building (sources from search results; not all confirmed):
- Tailscale Serve proxies a local port to an HTTPS address reachable only on the
  tailnet, and needs MagicDNS and HTTPS certificates enabled. Command syntax
  changed in Tailscale 1.52.
- Since the CVE-2024-27980 fix, Node throws EINVAL when spawning `.cmd` or `.bat`
  files without a shell
  (https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2).
  npm-installed CLIs on Windows are `.cmd` shims, so the CLI runner resolves them
  and goes through `cmd.exe` with a fixed, metacharacter-checked command line.
  The inference that the real `claude`, `codex` and `gemini` shims are `.cmd`
  files was not confirmed; the CI smoke test uses a `.cmd` stand-in.
- better-sqlite3's glibc floor was not documented in what I found. Measured on
  the prebuilt binary: needs glibc 2.29 at most, and Node 22 needs 2.28. CI fails
  the build if either exceeds 2.35 (Zorin OS 17), which would happen if the module
  were compiled on the runner instead of downloaded.
- Zorin OS 18 being based on Ubuntu 24.04 (glibc 2.39) is from memory, not checked.
