import { NextRequest, NextResponse } from "next/server";
import { isAxonBeta } from "@/lib/auth";
import pdfParse from "pdf-parse";

export const maxDuration = 30;

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB server-side ceiling
const MAX_CHARS = 8000;             // matches paste text budget

export async function POST(request: NextRequest) {
  if (!isAxonBeta(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "PDF file required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const data = await pdfParse(buffer);

  const rawText = (data.text as string).replace(/\s+/g, " ").trim();
  const truncated = rawText.length > MAX_CHARS;
  const text = rawText.slice(0, MAX_CHARS).trim();

  return NextResponse.json({
    text,
    pages: data.numpages as number,
    truncated,
    charCount: text.length,
  });
}
