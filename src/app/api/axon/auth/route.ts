import { NextRequest, NextResponse } from "next/server";
import { isAxonBeta } from "@/lib/auth";

export async function POST(request: NextRequest) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { token } = body;
  if (!token || token !== process.env.AXON_BETA_TOKEN) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set("axon_beta", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const authenticated = isAxonBeta(request);
  return NextResponse.json({ authenticated });
}
