"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { Send, Bot, User, Loader2, Sparkles, MessageSquarePlus } from "lucide-react";
import AnalysisTracePanel from "@/components/AnalysisTracePanel";
import MarkdownContent from "@/components/MarkdownContent";
import CitationListPanel from "@/components/CitationListPanel";
import LearningProgressBar from "@/components/LearningProgressBar";
import { computeAggregateLearningProgress } from "@/lib/learning-progress";
import { isAnalysisTraceData, type AnalysisTraceData } from "@/lib/analysis-trace";
import { isCitationData, type CitationSource } from "@/lib/citations";
import FollowUpQuestions from "@/components/FollowUpQuestions";
import AnswerExportActions from "@/components/AnswerExportActions";
import { isFollowUpQuestionsData } from "@/lib/follow-up-questions";
import { withBasePath } from "@/lib/base-path";
import type { ExcelData } from "@/lib/types";

interface ChatInterfaceProps {
  excelFiles: ExcelData[];
}

function getMessageText(message: { parts: Array<{ type: string; text?: string }> }): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

export default function ChatInterface({ excelFiles }: ChatInterfaceProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userPinnedRef = useRef(false);
  const SCROLL_PIN_THRESHOLD_PX = 80;
  const [input, setInput] = useState("");
  const [analysisTrace, setAnalysisTrace] = useState<AnalysisTraceData | null>(null);
  const [citationsByMessageId, setCitationsByMessageId] = useState<Record<string, CitationSource[]>>({});
  const [followUpByMessageId, setFollowUpByMessageId] = useState<Record<string, string[]>>({});
  const turnCitationsRef = useRef<CitationSource[] | null>(null);
  const turnFollowUpRef = useRef<string[] | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: withBasePath("/api/chat"),
      }),
    []
  );

  const attachCitationsToLatestAssistant = useCallback((sources: CitationSource[]) => {
    if (sources.length === 0) return;
    setCitationsByMessageId((prev) => {
      const msgs = messagesRef.current;
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      if (!lastAssistant) return prev;
      return { ...prev, [lastAssistant.id]: sources };
    });
  }, []);

  const attachFollowUpToLatestAssistant = useCallback((questions: string[]) => {
    if (questions.length === 0) return;
    setFollowUpByMessageId((prev) => {
      const msgs = messagesRef.current;
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      if (!lastAssistant) return prev;
      return { ...prev, [lastAssistant.id]: questions };
    });
  }, []);

  const messagesRef = useRef<Array<{ id: string; role: string }>>([]);

  const handleAnalysisData = useCallback((part: { type: string; data: unknown }) => {
    if (part.type === "data-analysis-trace" && isAnalysisTraceData(part.data)) {
      setAnalysisTrace(part.data);
    }
    if (part.type === "data-citations" && isCitationData(part.data)) {
      const sources = part.data.sources ?? [];
      turnCitationsRef.current = sources;
      attachCitationsToLatestAssistant(sources);
    }
    if (part.type === "data-follow-up-questions" && isFollowUpQuestionsData(part.data)) {
      const questions = part.data.questions ?? [];
      turnFollowUpRef.current = questions;
      attachFollowUpToLatestAssistant(questions);
    }
  }, [attachCitationsToLatestAssistant, attachFollowUpToLatestAssistant]);

  const { messages, sendMessage, status, error, setMessages, stop, clearError } = useChat({
    transport,
    onData: handleAnalysisData,
    onFinish: ({ message }) => {
      if (message.role !== "assistant") return;
      if (turnCitationsRef.current) {
        setCitationsByMessageId((prev) => ({
          ...prev,
          [message.id]: turnCitationsRef.current!,
        }));
      }
      if (turnFollowUpRef.current) {
        setFollowUpByMessageId((prev) => ({
          ...prev,
          [message.id]: turnFollowUpRef.current!,
        }));
      }
    },
  });

  messagesRef.current = messages;

  const isLoading = status === "submitted" || status === "streaming";
  const learningProgress = useMemo(
    () => computeAggregateLearningProgress(excelFiles),
    [excelFiles]
  );
  const isLearning = learningProgress.isIndexing;

  const handleNewChat = () => {
    if (isLoading) stop();
    setMessages([]);
    clearError();
    setInput("");
    setAnalysisTrace(null);
    setCitationsByMessageId({});
    setFollowUpByMessageId({});
    turnCitationsRef.current = null;
    turnFollowUpRef.current = null;
    userPinnedRef.current = false;
  };

  const isNearBottom = useCallback((container: HTMLElement) => {
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance <= SCROLL_PIN_THRESHOLD_PX;
  }, []);

  const scrollToBottomIfAllowed = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || userPinnedRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const pinIfScrolledUp = () => {
      if (!isNearBottom(container)) {
        userPinnedRef.current = true;
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) userPinnedRef.current = true;
    };

    container.addEventListener("scroll", pinIfScrolledUp, { passive: true });
    container.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      container.removeEventListener("scroll", pinIfScrolledUp);
      container.removeEventListener("wheel", handleWheel);
    };
  }, [isNearBottom]);

  useEffect(() => {
    scrollToBottomIfAllowed();
  }, [messages, analysisTrace, followUpByMessageId, scrollToBottomIfAllowed]);

  useEffect(() => {
    if (turnCitationsRef.current) {
      attachCitationsToLatestAssistant(turnCitationsRef.current);
    }
    if (turnFollowUpRef.current) {
      attachFollowUpToLatestAssistant(turnFollowUpRef.current);
    }
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && getMessageText(last).trim().length > 0) {
      setAnalysisTrace(null);
    }
  }, [messages, attachCitationsToLatestAssistant, attachFollowUpToLatestAssistant]);

  const handleSend = (text: string) => {
    if (!text.trim() || excelFiles.length === 0 || isLoading || isLearning) return;
    userPinnedRef.current = false;
    setAnalysisTrace({
      headline: "분석을 시작합니다…",
      steps: [{ id: "start", label: "요청 수신", status: "running" }],
    });
    turnCitationsRef.current = null;
    turnFollowUpRef.current = null;
    sendMessage(
      { text },
      { body: { fileIds: excelFiles.map((f) => f.id), excelFiles } }
    );
    setInput("");
  };

  const handleRetry = () => {
    if (isLoading || isLearning) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastUserText = lastUser ? getMessageText(lastUser) : "";
    clearError();
    if (lastUserText.trim()) handleSend(lastUserText);
  };

  if (excelFiles.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <Sparkles className="h-8 w-8 text-slate-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800">AI와 대화를 시작하세요</h2>
          <p className="mt-1 text-sm text-slate-500">
            통계·수치 자료나 게시글·후기·Q&A·뉴스 등 엑셀 파일을 업로드하고 질문해 보세요.
          </p>
        </div>
      </div>
    );
  }

  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant");
  const canReset = messages.length > 0 || !!error;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-medium text-slate-700">대화</p>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={!canReset && !isLoading}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          title="대화 내역 초기화"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          새 대화
        </button>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                <Bot className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3 text-sm text-slate-700">
                {isLearning ? (
                  <>
                    <strong>{excelFiles.length}개</strong> 파일이 업로드되었습니다. SEE:SIGN이 내용을
                    학습하는 동안 잠시만 기다려 주세요. 학습이 끝나면 바로 질문하실 수 있습니다.
                  </>
                ) : (
                  <>
                    안녕하세요! <strong>{excelFiles.length}개</strong> 파일이 준비되었습니다 (
                    {excelFiles.map((f) => f.fileName).join(", ")}).
                    수치 분석, 텍스트 요약, 의견·이슈 파악 등 무엇이든 물어보세요.
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const messageText = getMessageText(msg);
          const isStreamingThis =
            isLoading && msg.role === "assistant" && msg.id === lastAssistantMessage?.id;

          return (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                msg.role === "user" ? "bg-slate-800" : "bg-emerald-100"
              }`}
            >
              {msg.role === "user" ? (
                <User className="h-4 w-4 text-white" />
              ) : (
                <Bot className="h-4 w-4 text-emerald-600" />
              )}
            </div>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "rounded-tr-sm bg-slate-800 text-white whitespace-pre-wrap"
                  : "rounded-tl-sm bg-slate-100 text-slate-800"
              }`}
              aria-live={msg.role === "assistant" && isStreamingThis ? "polite" : undefined}
            >
              {msg.role === "assistant" ? (
                <>
                  <AnswerExportActions content={messageText} disabled={isStreamingThis}>
                    <MarkdownContent
                      content={messageText}
                      citations={citationsByMessageId[msg.id] ?? []}
                    />
                  </AnswerExportActions>
                  <CitationListPanel
                    content={messageText}
                    citations={citationsByMessageId[msg.id] ?? []}
                  />
                  {msg.id === lastAssistantMessage?.id && (
                    <FollowUpQuestions
                      questions={followUpByMessageId[msg.id] ?? []}
                      onSelect={handleSend}
                      disabled={isLoading || isLearning}
                    />
                  )}
                </>
              ) : (
                messageText
              )}
            </div>
          </div>
          );
        })}

        {isLoading && analysisTrace && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
              <Bot className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="max-w-[80%] flex-1">
              <AnalysisTracePanel trace={analysisTrace} />
            </div>
          </div>
        )}

        {isLoading && !analysisTrace && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
              <Bot className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center"
          >
            <p className="text-sm text-red-600">{error.message || "오류가 발생했습니다."}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRetry}
                disabled={isLoading || isLearning}
                className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                다시 시도
              </button>
              <button
                type="button"
                onClick={() => clearError()}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                닫기
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 p-4">
        {isLearning ? (
          <LearningProgressBar progress={learningProgress} />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
          >
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSend(input);
                  }
                }}
                placeholder="수치·게시글·후기·Q&A 등 데이터에 대해 질문하세요..."
                disabled={isLoading}
                rows={3}
                className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                title="Ctrl+Enter로도 전송"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Enter 줄바꿈 · Ctrl+Enter 전송</p>
          </form>
        )}
      </div>
    </div>
  );
}
