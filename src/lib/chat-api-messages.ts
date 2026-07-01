import type { UIMessage } from "ai";

/** Vercel 요청 한도(4.5MB) 아래로 유지 */
const TARGET_MAX_BYTES = 3_200_000;
const MAX_MESSAGE_WINDOW = 12;
const MAX_ASSISTANT_CHARS = 4_000;
const MAX_USER_CHARS = 4_000;

const TRIM_SUFFIX =
  "\n\n…(이전 답변 일부는 요청 크기 한도 때문에 생략되었습니다. 화면에 보이는 전체 답변은 그대로 유지됩니다.)";

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part ? (part.text ?? "") : ""))
    .join("");
}

function setMessageText(message: UIMessage, text: string): UIMessage {
  const nonText = message.parts.filter((part) => part.type !== "text");
  return {
    ...message,
    parts: [...nonText, { type: "text", text }],
  };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const budget = Math.max(200, maxChars - TRIM_SUFFIX.length);
  return text.slice(0, budget) + TRIM_SUFFIX;
}

function trimSingleMessage(message: UIMessage): UIMessage {
  const text = getMessageText(message);
  const limit = message.role === "assistant" ? MAX_ASSISTANT_CHARS : MAX_USER_CHARS;
  if (text.length <= limit) return message;
  return setMessageText(message, truncateText(text, limit));
}

function estimatePayloadBytes(messages: UIMessage[], extra: Record<string, unknown> = {}): number {
  return JSON.stringify({ messages, ...extra }).length;
}

/**
 * 채팅 API 요청용 메시지 축소.
 * UI에 보이는 전체 대화는 그대로 두고, HTTP body·모델 입력만 줄입니다.
 */
export function trimMessagesForChatApi(
  messages: UIMessage[],
  extraBody: Record<string, unknown> = {}
): UIMessage[] {
  if (messages.length === 0) return messages;

  let window = messages.slice(-MAX_MESSAGE_WINDOW).map(trimSingleMessage);

  while (estimatePayloadBytes(window, extraBody) > TARGET_MAX_BYTES && window.length > 1) {
    window = window.slice(1);
  }

  let assistantLimit = MAX_ASSISTANT_CHARS;
  while (
    estimatePayloadBytes(window, extraBody) > TARGET_MAX_BYTES &&
    assistantLimit > 400
  ) {
    assistantLimit = Math.floor(assistantLimit * 0.65);
    window = window.map((message) => {
      if (message.role !== "assistant") return message;
      const text = getMessageText(message);
      return setMessageText(message, truncateText(text, assistantLimit));
    });
  }

  return window;
}

export function isLikelyOversizedChatRequest(
  messages: UIMessage[],
  extraBody: Record<string, unknown> = {}
): boolean {
  return estimatePayloadBytes(messages, extraBody) > TARGET_MAX_BYTES;
}
