import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export type CandidateModel = {
  provider_key: string;
  model_key: string;
  config_version: string;
};
export type CandidateReview = {
  id: string;
  agent_run_id: string;
  organization_id: string;
  requested_by: string;
  langgraph_run_id: string;
  sql_text: string;
  sql_sha256: string;
  question_sha256: string;
  context_version: string;
  response_fingerprint: string;
  provider_key: string;
  model_key: string;
  config_version: string;
  binding_sha256: string;
  review_status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (input: string) => createHash("sha256").update(input, "utf8").digest("hex");

export function candidateBindingDigest(input: {
  agentRunId: string;
  organizationId: string;
  requesterId: string;
  langgraphRunId: string;
  sqlSha256: string;
  questionSha256: string;
  contextVersion: string;
  responseFingerprint: string;
  model: CandidateModel;
}) {
  return digest(JSON.stringify([
    "candidate-review-v1", input.agentRunId, input.organizationId,
    input.requesterId, input.langgraphRunId, input.sqlSha256,
    input.questionSha256, input.contextVersion, input.responseFingerprint,
    input.model.provider_key, input.model.model_key, input.model.config_version
  ]));
}
export async function persistCandidateReview(input: {
  agentRunId: string;
  requestId: string;
  organizationId: string;
  requesterId: string;
  question: string;
  sql: string;
  langgraphRunId: string;
  contextVersion: string;
  responseFingerprint: string;
  model: CandidateModel;
}): Promise<{ id: string; sql_sha256: string; binding_sha256: string }> {
  if (![input.agentRunId, input.organizationId, input.requesterId].every((v) => uuid.test(v)) ||
      !input.question.trim() || !input.sql.trim() || input.sql.length > 262144 ||
      !/^[0-9a-f]{64}$/i.test(input.responseFingerprint) ||
      !input.contextVersion.trim() || input.contextVersion.length > 128 ||
      !input.langgraphRunId.trim() || input.langgraphRunId.length > 128 ||
      [input.model.provider_key, input.model.model_key, input.model.config_version].some(
        (v) => typeof v !== "string" || !v.trim() || v.length > 128
      )) throw new Error("candidate_review_invalid");
  const sqlSha256 = digest(input.sql);
  const questionSha256 = digest(input.question);
  const bindingSha256 = candidateBindingDigest({
    agentRunId: input.agentRunId,
    organizationId: input.organizationId,
    requesterId: input.requesterId,
    langgraphRunId: input.langgraphRunId, sqlSha256, questionSha256,
    contextVersion: input.contextVersion,
    responseFingerprint: input.responseFingerprint, model: input.model
  });
  // A single PostgreSQL statement atomically inserts the official run and
  // its immutable proposal. Inactive tenant/membership => zero inserts.
  const statement = [
    "WITH membership AS (",
    "  SELECT 1 AS allowed FROM public.ai_agent_user_organizations m",
    "  JOIN public.ai_agent_organizations o ON o.id = m.organization_id",
    "  WHERE m.user_id=$3::uuid AND m.organization_id=$2::uuid",
    "    AND m.is_active IS TRUE AND o.is_active IS TRUE",
    "), created_run AS (",
    "  INSERT INTO public.ai_agent_runs (",
    "    id,request_id,run_id,user_id,user_profile,organization_id,",
    "    auth_source,pergunta,sql_generated,execution_status,",
    "    validation_status,source,llm_provider,llm_model,metadata",
    "  ) SELECT $1::uuid,$4::text,$5::text,$3::uuid,'admin',$2::uuid,",
    "    'database_session',$6::text,$7::text,'generated',",
    "    'approved','candidate_langgraph_generate_only',$8::text,$9::text,",
    "    '{}'::jsonb FROM membership RETURNING id",
    ")",
    "INSERT INTO public.ai_agent_candidate_sql_reviews (",
    "  agent_run_id,organization_id,requested_by,langgraph_run_id,",
    "  sql_text,sql_sha256,question_sha256,context_version,",
    "  response_fingerprint,provider_key,model_key,config_version,binding_sha256",
    ") SELECT r.id,$2::uuid,$3::uuid,$5::text,$7::text,$10::char(64),",
    "  $11::char(64),$12::text,$13::char(64),$8::text,$9::text,",
    "  $14::text,$15::char(64) FROM created_run r RETURNING id"
  ].join("\n");
  const result = await db.query<{ id: string }>(statement, [
    input.agentRunId, input.organizationId, input.requesterId,
    input.requestId, input.langgraphRunId, input.question, input.sql,
    input.model.provider_key, input.model.model_key, sqlSha256,
    questionSha256, input.contextVersion, input.responseFingerprint,
    input.model.config_version, bindingSha256
  ]);
  if (result.rowCount !== 1) throw new Error("candidate_review_membership_unavailable");
  return { id: result.rows[0].id, sql_sha256: sqlSha256, binding_sha256: bindingSha256 };
}

export async function getCandidateReview(input: {
  id: string; organizationId: string; actorId: string;
}): Promise<CandidateReview | null> {
  if (![input.id,input.organizationId,input.actorId].every(v=>uuid.test(v))) return null;
  const statement = [
    "SELECT r.* FROM public.ai_agent_candidate_sql_reviews r",
    "JOIN public.ai_agent_organizations o ON o.id=r.organization_id AND o.is_active",
    "JOIN public.ai_agent_user_organizations m ON m.organization_id=o.id",
    " AND m.user_id=$3::uuid AND m.is_active",
    "JOIN public.ai_agent_users u ON u.id=m.user_id AND u.is_active",
    "WHERE r.id=$1::uuid AND r.organization_id=$2::uuid LIMIT 1"
  ].join("\n");
  const result = await db.query<CandidateReview>(statement,
    [input.id,input.organizationId,input.actorId]);
  return result.rows[0] ?? null;
}

export async function decideCandidateReview(input: {
  id: string; organizationId: string; actorId: string;
  decision: "approved" | "rejected"; expectedBindingSha256: string;
}): Promise<{ id: string; status: string; binding_sha256: string } | null> {
  if (![input.id,input.organizationId,input.actorId].every((v) => uuid.test(v)) ||
      !/^[0-9a-f]{64}$/i.test(input.expectedBindingSha256) ||
      !["approved","rejected"].includes(input.decision)) return null;
  const statement = [
    "UPDATE public.ai_agent_candidate_sql_reviews r",
    "SET review_status=$4::text, decided_by=$3::uuid, decided_at=now()",
    "WHERE r.id=$1::uuid AND r.organization_id=$2::uuid",
    "  AND r.review_status='pending' AND r.binding_sha256=$5::char(64)",
    "  AND r.requested_by <> $3::uuid",
    "  AND encode(digest(r.sql_text, 'sha256'), 'hex') = r.sql_sha256",
    "  AND EXISTS (SELECT 1 FROM public.ai_agent_runs q",
    "    WHERE q.id=r.agent_run_id AND q.organization_id=r.organization_id",
    "      AND q.user_id=r.requested_by AND q.sql_generated=r.sql_text",
    "      AND q.execution_status='generated'",
    "      AND encode(digest(q.pergunta, 'sha256'), 'hex')=r.question_sha256)",
    "  AND EXISTS (SELECT 1 FROM public.ai_agent_user_organizations m",
    "   JOIN public.ai_agent_organizations o ON o.id=m.organization_id",
    "   WHERE m.organization_id=$2::uuid AND m.user_id=$3::uuid",
    "     AND m.is_active AND o.is_active)",
    "RETURNING r.id,r.review_status,r.binding_sha256"
  ].join("\n");
  const result = await db.query<{
    id: string; review_status: string; binding_sha256: string;
  }>(statement, [
    input.id,input.organizationId,input.actorId,
    input.decision,input.expectedBindingSha256
  ]);
  if (result.rowCount !== 1) return null;
  return {
    id:result.rows[0].id,
    status:result.rows[0].review_status,
    binding_sha256:result.rows[0].binding_sha256
  };
}
