import { generateText, type LanguageModel } from "ai";

export interface FollowUpQuestionsData {
  questions: string[];
}

export function isFollowUpQuestionsData(value: unknown): value is FollowUpQuestionsData {
  if (!value || typeof value !== "object") return false;
  const data = value as FollowUpQuestionsData;
  return Array.isArray(data.questions);
}

function parseQuestionsFromText(text: string): string[] {
  const trimmed = text.trim();

  try {
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, 5);
      }
    }
  } catch {
    // fall through
  }

  return trimmed
    .split("\n")
    .map((line) => line.replace(/^[\s\-*\d.)、]+/, "").trim())
    .filter((line) => line.length > 5)
    .slice(0, 5);
}

export async function generateFollowUpQuestions(
  model: LanguageModel,
  userQuery: string,
  answerText: string,
  fileNames: string[]
): Promise<string[]> {
  const answerSnippet = answerText.trim().slice(0, 3500);
  if (!answerSnippet) return [];

  const { text } = await generateText({
    model,
    prompt: `당신은 데이터 분석 챗봇의 후속 질문 추천기입니다.

업로드 파일: ${fileNames.join(", ") || "(없음)"}

사용자 질문:
${userQuery.trim()}

AI 답변 요약:
${answerSnippet}

위 대화를 이어갈 수 있는 **후속 질문 5개**를 한국어로 제안하세요.
- 답변 내용을 더 깊게 파고들거나, 다른 각도로 분석하거나, 실행 가능한 인사이트로 이어지는 질문
- 업로드된 데이터 범위 안에서 답할 수 있는 질문
- 각 질문은 한 문장, 60자 이내, 물음표로 끝내기
- 중복·너무 일반적인 질문 금지

JSON 배열만 출력하세요. 다른 설명 없이:
["질문1", "질문2", "질문3", "질문4", "질문5"]`,
  });

  return parseQuestionsFromText(text);
}
