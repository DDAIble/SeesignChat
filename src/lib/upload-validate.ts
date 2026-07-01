import type { ExcelData } from "@/lib/types";

const DEFAULT_MAX_SHEETS = 30;

function getPositiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateParsedExcelData(data: ExcelData): string | null {
  const maxSheets = getPositiveEnvInt("UPLOAD_MAX_SHEETS", DEFAULT_MAX_SHEETS);

  if (data.sheets.length > maxSheets) {
    return `시트가 너무 많습니다. (최대 ${maxSheets.toLocaleString()}개)`;
  }

  const totalRows = data.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  if (totalRows === 0) {
    return "데이터 행이 없습니다. 파일 내용을 확인해 주세요.";
  }

  return null;
}
