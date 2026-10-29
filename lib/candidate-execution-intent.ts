import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { candidateBindingDigest } from "@/lib/candidate-sql-review";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");

type Candidate = {
  review_id:string; agent_run_id:string; requested_by:string;
  sql_text:string; sql_sha256:string;
  question_text:string; question_sha256:string;
  binding_sha256:string; context_version:string; langgraph_run_id:string;
  response_fingerprint:string; provider_key:string; model_key:string; config_version:string;
};
export type ExecuteIntent = {
  request_id:string;
  review_id:string;
  state:"pending_authorization";
  real_sql_executed:false;
  execution_authorized:false;
};

// This method never executes financial SQL. Its output is a durable,
// single-use request for a SEPARATE, future Execute Approved authorization.
// No SQL string is forwarded to n8n, a model, or the browser.
export async function requestExecuteApprovedIntent(input:{
  organizationId:string; actorId:string; reviewId:string;
  expectedBindingSha256:string;
}):Promise<ExecuteIntent|null>{
  if(![input.organizationId,input.actorId,input.reviewId].every(x=>UUID.test(x)) ||
     !SHA.test(input.expectedBindingSha256)) return null;
  const lookup=[
    "SELECT r.id AS review_id,r.agent_run_id,r.requested_by,r.sql_text,",
    " r.sql_sha256,q.pergunta AS question_text,r.question_sha256,",
    " r.binding_sha256,r.context_version,r.langgraph_run_id,",
    " r.response_fingerprint,r.provider_key,r.model_key,r.config_version",
    " FROM public.ai_agent_candidate_sql_reviews r",
    " JOIN public.ai_agent_runs q ON q.id=r.agent_run_id",
    "  AND q.organization_id=r.organization_id",
    "  AND q.user_id=r.requested_by AND q.sql_generated=r.sql_text",
    "  AND q.source='candidate_langgraph_generate_only'",
    "  AND q.execution_status='generated'",
    " JOIN public.ai_agent_user_organizations member",
    "  ON member.organization_id=r.organization_id",
    "  AND member.user_id=$2::uuid AND member.is_active",
    " JOIN public.ai_agent_users actor ON actor.id=member.user_id AND actor.is_active",
    " JOIN public.ai_agent_organizations org ON org.id=r.organization_id AND org.is_active",
    " WHERE r.id=$3::uuid AND r.organization_id=$1::uuid",
    "  AND r.review_status='approved' AND r.decided_at IS NOT NULL",
    "  AND r.decided_by IS NOT NULL AND r.decided_by <> r.requested_by",
    "  AND r.binding_sha256=$4::char(64) LIMIT 1"
  ].join(" ");
  const result=await db.query<Candidate>(lookup,[
    input.organizationId,input.actorId,input.reviewId,input.expectedBindingSha256
  ]);
  const review=result.rows[0];
  if(!review || !review.sql_text || !review.question_text) return null;
  if(hash(review.sql_text)!==review.sql_sha256 ||
     hash(review.question_text)!==review.question_sha256 ||
     review.binding_sha256!==candidateBindingDigest({
       agentRunId:review.agent_run_id,
       organizationId:input.organizationId, requesterId:review.requested_by,
       langgraphRunId:review.langgraph_run_id,
       sqlSha256:review.sql_sha256,questionSha256:review.question_sha256,
       contextVersion:review.context_version,
       responseFingerprint:review.response_fingerprint,
       model:{
         provider_key:review.provider_key,
         model_key:review.model_key,
         config_version:review.config_version
       }
     })) return null;

  // The database insert trigger rechecks approval, tenant, current
  // membership, run source and persisted SQL. UNIQUE(review_id) rejects
  // replay and concurrents; no SQL is returned to this operation.
  const statement=[
    "INSERT INTO public.ai_agent_candidate_execution_requests",
    "(review_id,organization_id,requested_by,binding_sha256,sql_sha256)",
    "VALUES($1::uuid,$2::uuid,$3::uuid,$4::char(64),$5::char(64))",
    "ON CONFLICT (review_id) DO NOTHING RETURNING id"
  ].join(" ");
  const inserted=await db.query<{id:string}>(statement,[
    input.reviewId,input.organizationId,input.actorId,
    review.binding_sha256,review.sql_sha256
  ]);
  if(inserted.rowCount!==1) return null;
  return {
    request_id:inserted.rows[0].id,
    review_id:input.reviewId,
    state:"pending_authorization",
    real_sql_executed:false,
    execution_authorized:false
  };
}
