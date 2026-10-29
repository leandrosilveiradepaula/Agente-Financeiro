import { NextResponse } from "next/server";
import { listAgentRuns } from "@/lib/agent-runs";
import { getProfilePolicy } from "@/lib/profile-policy";
import { requireAgentSession } from "@/lib/server-auth";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";
import { inspectParityBatch } from "@/lib/shadow-parity-batch";
import { isShadowSqlComparisonEnabled } from "@/lib/langgraph-shadow-comparison-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { session, response } = await requireAgentSession();
  if (response || !session) return response;
  const policy = await getProfilePolicy(session.userProfile);
  if (!policy || !policy.can_view_all_runs || !policy.can_view_sql) {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
  }
  const tenant = getSessionTenantIdentity(session);
  if (tenant.status === "required") {
    return NextResponse.json({ success: false, error: "tenant_identity_required" }, { status: 403 });
  }
  if (!isShadowSqlComparisonEnabled()) {
    return NextResponse.json({ success: false, error: "comparison_disabled" }, { status: 503 });
  }
  const url = new URL(request.url);
  // Strictly bounded, deterministic historical inspection. No browser
  // supplied SQL, principal, tenant, Shadow ID or custom benchmark payload.
  if ([...url.searchParams.keys()].some((key) => key !== "limit" && key !== "offset") ||
      url.searchParams.getAll("limit").length > 1 ||
      url.searchParams.getAll("offset").length > 1) {
    return NextResponse.json({ success: false, error: "parameters_invalid" }, { status: 400 });
  }
  const limitRaw = url.searchParams.get("limit") ?? "10";
  const offsetRaw = url.searchParams.get("offset") ?? "0";
  if (!/^(?:[1-9]|1[0-9]|20)$/.test(limitRaw) ||
      !/^(?:0|[1-9][0-9]{0,5})$/.test(offsetRaw)) {
    return NextResponse.json({ success: false, error: "parameters_invalid" }, { status: 400 });
  }
  try {
    const { runs, total } = await listAgentRuns({
      organizationId: tenant.status === "ready" ? tenant.organizationId : undefined,
      limit: Number(limitRaw),
      offset: Number(offsetRaw)
    });
    // Keep tenant mode strict: rows without an assigned tenant never
    // become eligible through a broad or legacy record lookup.
    const eligible = tenant.status === "ready"
      ? runs.filter((run) => run.organization_id === tenant.organizationId)
      : runs;
    const report = await inspectParityBatch(eligible);
    return NextResponse.json({
      success: true,
      ...report,
      total_official_runs: total,
      offset: Number(offsetRaw),
      limit: Number(limitRaw)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, error: "parity_review_unavailable" }, { status: 503 });
  }
}
