import { NextResponse } from "next/server";
import { requireAgentSession } from "@/lib/server-auth";
import { enforceCanGenerateSql } from "@/lib/profile-policy";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";
import {
  getLlmRegistryEnvironment,
  resolveLlmSelection
} from "@/lib/llm-provider-registry";
import { isShadowPhaseOneProviderMatch } from "@/lib/shadow-phase-gate";

export const runtime = "nodejs";

function failure(code: string, status: number) {
  return NextResponse.json({ success: false, error: code }, {
    status, headers: { "Cache-Control": "no-store" }
  });
}
function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function endpoint() {
  const raw = process.env.N8N_CANDIDATE_GENERATE_WEBHOOK_URL?.trim();
  const token = process.env.N8N_CANDIDATE_GENERATE_TOKEN?.trim();
  if (!raw || !token) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search ||
      url.hash || url.pathname !== "/webhook/langgraph-candidate-generate-v1" ||
      !url.hostname || url.hostname === "localhost" ||
      !/^[A-Za-z0-9.-]+$/.test(url.hostname)) return null;
    return { url: url.href, token };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const { session, response } = await requireAgentSession();
  if (response || !session) return response;
  if (session.userProfile !== "admin") return failure("forbidden", 403);
  if (process.env.AGENT_CANDIDATE_GENERATE_ENABLED?.trim() !== "true" ||
      process.env.LANGGRAPH_OFFICIAL_VIA_N8N?.trim() === "true") {
    return failure("candidate_disabled", 404);
  }
  const tenant = getSessionTenantIdentity(session);
  if (tenant.status === "required") return failure("tenant_identity_required", 403);
  if (tenant.status === "ready" &&
      process.env.AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID?.trim()?.toLowerCase() !==
      tenant.organizationId.toLowerCase()) {
    return failure("tenant_scope_unavailable", 503);
  }
  const policy = await enforceCanGenerateSql(session.userProfile);
  if (!policy.allowed) return failure("generation_forbidden", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json") return failure("request_invalid", 400);
  const size = request.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || Number(size) > 20000))
    return failure("request_invalid", 400);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 20000) return failure("request_invalid", 400);
    body = JSON.parse(text);
  } catch {
    return failure("request_invalid", 400);
  }
  if (!isRecord(body) || Object.keys(body).length !== 1 ||
      typeof body.pergunta !== "string" || !body.pergunta.trim() ||
      body.pergunta.length > 16000) return failure("question_invalid", 400);
  const target = endpoint();
  if (!target) return failure("candidate_transport_unavailable", 503);
  const registryEnv = process.env.LLM_REGISTRY_ENVIRONMENT || getLlmRegistryEnvironment();
  let selected;
  try {
    const official = resolveLlmSelection({
      environment: registryEnv, target: "official", profile: session.userProfile
    });
    const shadow = resolveLlmSelection({
      environment: registryEnv, target: "shadow", profile: session.userProfile
    });
    if (!isShadowPhaseOneProviderMatch(official.selection, shadow.selection) ||
        !shadow.selection) return failure("provider_parity_unattested", 503);
    selected = shadow.selection;
  } catch {
    return failure("provider_parity_unattested", 503);
  }
  const agentRunId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const envelope = {
    contract_version: "1",
    agent_run_id: agentRunId,
    question: body.pergunta.trim(),
    principal: {
      id: session.userId,
      profile: session.userProfile,
      ...(tenant.status === "ready" ? { organization_id: tenant.organizationId } : {})
    },
    llm_selection: selected,
    correlation_metadata: {
      source: "nextjs_bff", event: "generate",
      route: "/api/generate-sql", timestamp: new Date().toISOString(),
      request_id: requestId
    }
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const upstream = await fetch(target.url, {
      method: "POST", cache: "no-store", redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Candidate-Token": target.token
      },
      body: JSON.stringify(envelope)
    });
    if (upstream.status !== 200) {
      return failure("candidate_generation_unavailable", 503);
    }
    const output: unknown = await upstream.json();
    if (!isRecord(output) || output.contract_version !== "1" ||
      output.agent_run_id !== agentRunId ||
      typeof output.run_id !== "string" || !output.run_id ||
      typeof output.response_fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/i.test(output.response_fingerprint) ||
      output.real_sql_executed !== false ||
      output.requires_human_approval !== true ||
      !isRecord(output.preflight) ||
      output.preflight.executed !== false ||
      !["success", "rejected", "infrastructure_error"].includes(String(output.status))) {
      return failure("candidate_evidence_invalid", 502);
    }
    if (output.status !== "success") {
      return NextResponse.json({
        success: false, status: output.status, agent_run_id: agentRunId,
        run_id: output.run_id, error: "candidate_sql_not_approved_by_gates",
        real_sql_executed: false
      }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    if (output.preflight.status !== "approved" ||
      typeof output.sql !== "string" || !output.sql.trim() ||
      output.sql.length > 262144) return failure("candidate_sql_invalid", 502);

    // Read-only presentation: no SQL persistence or approval in the product,
    // no call to the legacy execution route and no implicit cutover.
    return NextResponse.json({
      success: true, agent_run_id: agentRunId, run_id: output.run_id,
      sql: output.sql, intent: typeof output.intent === "string" ? output.intent : null,
      context_version: isRecord(output.metadata) && typeof output.metadata.context_version === "string"
        ? output.metadata.context_version : null,
      requires_human_approval: true,
      real_sql_executed: false
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return failure("candidate_generation_unavailable", 503);
  } finally {
    clearTimeout(timeout);
  }
}
