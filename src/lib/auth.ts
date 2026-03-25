import { NextRequest } from "next/server";

export function isAdmin(request: NextRequest): boolean {
  const secret = request.headers.get("x-admin-secret") ||
    request.nextUrl.searchParams.get("secret");
  return secret === process.env.ADMIN_SECRET;
}
