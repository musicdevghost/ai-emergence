import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { triggerReview } from "@/lib/engine";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { session_id } = await request.json();
  if (!session_id) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  await triggerReview(session_id);
  return NextResponse.json({ ok: true });
}
