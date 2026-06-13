/**
 * Default persona configuration.
 *
 * The personality is intentionally a near-blank slate so the user can fully
 * define how the assistant behaves from Settings. Everything here can be
 * overridden per-user and is persisted in the database.
 */
export interface PersonaConfig {
  name: string;
  systemPrompt: string;
  /** Free-form description shown in Settings, not sent to the model directly. */
  description: string;
}

export const DEFAULT_PERSONA: PersonaConfig = {
  name: "Assistant",
  systemPrompt:
    "You are a helpful, honest personal assistant. Be clear and concise. " +
    "Use the available tools when they would help (web search for current " +
    "information, memory tools to recall or store user preferences, the " +
    "calculator for math). Ask clarifying questions when a request is " +
    "ambiguous. You have no fixed personality beyond this - the user may " +
    "redefine your tone, name, and style at any time in Settings.",
  description:
    "A blank-slate, configurable assistant. Edit this in Settings to give " +
    "it a name, tone, and personality that suits you.",
};
