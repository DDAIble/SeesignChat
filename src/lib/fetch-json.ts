/** API 응답이 JSON이 아닐 때(404 HTML, Server Action 오류 등) 읽기 쉬운 메시지로 변환합니다. */
export async function readJsonResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (!text.trim()) {
    throw new Error(`서버 응답이 비어 있습니다. (${res.status})`);
  }

  if (!contentType.includes("application/json") && !text.trimStart().startsWith("{")) {
    if (res.status === 404) {
      throw new Error(
        "업로드 API를 찾지 못했습니다. 터미널에서 개발 서버를 중지한 뒤 .next 폴더를 삭제하고 npm run dev로 다시 시작해 주세요."
      );
    }
    if (text.includes("Server Action") || text.includes("Server act")) {
      throw new Error(
        "서버가 API 대신 잘못된 응답을 반환했습니다. 개발 서버를 재시작해 주세요."
      );
    }
    throw new Error(`서버 응답 오류 (${res.status}). JSON이 아닌 응답이 왔습니다.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `서버 응답을 해석하지 못했습니다. (${res.status}) 개발 서버를 재시작해 보세요.`
    );
  }
}
