import "server-only";
import { db } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validTenantDisplayName(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() &&
    value.length >= 3 && value.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

export async function bootstrapInitialTenant(input: {
  actorId: string; sessionId: string; displayName: string;
}): Promise<{ organization_id: string }> {
  if (!UUID.test(input.actorId) || !UUID.test(input.sessionId) ||
      !validTenantDisplayName(input.displayName)) throw Error("tenant_bootstrap_invalid");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '4s'");
    // Transaction-level advisory lock serialises concurrent first-tenant
    // creation. The presence of ANY existing organization blocks bootstrap.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ai_agent_initial_tenant_bootstrap_v1'))"
    );
    const eligible = await client.query<{ permitted: boolean }>([
      "SELECT NOT EXISTS (SELECT 1 FROM public.ai_agent_organizations)",
      " AND EXISTS(SELECT 1 FROM public.ai_agent_users u",
      " WHERE u.id=$1::uuid AND u.is_active AND u.user_profile='admin') AS permitted"
    ].join(""), [input.actorId]);
    if (eligible.rows[0]?.permitted !== true) {
      throw Error("tenant_bootstrap_already_done_or_unqualified");
    }
    const created = await client.query<{ id: string }>(
      "INSERT INTO public.ai_agent_organizations(display_name) VALUES($1) RETURNING id",
      [input.displayName]
    );
    if (created.rowCount !== 1 || !created.rows[0]?.id) {
      throw Error("tenant_bootstrap_creation_failed");
    }
    const organizationId = created.rows[0].id;
    await client.query([
      "INSERT INTO public.ai_agent_user_organizations",
      "(user_id,organization_id,is_active) VALUES($1::uuid,$2::uuid,true)"
    ].join(" "), [input.actorId,organizationId]);
    const selected = await client.query<{id:string}>([
      "UPDATE public.ai_agent_sessions SET organization_id=$1::uuid",
      "WHERE id=$2::uuid AND user_id=$3::uuid",
      "AND revoked_at IS NULL AND expires_at > now() RETURNING id"
    ].join(" "), [organizationId,input.sessionId,input.actorId]);
    if (selected.rowCount !== 1) throw Error("tenant_bootstrap_session_invalid");
    await client.query([
      "INSERT INTO public.ai_agent_admin_audit_events",
      "(actor_user_id,actor_profile,target_user_id,action,success,after_data,metadata)",
      "VALUES($1::uuid,'admin',$1::uuid,'tenant_bootstrap',true,",
      "jsonb_build_object('organization_id',$2::text),",
      "'{\"source\":\"operator_explicit_bootstrap\"}'::jsonb)"
    ].join(" "), [input.actorId,organizationId]);
    await client.query("COMMIT");
    return { organization_id:organizationId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listTenantMembers(input: {
  organizationId: string; actorId: string;
}): Promise<{user_id:string;name:string;user_profile:string;is_active:boolean}[]> {
  if (!UUID.test(input.organizationId) || !UUID.test(input.actorId)) return [];
  const query=[
    "SELECT u.id AS user_id,u.name,u.user_profile,m.is_active",
    "FROM public.ai_agent_user_organizations m",
    "JOIN public.ai_agent_users u ON u.id=m.user_id",
    "WHERE m.organization_id=$1::uuid AND EXISTS(",
    " SELECT 1 FROM public.ai_agent_user_organizations own",
    " JOIN public.ai_agent_users actor ON actor.id=own.user_id",
    " JOIN public.ai_agent_organizations o ON o.id=own.organization_id",
    " WHERE own.user_id=$2::uuid AND own.organization_id=$1::uuid",
    " AND own.is_active AND actor.is_active AND o.is_active)",
    "ORDER BY u.name,u.id LIMIT 200"
  ].join(" ");
  const result=await db.query<{
    user_id:string;name:string;user_profile:string;is_active:boolean;
  }>(query,[input.organizationId,input.actorId]);
  return result.rows;
}

export async function addTenantMember(input: {
  organizationId: string; actorId: string; memberId: string;
}): Promise<{user_id:string}|null> {
  if (![input.organizationId,input.actorId,input.memberId].every(x=>UUID.test(x))) return null;
  // One statement inserts a first-time membership AND an audit record.
  // No ON CONFLICT UPDATE: deactivated membership cannot be silently revived.
  const query=[
    "WITH eligible AS ( SELECT u.id FROM public.ai_agent_users u",
    " WHERE u.id=$3::uuid AND u.is_active AND EXISTS (",
    " SELECT 1 FROM public.ai_agent_user_organizations own",
    " JOIN public.ai_agent_users actor ON actor.id=own.user_id",
    " JOIN public.ai_agent_organizations o ON o.id=own.organization_id",
    " WHERE own.user_id=$2::uuid AND own.organization_id=$1::uuid",
    " AND own.is_active AND actor.is_active AND o.is_active)",
    "), added AS ( INSERT INTO public.ai_agent_user_organizations",
    " (user_id,organization_id,is_active) SELECT id,$1::uuid,true FROM eligible",
    " ON CONFLICT (user_id,organization_id) DO NOTHING RETURNING user_id",
    "), audited AS ( INSERT INTO public.ai_agent_admin_audit_events",
    " (actor_user_id,actor_profile,target_user_id,action,success,after_data,metadata)",
    " SELECT $2::uuid,'admin',user_id,'tenant_membership_granted',true,",
    " jsonb_build_object('organization_id',$1::text),",
    " '{\"source\":\"operator_explicit_membership\"}'::jsonb",
    " FROM added RETURNING target_user_id)",
    " SELECT target_user_id AS user_id FROM audited"
  ].join(" ");
  const result=await db.query<{user_id:string}>(query,[
    input.organizationId,input.actorId,input.memberId
  ]);
  return result.rows[0]??null;
}
