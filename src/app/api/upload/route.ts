import { NextRequest, NextResponse } from "next/server";
import { parseExcelBuffer } from "@/lib/excel";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }

    const validExtensions = [".xlsx", ".xls", ".csv"];
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!validExtensions.includes(ext)) {
      return NextResponse.json(
        { error: "지원 형식: .xlsx, .xls, .csv" },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const data = parseExcelBuffer(buffer, file.name);

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "파일을 읽는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
