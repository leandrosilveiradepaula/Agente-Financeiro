import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server-auth";
import { getProfilePolicy } from "@/lib/profile-policy";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";
import {
  claimShadowWitness,completeShadowWitness
} from "@/lib/candidate-shadow-witness";

export const runtime="nodejs";
type Context={params:Promise<{id:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const reply=(error:string,status:number)=>NextResponse.json({
  success:false,error,real_sql_executed:false,financial_parity_proven:false
},{status,headers:{"Cache-Control":"no-store"}});

function endpoint():{url:string;token:string}|null{
  const input=process.env.N8N_CANDIDATE_SHADOW_WITNESS_WEBHOOK_URL?.trim();
  const token=process.env.N8N_CANDIDATE_SHADOW_WITNESS_TOKEN?.trim();
  if(!input||!token||token.length>1024)return null;
  try{
    const url=new URL(input);
    if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||
       url.pathname!=="/webhook/langgraph-candidate-approved-sql-shadow-v1"||
       !/^[a-z0-9.-]+$/i.test(url.hostname)||url.hostname==="localhost")return null;
    return {url:url.href,token};
  }catch{return null;}
}

function isObject(x:unknown):x is Record<string,unknown>{
  return x!==null&&typeof x==="object"&&!Array.isArray(x);
}

// This is a validation-only Shadow WITNESS, not Execute Approved.
// No SQL is accepted from browser or returned in any response. A database
// one-shot claim ensures an approved SQL cannot be replayed via this route.
export async function POST(request:Request,context:Context){
  const {session,response}=await requireAdminSession();
  if(response||!session)return response;
  const policy=await getProfilePolicy(session.userProfile);
  if(!policy?.is_active||!policy.can_view_sql||!policy.can_execute_sql)return reply("forbidden",403);
  if(process.env.AGENT_CANDIDATE_SHADOW_WITNESS_ENABLED?.trim()!=="true"||
     process.env.AGENT_CANDIDATE_SHADOW_WITNESS_NO_EXECUTION_ATTESTED?.trim()!=="true"||
     process.env.AGENT_CANDIDATE_EXECUTION_REQUEST_ENABLED?.trim()!=="true"||
     process.env.LANGGRAPH_OFFICIAL_VIA_N8N?.trim()==="true"){
    return reply("witness_disabled",404);
  }
  const tenant=getSessionTenantIdentity(session);
  if(tenant.status!=="ready")return reply("tenant_identity_required",403);
  if(tenant.organizationId.toLowerCase()!==
     process.env.AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID?.trim()?.toLowerCase()){
    return reply("tenant_scope_mismatch",403);
  }
  const id=(await context.params).id;
  if(!UUID.test(id))return reply("invalid_request",400);
  const target=endpoint();
  if(!target)return reply("witness_transport_unavailable",503);
  // Empty body only. Any SQL/tenant/fingerprint passed from the browser
  // would be an authorization bypass, even if it matches stored SQL.
  if(request.headers.get("content-length")&&
     Number(request.headers.get("content-length"))>2)return reply("body_not_allowed",400);
  const raw=await request.text();
  if(raw.trim()&&raw.trim()!=="{}")return reply("body_not_allowed",400);
  let claim;
  try{
    claim=await claimShadowWitness({
      requestId:id,organizationId:tenant.organizationId,actorId:session.userId
    });
  }catch{return reply("witness_claim_unavailable",503);}
  if(!claim)return reply("witness_missing_already_used_or_unqualified",409);
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),60000);
  try{
    const correlation=crypto.randomUUID();
    const upstream=await fetch(target.url,{
      method:"POST",cache:"no-store",redirect:"error",
      signal:ctrl.signal,
      headers:{
        "Content-Type":"application/json",
        "X-Agent-Shadow-Witness-Token":target.token
      },
      body:JSON.stringify({
        contract_version:"1",
        agent_run_id:claim.agentRunId,
        approved_sql:claim.approvedSql,
        principal:{
          id:session.userId,profile:session.userProfile,
          organization_id:claim.organizationId
        },
        correlation_metadata:{
          source:"nextjs_bff",event:"execute_approved_shadow",
          route:"candidate_execute_approved_shadow_v1",
          timestamp:new Date().toISOString(),
          request_id:correlation,
          execution_request_id:claim.executionRequestId,
          approval_binding_sha256:claim.bindingSha256,
          generation_run_id:claim.generationRunId,
          generation_requester_id:claim.generationRequesterId,
          generation_context_version:claim.generationContextVersion,
          generation_response_fingerprint:claim.generationResponseFingerprint
        }
      })
    });
    if(upstream.status!==200&&upstream.status!==422)throw Error("witness_upstream_invalid");
    const data:unknown=await upstream.json();
    if(!isObject(data)||data.contract_version!=="1"||
       data.agent_run_id!==claim.agentRunId||
       data.execution_request_id!==claim.executionRequestId||
       typeof data.run_id!=="string"||!data.run_id||
       typeof data.response_fingerprint!=="string"||
       !SHA.test(data.response_fingerprint)||
       data.real_sql_executed!==false||
       data.financial_parity_proven!==false||
       (upstream.status===200)!==(data.status==="success")||
       !["success","rejected"].includes(String(data.status))||
       typeof data.requires_reapproval!=="boolean"||
       !isObject(data.validation)||
       typeof data.validation.security!=="string"||
       typeof data.validation.contract!=="string"||
       typeof data.validation.preflight!=="string"){
      throw Error("witness_evidence_invalid");
    }
    if(data.status==="success"&&
      (data.requires_reapproval===true||
       data.validation.security!=="approved"||
       data.validation.contract!=="approved"||
       data.validation.preflight!=="approved")){
      throw Error("witness_gate_invalid");
    }
    const stored=await completeShadowWitness({
      witnessId:claim.witnessId,organizationId:claim.organizationId,
      status:data.status as "success"|"rejected",
      runId:data.run_id,fingerprint:data.response_fingerprint,
      requiresReapproval:data.requires_reapproval,
      securityStatus:data.validation.security,
      contractStatus:data.validation.contract,
      preflightStatus:data.validation.preflight
    });
    if(!stored)throw Error("witness_evidence_storage_failed");
    return NextResponse.json({
      success:true,witness_id:claim.witnessId,
      execution_request_id:id,
      witness_status:data.status,
      langgraph_run_id:data.run_id,
      requires_reapproval:data.requires_reapproval,
      shadow_preflight_status:data.validation.preflight,
      real_sql_executed:false,
      execution_authorized:false,
      financial_parity_proven:false
    },{headers:{"Cache-Control":"no-store"}});
  }catch{
    // No retry after an ambiguous transport response. A human must
    // reconcile evidence before a replacement proposal/run.
    try{
      await completeShadowWitness({
        witnessId:claim.witnessId,
        organizationId:claim.organizationId,status:"unavailable"
      });
    }catch{/* no secret/error leakage */}
    return reply("witness_unavailable_requires_reconciliation",503);
  }finally{clearTimeout(timeout);}
}
