import { NextResponse } from "next/server";
import { listAgentRuns } from "@/lib/agent-runs";
import { requireAdminSession } from "@/lib/server-auth";

export const runtime = "nodejs";

function clampLimit(value: string | null) {
  const parsed = Number(value ?? 50);

  if (!Number.isFinite(parsed) || parsed <= 0) return 50;

  return Math.min(Math.trunc(parsed), 200);
}

function parseOffset(value: string | null) {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.trunc(parsed);
}

export async function GET(request: Request) {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim() || undefined;
  const userEmail = url.searchParams.get("user_email")?.trim() || undefined;
  const intent = url.searchParams.get("intent")?.trim() || undefined;
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = parseOffset(url.searchParams.get("offset"));

  const result = await listAgentRuns({
    status,
    userEmail,
    intent,
    limit,
    offset
  });

  return NextResponse.json({
    success: true,
    runs: result.runs,
    total: result.total
  });
}
