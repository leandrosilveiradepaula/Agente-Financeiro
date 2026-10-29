import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server-auth";
import { getProfilePolicy } from "@/lib/profile-policy";
import { getSessionTenantIdentity } from "@/lib/tenant-identity";
import { addTenantMember, listTenantMembers } from "@/lib/tenant-operator";

export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{
  status,headers:{"Cache-Control":"no-store"}
});
async function authorize(){
  const {session,response}=await requireAdminSession();
  if(response||!session) return {response:response??fail("unauthorized",401)};
  const policy=await getProfilePolicy(session.userProfile);
  if(!policy?.can_manage_users) return {response:fail("forbidden",403)};
  if(process.env.AGENT_TENANT_MEMBERSHIP_ADMIN_ENABLED?.trim()!=="true"){
    return {response:fail("member_admin_disabled",404)};
  }
  const tenant=getSessionTenantIdentity(session);
  if(tenant.status!=="ready")return {response:fail("tenant_identity_required",403)};
  return {response:null,session,organizationId:tenant.organizationId};
}
export async function GET(){
  const gate=await authorize();
  if(gate.response)return gate.response;
  try{
    const members=await listTenantMembers({
      organizationId:gate.organizationId!,actorId:gate.session!.userId
    });
    return NextResponse.json({success:true,members},{
      headers:{"Cache-Control":"no-store"}
    });
  }catch{return fail("member_store_unavailable",503);}
}
export async function POST(request:Request){
  const gate=await authorize();
  if(gate.response)return gate.response;
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json"){
    return fail("invalid_request",400);
  }
  let payload:unknown;
  try{
    const s=await request.text();
    if(s.length>512)return fail("invalid_request",400);
    payload=JSON.parse(s);
  }catch{return fail("invalid_request",400);}
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return fail("invalid_request",400);
  const p=payload as Record<string,unknown>;
  if(Object.keys(p).join(",")!=="user_id"||typeof p.user_id!=="string"||
     !UUID.test(p.user_id))return fail("invalid_request",400);
  try{
    const added=await addTenantMember({
      organizationId:gate.organizationId!,
      actorId:gate.session!.userId,memberId:p.user_id
    });
    if(!added)return fail("membership_conflict_or_forbidden",409);
    return NextResponse.json({
      success:true,organization_id:gate.organizationId,
      member_user_id:added.user_id,
      financial_datasource_granted:false
    },{status:201,headers:{"Cache-Control":"no-store"}});
  }catch{return fail("member_store_unavailable",503);}
}
