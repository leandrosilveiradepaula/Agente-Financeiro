import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server-auth";
import { getProfilePolicy } from "@/lib/profile-policy";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";
import { requestExecuteApprovedIntent } from "@/lib/candidate-execution-intent";

export const runtime="nodejs";
type Context={params:Promise<{id:string}>};
const SHA=/^[0-9a-f]{64}$/;
const fail=(error:string,status:number)=>NextResponse.json({
  success:false,error,real_sql_executed:false
},{status,headers:{"Cache-Control":"no-store"}});

// Execute Approved Stage 1: verify immutable human approval and create
// a durable, non-executable request for separate operator authorization.
// There is deliberately NO SQL executor, database financial query,
// n8n webhook or provider invocation in this endpoint.
export async function POST(request:Request,context:Context){
  const {session,response}=await requireAdminSession();
  if(response||!session)return response;
  const policy=await getProfilePolicy(session.userProfile);
  if(!policy?.is_active||!policy.can_view_sql||!policy.can_execute_sql){
    return fail("execute_intent_policy_denied",403);
  }
  if(process.env.AGENT_CANDIDATE_EXECUTION_REQUEST_ENABLED?.trim()!=="true" ||
     process.env.AGENT_CANDIDATE_REVIEW_ENABLED?.trim()!=="true" ||
     process.env.LANGGRAPH_OFFICIAL_VIA_N8N?.trim()==="true"){
    return fail("execute_intent_disabled",404);
  }
  const tenant=getSessionTenantIdentity(session);
  if(tenant.status!=="ready")return fail("tenant_identity_required",403);
  if(tenant.organizationId.toLowerCase()!==
     process.env.AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID?.trim()?.toLowerCase()){
    return fail("tenant_scope_unavailable",403);
  }
  const {id}=await context.params;
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"){
    return fail("invalid_request",400);
  }
  let body:unknown;
  try{
    const text=await request.text();
    if(text.length>1024)return fail("invalid_request",400);
    body=JSON.parse(text);
  }catch{return fail("invalid_request",400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return fail("invalid_request",400);
  const p=body as Record<string,unknown>;
  if(Object.keys(p).join(",")!=="binding_sha256" ||
     typeof p.binding_sha256!=="string" || !SHA.test(p.binding_sha256)){
    return fail("invalid_request",400);
  }
  try{
    const receipt=await requestExecuteApprovedIntent({
      reviewId:id,organizationId:tenant.organizationId,
      actorId:session.userId,expectedBindingSha256:p.binding_sha256
    });
    if(!receipt)return fail("execution_request_conflict_or_unqualified",409);
    return NextResponse.json({success:true,...receipt},{
      status:202,headers:{"Cache-Control":"no-store"}
    });
  }catch{return fail("execution_request_store_unavailable",503);}
}
