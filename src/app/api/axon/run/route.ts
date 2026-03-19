import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAxonBeta } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!isAxonBeta(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    input?: string;
    context_text?: string;
    context_file?: { name: string; type: string; data: string };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = body.input?.trim();
  if (!input) {
    return NextResponse.json({ error: "Input required" }, { status: 400 });
  }

  const contextText = body.context_text?.trim() || null;
  const contextFileName = body.context_file?.name || null;
  const contextFileType = body.context_file?.type || null;
  const contextFileData = body.context_file?.data || null;

  const sql = getDb();

  const requests = await sql`
    INSERT INTO axon_requests (
      input_text, status,
      context_text, context_file_name, context_file_type, context_file_data
    )
    VALUES (
      ${input}, 'pending',
      ${contextText}, ${contextFileName}, ${contextFileType}, ${contextFileData}
    )
    RETURNING id
  `;

  return NextResponse.json({ requestId: requests[0].id });
}
