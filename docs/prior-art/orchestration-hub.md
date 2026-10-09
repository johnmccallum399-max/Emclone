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
- Does the user mean API keys or consumer subscriptions (ChatGPT Plus,
  Claude Pro)? Consumer plans have no API access, so the hub can't drive them.
