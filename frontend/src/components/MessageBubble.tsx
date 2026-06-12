import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../types";

function ToolBadge({ name, content }: { name: string | null; content: string }) {
  return (
    <div className="tool-badge">
      <span className="tool-badge-icon" aria-hidden>
        🛠
      </span>
      <span className="tool-badge-label">{name ?? "tool"}</span>
      <span className="tool-badge-result">{content}</span>
    </div>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return <ToolBadge name={message.name} content={message.content} />;
  }

  if (message.role === "system") return null;

  const isUser = message.role === "user";
  let toolCallNames: string[] = [];
  if (message.toolCalls) {
    try {
      const parsed = JSON.parse(message.toolCalls) as Array<{ function: { name: string } }>;
      toolCallNames = parsed.map((tc) => tc.function.name);
    } catch {
      toolCallNames = [];
    }
  }

  return (
    <div className={`message ${isUser ? "message-user" : "message-assistant"}`}>
      <div className="message-role">{isUser ? "You" : "Assistant"}</div>
      {message.content && (
        <div className="message-content">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      )}
      {toolCallNames.length > 0 && (
        <div className="message-tool-calls">
          {toolCallNames.map((name, i) => (
            <span key={`${name}-${i}`} className="tool-call-chip">
              used {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
