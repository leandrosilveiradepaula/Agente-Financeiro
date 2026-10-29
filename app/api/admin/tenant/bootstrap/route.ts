import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server-auth";
import { getProfilePolicy } from "@/lib/profile-policy";
import { isTenantIdentityEnabled } from "@/lib/tenant-identity";
import {
  bootstrapInitialTenant, validTenantDisplayName
} from "@/lib/tenant-operator";

export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(error:string,status:number)=>NextResponse.json({
  success:false,error
},{status,headers:{"Cache-Control":"no-store"}});

export async function POST(request:Request){
  const {session,response}=await requireAdminSession();
  if(response || !session)return response;
  const policy=await getProfilePolicy(session.userProfile);
  if(!policy?.can_manage_users) return reply("forbidden",403);
  if(!isTenantIdentityEnabled() ||
     process.env.AGENT_TENANT_INITIAL_BOOTSTRAP_ENABLED?.trim()!=="true") {
    return reply("bootstrap_disabled",404);
  }
  // Explicit operator pin, independent of admin role or session JWT.
  // No default tenant, synthetic organization or identity fallback.
  const pinned=process.env.AGENT_TENANT_BOOTSTRAP_ACTOR_ID?.trim()??"";
  if(!UUID.test(pinned) || pinned.toLowerCase()!==session.userId.toLowerCase()){
    return reply("bootstrap_operator_unverified",403);
  }
  if(session.organizationId) return reply("tenant_already_selected",409);
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"){
    return reply("invalid_request",400);
  }
  let body:unknown;
  try{
    const text=await request.text();
    if(text.length>512) return reply("invalid_request",400);
    body=JSON.parse(text);
  }catch{return reply("invalid_request",400);}
  if(!body || typeof body!=="object" || Array.isArray(body))return reply("invalid_request",400);
  const fields=body as Record<string,unknown>;
  if(Object.keys(fields).sort().join(",")!=="confirm,display_name" ||
    fields.confirm!=="CREATE-INITIAL-ORGANIZATION" ||
    !validTenantDisplayName(fields.display_name)){
    return reply("invalid_request",400);
  }
  try{
    const created=await bootstrapInitialTenant({
      actorId:session.userId,sessionId:session.sessionId,
      displayName:fields.display_name
    });
    return NextResponse.json({
      success:true,organization_id:created.organization_id,
      organization_created_by_explicit_operator:true,
      financial_datasource_configured:false,
      execution_authorized:false
    },{status:201,headers:{"Cache-Control":"no-store"}});
  }catch{
    return reply("bootstrap_unavailable_or_already_completed",409);
  }
}
