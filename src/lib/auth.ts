import { NextRequest } from "next/server";

export function isAdmin(request: NextRequest): boolean {
  const secret = request.headers.get("x-admin-secret") ||
    request.nextUrl.searchParams.get("secret");
  return secret === process.env.ADMIN_SECRET;
}

export function isAxonBeta(request: NextRequest): boolean {
  const token = request.cookies.get("axon_beta")?.value;
  return token === process.env.AXON_BETA_TOKEN;
}
