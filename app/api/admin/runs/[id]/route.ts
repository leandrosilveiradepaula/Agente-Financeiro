import { NextResponse } from "next/server";
import { getAgentRunById } from "@/lib/agent-runs";
import { requireAdminSession } from "@/lib/server-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { session, response } = await requireAdminSession();

  if (response || !session) {
    return response;
  }

  const { id } = await context.params;
  const run = await getAgentRunById(id);

  if (!run) {
    return NextResponse.json(
      { success: false, error: "run_not_found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    run
  });
}
