import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { candidateBindingDigest } from "@/lib/candidate-sql-review";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const digest=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");

export type WitnessClaim={
  witnessId:string;
  executionRequestId:string;
  organizationId:string;
  agentRunId:string;
  bindingSha256:string;
  approvedSql:string; // never sent to browser/logs; private n8n only
};
type ClaimedRow={
  witness_id:string;
  execution_request_id:string;
  organization_id:string;
  agent_run_id:string;
  binding_sha256:string;
  sql_text:string;
  sql_sha256:string;
  question_text:string;
  question_sha256:string;
  requested_by:string;
  context_version:string;
  langgraph_run_id:string;
  response_fingerprint:string;
  provider_key:string;
  model_key:string;
  config_version:string;
};
export async function claimShadowWitness(input:{
  requestId:string; organizationId:string; actorId:string;
}):Promise<WitnessClaim|null>{
  if(![input.requestId,input.organizationId,input.actorId].every(s=>UUID.test(s)))return null;
  // Claim is unique per preapproved request. The database trigger repeats
  // scope/approval/immutability checks at INSERT time, including races.
  const statement=[
    "WITH eligible AS (",
    " SELECT req.id execution_request_id,req.organization_id,",
    "  req.binding_sha256,review.agent_run_id,review.sql_text,review.sql_sha256,",
    "  run.pergunta question_text,review.question_sha256,review.requested_by,",
    "  review.context_version,review.langgraph_run_id,review.response_fingerprint,",
    "  review.provider_key,review.model_key,review.config_version",
    " FROM public.ai_agent_candidate_execution_requests req",
    " JOIN public.ai_agent_candidate_sql_reviews review ON review.id=req.review_id",
    " JOIN public.ai_agent_runs run ON run.id=review.agent_run_id",
    "  AND run.organization_id=review.organization_id",
    "  AND run.user_id=review.requested_by AND run.sql_generated=review.sql_text",
    "  AND run.execution_status='generated'",
    "  AND run.source='candidate_langgraph_generate_only'",
    " JOIN public.ai_agent_user_organizations member",
    "  ON member.organization_id=req.organization_id",
    "  AND member.user_id=$3::uuid AND member.is_active",
    " JOIN public.ai_agent_users actor ON actor.id=member.user_id AND actor.is_active",
    " JOIN public.ai_agent_organizations org ON org.id=req.organization_id AND org.is_active",
    " WHERE req.id=$1::uuid AND req.organization_id=$2::uuid",
    "  AND req.state='pending_authorization'",
    "  AND req.binding_sha256=review.binding_sha256",
    "  AND req.sql_sha256=review.sql_sha256",
    "  AND review.organization_id=req.organization_id",
    "  AND review.review_status='approved'",
    "  AND review.decided_by IS NOT NULL AND review.decided_by<>review.requested_by",
    "  AND review.decided_at IS NOT NULL",
    "  AND encode(digest(review.sql_text,'sha256'),'hex')=review.sql_sha256",
    "  AND encode(digest(run.pergunta,'sha256'),'hex')=review.question_sha256",
    "), claimed AS (",
    " INSERT INTO public.ai_agent_candidate_shadow_witnesses",
    "  (execution_request_id,organization_id,actor_id,agent_run_id,binding_sha256)",
    " SELECT execution_request_id,organization_id,$3::uuid,agent_run_id,binding_sha256",
    " FROM eligible ON CONFLICT(execution_request_id) DO NOTHING",
    " RETURNING id,execution_request_id",
    ")",
    " SELECT c.id witness_id,e.*",
    " FROM claimed c JOIN eligible e ON e.execution_request_id=c.execution_request_id"
  ].join(" ");
  const result=await db.query<ClaimedRow>(statement,[
    input.requestId,input.organizationId,input.actorId
  ]);
  const row=result.rows[0];
  if(!row)return null;
  if(!row.sql_text || digest(row.sql_text)!==row.sql_sha256||
     digest(row.question_text)!==row.question_sha256 ||
     !SHA.test(row.binding_sha256) ||
     row.binding_sha256!==candidateBindingDigest({
       agentRunId:row.agent_run_id,
       organizationId:row.organization_id,
       requesterId:row.requested_by,
       langgraphRunId:row.langgraph_run_id,
       sqlSha256:row.sql_sha256,
       questionSha256:row.question_sha256,
       contextVersion:row.context_version,
       responseFingerprint:row.response_fingerprint,
       model:{
         provider_key:row.provider_key,
         model_key:row.model_key,
         config_version:row.config_version
       }
     })){
    await completeShadowWitness({
      witnessId:row.witness_id,organizationId:input.organizationId,
      status:"unavailable"
    });
    return null;
  }
  return {
    witnessId:row.witness_id,
    executionRequestId:row.execution_request_id,
    organizationId:row.organization_id,
    agentRunId:row.agent_run_id,
    bindingSha256:row.binding_sha256,
    approvedSql:row.sql_text
  };
}

export type WitnessConclusion={
  witnessId:string;organizationId:string;
  status:"success"|"rejected"|"unavailable";
  runId?:string;
  fingerprint?:string;
  requiresReapproval?:boolean;
  securityStatus?:string;
  contractStatus?:string;
  preflightStatus?:string;
};
export async function completeShadowWitness(input:WitnessConclusion):Promise<boolean>{
  if(!UUID.test(input.witnessId)||!UUID.test(input.organizationId)||
    !["success","rejected","unavailable"].includes(input.status))return false;
  if(input.status!=="unavailable"&&(
    !input.runId||input.runId.length>128||!input.fingerprint||
    !SHA.test(input.fingerprint)||!input.securityStatus||
    !input.contractStatus||!input.preflightStatus||
    (input.status==="success"&&(input.requiresReapproval===true||
       input.securityStatus!=="approved"||
       input.contractStatus!=="approved"||input.preflightStatus!=="approved"))
  ))return false;
  const completed=await db.query<{id:string}>(
    [
      "UPDATE public.ai_agent_candidate_shadow_witnesses",
      "SET status=$3::text, completed_at=now(),",
      " langgraph_run_id=$4::text,response_fingerprint=$5::char(64),",
      " requires_reapproval=$6::boolean,",
      " security_status=$7::text,contract_status=$8::text,preflight_status=$9::text",
      "WHERE id=$1::uuid AND organization_id=$2::uuid AND status='pending'",
      "RETURNING id"
    ].join(" "),[
      input.witnessId,input.organizationId,input.status,
      input.status==="unavailable"?null:input.runId,
      input.status==="unavailable"?null:input.fingerprint,
      input.status==="unavailable"?false:(input.requiresReapproval??false),
      input.status==="unavailable"?null:input.securityStatus,
      input.status==="unavailable"?null:input.contractStatus,
      input.status==="unavailable"?null:input.preflightStatus
    ]
  );
  return completed.rowCount===1;
}
