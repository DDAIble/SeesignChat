import { withBasePath } from "@/lib/base-path";

export function deleteUploadDataUrl(fileId: string): string {
  return withBasePath(`/api/embed?fileId=${encodeURIComponent(fileId)}`);
}

/** 일반 삭제 — X 버튼, 전체 삭제 등 */
export async function deleteUploadData(fileId: string): Promise<void> {
  const res = await fetch(deleteUploadDataUrl(fileId), { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`삭제 실패 (${res.status})`);
  }
}

/** 탭 닫기·뒤로가기·페이지 이탈 시 — 요청이 끊겨도 서버까지 전달되도록 */
export function deleteUploadDataKeepalive(fileId: string): void {
  void fetch(deleteUploadDataUrl(fileId), { method: "DELETE", keepalive: true });
}

export async function deleteAllUploadData(fileIds: string[]): Promise<void> {
  await Promise.all(fileIds.map((id) => deleteUploadData(id).catch(() => undefined)));
}

export function deleteAllUploadDataKeepalive(fileIds: string[]): void {
  for (const id of fileIds) {
    deleteUploadDataKeepalive(id);
  }
}
