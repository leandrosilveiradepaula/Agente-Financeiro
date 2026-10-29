import { NextResponse } from "next/server";
import { requireAgentSession } from "@/lib/server-auth";
import { getProfilePolicy } from "@/lib/profile-policy";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";
import {
  getCandidateReview, decideCandidateReview
} from "@/lib/candidate-sql-review";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status, headers: { "Cache-Control": "no-store" }
  });
}
async function authorize() {
  const { session, response } = await requireAgentSession();
  if (response || !session) return { response: response ?? reply({ error:"unauthorized" },401) };
  if (session.userProfile !== "admin") {
    return { response: reply({ error:"forbidden" },403) };
  }
  const tenant = getSessionTenantIdentity(session);
  if (tenant.status !== "ready") {
    return { response: reply({ error:"tenant_identity_required" },403) };
  }
  if (process.env.AGENT_CANDIDATE_REVIEW_ENABLED?.trim() !== "true") {
    return { response: reply({ error:"review_disabled" },404) };
  }
  const policy = await getProfilePolicy(session.userProfile);
  if (!policy?.is_active || !policy.can_view_sql || !policy.can_execute_sql) {
    return { response: reply({ error:"review_policy_denied" },403) };
  }
  return { session, tenant, response:null };
}
export async function GET(_request: Request, context: Context) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  const id = (await context.params).id;
  try {
    const review = await getCandidateReview({
      id, organizationId: auth.tenant!.organizationId
    });
    if (!review) return reply({ error:"review_not_found" },404);
    return reply({
      success:true, review: {
        id: review.id, agent_run_id: review.agent_run_id,
        organization_id: review.organization_id,
        requested_by: review.requested_by, sql_text: review.sql_text,
        sql_sha256: review.sql_sha256, binding_sha256: review.binding_sha256,
        context_version: review.context_version,
        provider_key: review.provider_key, model_key: review.model_key,
        config_version: review.config_version,
        response_fingerprint: review.response_fingerprint,
        review_status: review.review_status,
        decided_by: review.decided_by, decided_at: review.decided_at,
        created_at: review.created_at
      }
    },200);
  } catch {
    return reply({ error:"review_store_unavailable" },503);
  }
}
export async function POST(request: Request, context: Context) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  const id = (await context.params).id;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply({ error:"review_request_invalid" },400);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 4096) return reply({ error:"review_request_invalid" },400);
    body = JSON.parse(text);
  } catch {
    return reply({ error:"review_request_invalid" },400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return reply({ error:"review_request_invalid" },400);
  }
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== "binding_sha256,decision" ||
      (fields.decision !== "approved" && fields.decision !== "rejected") ||
      typeof fields.binding_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(fields.binding_sha256)) {
    return reply({ error:"review_request_invalid" },400);
  }
  try {
    const result = await decideCandidateReview({
      id, organizationId: auth.tenant!.organizationId,
      actorId: auth.session!.userId,
      decision: fields.decision,
      expectedBindingSha256: fields.binding_sha256
    });
    if (!result) return reply({ error:"review_conflict_or_forbidden" },409);
    return reply({
      success: true, review_id: result.id,
      review_status: result.status, binding_sha256: result.binding_sha256,
      real_sql_executed: false,
      execution_authorized: false
    },200);
  } catch {
    return reply({ error:"review_store_unavailable" },503);
  }
}
