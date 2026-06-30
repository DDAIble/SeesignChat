"use client";

import { useEffect, useRef } from "react";
import { deleteAllUploadDataKeepalive } from "@/lib/delete-upload-data";

/**
 * 탭 닫기, 새로고침, 뒤로가기, 다른 페이지로 이동 시
 * 남아 있는 업로드 파일을 서버(Blob·인메모리·RAG)에서 삭제합니다.
 */
export function useCleanupUploadsOnLeave(fileIds: string[]): void {
  const fileIdsRef = useRef<string[]>([]);
  fileIdsRef.current = fileIds;

  useEffect(() => {
    let cleaned = false;

    const cleanupRemaining = () => {
      if (cleaned) return;
      const ids = fileIdsRef.current;
      if (ids.length === 0) return;
      cleaned = true;
      deleteAllUploadDataKeepalive(ids);
    };

    window.addEventListener("pagehide", cleanupRemaining);
    window.addEventListener("popstate", cleanupRemaining);

    return () => {
      window.removeEventListener("pagehide", cleanupRemaining);
      window.removeEventListener("popstate", cleanupRemaining);
    };
  }, []);
}
