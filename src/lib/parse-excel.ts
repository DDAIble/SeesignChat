import * as XLSX from "xlsx";
import type { ExcelData, SheetData } from "./types";

/** 엑셀/CSV 바이너리 → 구조화 JSON (브라우저·서버 공용) */
export function parseExcelBuffer(buffer: ArrayBuffer, fileName: string): ExcelData {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheets: SheetData[] = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: "",
      raw: false,
    });

    const headers =
      jsonData.length > 0
        ? Object.keys(jsonData[0])
        : (XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] as string[]) ?? [];

    return {
      name,
      headers,
      rows: jsonData,
      rowCount: jsonData.length,
    };
  });

  return {
    id: crypto.randomUUID(),
    fileName,
    sheets,
    uploadedAt: new Date().toISOString(),
  };
}
