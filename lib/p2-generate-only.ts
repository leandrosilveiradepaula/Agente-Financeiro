import "server-only";

import { NextResponse } from "next/server";
import type { AgentSession } from "@/lib/auth/auth-types";
import { createAgentRun, recordShadowDispatchReceipt } from "@/lib/agent-runs";
import {
  buildLangGraphShadowPrincipal,
  dispatchLangGraphP2GenerateOnly,
  isLangGraphShadowCanaryEligible
} from "@/lib/langgraph-shadow-client";
import { enforceCanGenerateSql } from "@/lib/profile-policy";
import { getRequestMetadata } from "@/lib/server-auth";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";
import { AGENT_VERSION } from "@/lib/types";

// This isolated admin canary never calls the official SQL-generation webhook,
// execute-approved, SQL execution, a repair endpoint or a financial database.
// Default-off, independently enabled only for the controlled P2 demonstration.
type RecordInput = Record<string, unknown>;

function response(body: RecordInput, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function isRecord(value: unknown): value is RecordInput {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readQuestion(request: Request): Promise<string | null> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return null;
  }
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > 20000) return null;
  try {
    const text = await request.text();
    if (text.length > 20000) return null;
    const body: unknown = JSON.parse(text);
    if (!isRecord(body) || Object.keys(body).length !== 1) return null;
    const question = body.pergunta;
    if (typeof question !== "string" || !question.trim() ||
        question.length > 16000) return null;
    return question.trim();
  } catch {
    return null;
  }
}

export async function handleP2GenerateOnly(
  request: Request,
  session: AgentSession,
  requestId: string
) {
  if (process.env.LANGGRAPH_P2_GENERATE_ONLY_ENABLED?.trim().toLowerCase() !== "true") {
    return response({ success: false, error: "not_found" }, 404);
  }
  // One admin behind an expiring subject canary; a normal SQL-generation
  // request cannot select this operation, even when P2 is enabled.
  if (session.userProfile !== "admin") {
    return response({ success: false, error: "forbidden" }, 403);
  }
  if (process.env.LANGGRAPH_SHADOW_TRANSPORT?.trim() !== "n8n" ||
      process.env.LANGGRAPH_OFFICIAL_VIA_N8N?.trim().toLowerCase() === "true") {
    return response({ success: false, error: "p2_transport_unavailable" }, 503);
  }

  const tenant = getSessionTenantIdentity(session);
  if (tenant.status === "required") {
    return response({ success: false, error: "tenant_identity_required" }, 403);
  }
  if (tenant.status === "ready") {
    // Explicit one-tenant boundary for the first canary. Membership alone
    // cannot attest that the LangGraph context belongs to that organization.
    const expected = process.env.LANGGRAPH_P2_AUTHORIZED_ORGANIZATION_ID?.trim();
    if (!expected || expected.toLowerCase() !== tenant.organizationId.toLowerCase()) {
      return response({ success: false, error: "p2_tenant_scope_unavailable" }, 503);
    }
  } else if (process.env.AGENT_INTERFACE_MODE?.trim().toLowerCase() !== "demo") {
    return response({ success: false, error: "p2_demo_scope_required" }, 503);
  }

  const principal = buildLangGraphShadowPrincipal(session);
  if (!principal || !isLangGraphShadowCanaryEligible(principal).allowed) {
    return response({ success: false, error: "p2_canary_forbidden" }, 403);
  }
  const policy = await enforceCanGenerateSql(session.userProfile);
  if (!policy.allowed) {
    return response({ success: false, error: "generation_policy_denied" }, 403);
  }

  const question = await readQuestion(request);
  if (!question) {
    return response({ success: false, error: "p2_question_invalid" }, 400);
  }

  let agentRun;
  try {
    agentRun = await createAgentRun({
      requestId,
      session,
      pergunta: question,
      source: "shadow_p2_generate_only",
      metadata: await getRequestMetadata(),
      extraMetadata: {
        operation: "shadow_generate_only",
        agent_version: AGENT_VERSION,
        official_sql_execution: false
      }
    });
  } catch {
    return response({ success: false, error: "p2_run_persistence_unavailable" }, 503);
  }

  const result = await dispatchLangGraphP2GenerateOnly({
    agentRunId: agentRun.id,
    question,
    principal,
    requestId,
    agentVersion: AGENT_VERSION
  });

  try {
    await recordShadowDispatchReceipt({
      id: agentRun.id,
      event: "generate",
      requestId,
      status: result.status,
      httpStatus: result.httpStatus,
      ...(tenant.status === "ready" ? { organizationId: tenant.organizationId } : {})
    });
  } catch {
    // Dispatch may already have reached n8n: return the run ID so the
    // operator can reconcile it instead of blindly retrying a paid call.
    return response({
      success: false, error: "p2_receipt_persistence_unavailable",
      agent_run_id: agentRun.id
    }, 503);
  }

  if (result.status !== "sent" || result.httpStatus !== 202) {
    return response({
      success: false,
      error: "p2_shadow_dispatch_unavailable",
      agent_run_id: agentRun.id,
      shadow_status: result.status
    }, 503);
  }

  // 202 is a transport receipt, NEVER evidence that Gemini generated SQL.
  // Correlate with the LangGraph shadow run before declaring P2 complete.
  return response({
    success: true,
    accepted: true,
    agent_run_id: agentRun.id,
    request_id: requestId,
    shadow_status: "sent",
    sql_generation_status: "pending",
    real_sql_execution: false
  }, 202);
}
