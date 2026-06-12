import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../types";
import { MessageBubble } from "../MessageBubble";

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 1,
    conversationId: 1,
    role: "user",
    content: "",
    toolCalls: null,
    toolCallId: null,
    name: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("MessageBubble", () => {
  it("renders user messages with markdown content", () => {
    render(<MessageBubble message={makeMessage({ role: "user", content: "**hi** there" })} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("renders assistant messages with tool call chips", () => {
    const toolCalls = JSON.stringify([{ function: { name: "web_search" } }]);
    render(
      <MessageBubble
        message={makeMessage({ role: "assistant", content: "Here you go", toolCalls })}
      />
    );
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("used web_search")).toBeInTheDocument();
  });

  it("renders tool messages as a badge", () => {
    render(<MessageBubble message={makeMessage({ role: "tool", name: "calculator", content: "42" })} />);
    expect(screen.getByText("calculator")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders nothing for system messages", () => {
    const { container } = render(<MessageBubble message={makeMessage({ role: "system", content: "system prompt" })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
