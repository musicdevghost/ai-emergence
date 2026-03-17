import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

export async function GET() {
  try {
    const result = await list({ prefix: "exports/emergence-full-export" });
    const blob = result.blobs[0];

    if (!blob) {
      return NextResponse.json({ error: "No export available yet" }, { status: 404 });
    }

    return NextResponse.json({
      url: blob.url,
      size: blob.size,
      uploadedAt: blob.uploadedAt,
    });
  } catch (error) {
    console.error("Export latest error:", error);
    return NextResponse.json(
      { error: "Failed to check export", detail: String(error) },
      { status: 500 }
    );
  }
}
