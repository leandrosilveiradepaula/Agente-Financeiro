import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";

const candidateDb = process.env.CANDIDATE_DB_REHEARSAL==="true" ?
  describe.sequential : describe.skip;
const ADMIN_A="11111111-1111-4111-8111-111111111111";
const ADMIN_B="22222222-2222-4222-8222-222222222222";
const FOREIGN="33333333-3333-4333-8333-333333333333";
const RUN_ID="44444444-4444-4444-8444-444444444444";
const BAD_ORG="55555555-5555-4555-8555-555555555555";

candidateDb("real operator onboarding and Execute Approved intent (no execution)",()=>{
  let db:typeof import("@/lib/db")["db"];
  let operator:typeof import("@/lib/tenant-operator");
  let review:typeof import("@/lib/candidate-sql-review");
  let intent:typeof import("@/lib/candidate-execution-intent");
  let shadow:typeof import("@/lib/candidate-shadow-witness");
  let sessionId="";
  let organizationId="";
  let reviewId="";
  let executionRequestId="";
  let bindingSha="";
  const candidateSql="SELECT 1";
  beforeAll(async()=>{
    const u=new URL(process.env.DATABASE_URL??"");
    if(process.env.CI!=="true" || u.protocol!=="postgresql:" ||
       u.hostname!=="127.0.0.1" ||
       u.pathname!=="/tenant_candidate_ci_fixture" || u.username!=="tenant_ci") {
      throw Error("candidate rehearsal requires isolated local CI PostgreSQL");
    }
    ({db}=await import("@/lib/db"));
    operator=await import("@/lib/tenant-operator");
    review=await import("@/lib/candidate-sql-review");
    intent=await import("@/lib/candidate-execution-intent");
    shadow=await import("@/lib/candidate-shadow-witness");
    await db.query([
      "INSERT INTO public.ai_agent_users",
      "(id,name,email,user_profile,password_hash) VALUES",
      "($1::uuid,'Admin One','admin-one@fixture.invalid','admin','synthetic'),",
      "($2::uuid,'Admin Two','admin-two@fixture.invalid','admin','synthetic'),",
      "($3::uuid,'Unrelated','unrelated@fixture.invalid','admin','synthetic')"
    ].join(" "),[ADMIN_A,ADMIN_B,FOREIGN]);
    const created=await db.query<{id:string}>([
      "INSERT INTO public.ai_agent_sessions",
      "(user_id,session_token_hash,expires_at)",
      "VALUES($1::uuid,'synthetic-session',now()+interval '1 day') RETURNING id"
    ].join(" "),[ADMIN_A]);
    sessionId=created.rows[0].id;
  });
  afterAll(async()=>{if(db)await db.end();});

  it("starts with no implicit tenant or member",async()=>{
    const r=await db.query<{orgs:string;members:string}>(
      "SELECT (SELECT count(*)::text FROM public.ai_agent_organizations) orgs, " +
      "(SELECT count(*)::text FROM public.ai_agent_user_organizations) members"
    );
    expect(r.rows[0]).toEqual({orgs:"0",members:"0"});
  });

  it("creates the first explicitly named tenant and audit in one transaction",async()=>{
    expect(operator.validTenantDisplayName("")).toBe(false);
    expect(operator.validTenantDisplayName(" Untrimmed")).toBe(false);
    const created=await operator.bootstrapInitialTenant({
      actorId:ADMIN_A,sessionId,displayName:"Independent Demo Context"
    });
    organizationId=created.organization_id;
    const r=await db.query<{
      display_name:string;session_organization:string;audits:string;
    }>([
      "SELECT o.display_name,s.organization_id::text AS session_organization,",
      "(SELECT count(*)::text FROM public.ai_agent_admin_audit_events a",
      " WHERE a.actor_user_id=$1::uuid AND a.action='tenant_bootstrap') AS audits",
      "FROM public.ai_agent_organizations o",
      "JOIN public.ai_agent_sessions s ON s.organization_id=o.id",
      "WHERE o.id=$2::uuid"
    ].join(" "),[ADMIN_A,organizationId]);
    expect(r.rows[0]).toEqual({
      display_name:"Independent Demo Context",
      session_organization:organizationId,
      audits:"1"
    });
    await expect(operator.bootstrapInitialTenant({
      actorId:ADMIN_A,sessionId,displayName:"Duplicate"
    })).rejects.toThrow("tenant_bootstrap_already_done_or_unqualified");
    await expect(operator.bootstrapInitialTenant({
      actorId:FOREIGN,sessionId,displayName:"Unapproved"
    })).rejects.toThrow("tenant_bootstrap_already_done_or_unqualified");
  });

  it("requires explicit membership; records audit and denies re-grant",async()=>{
    expect(await operator.addTenantMember({
      organizationId,actorId:FOREIGN,memberId:ADMIN_B
    })).toBeNull();
    expect(await operator.addTenantMember({
      organizationId,actorId:ADMIN_A,memberId:ADMIN_B
    })).toEqual({user_id:ADMIN_B});
    expect(await operator.addTenantMember({
      organizationId,actorId:ADMIN_A,memberId:ADMIN_B
    })).toBeNull();
    const members=await operator.listTenantMembers({
      organizationId,actorId:ADMIN_A
    });
    expect(members.map(m=>m.user_id).sort()).toEqual([ADMIN_A,ADMIN_B]);
    expect(await operator.listTenantMembers({
      organizationId,actorId:FOREIGN
    })).toEqual([]);
    const audits=await db.query<{total:string}>(
      "SELECT count(*)::text AS total FROM public.ai_agent_admin_audit_events " +
      "WHERE action='tenant_membership_granted' AND target_user_id=$1::uuid",
      [ADMIN_B]
    );
    expect(audits.rows[0].total).toBe("1");
  });

  it("persists real candidate and requires distinct approved human reviewer",async()=>{
    const p=await review.persistCandidateReview({
      agentRunId:RUN_ID,requestId:"operator-fixture-request",
      organizationId,requesterId:ADMIN_A,
      question:"An entirely new synthetic question",sql:candidateSql,
      langgraphRunId:"langgraph-fixture-1",contextVersion:"synthetic-catalog-v1",
      responseFingerprint:"a".repeat(64),
      model:{provider_key:"synthetic",model_key:"offline",config_version:"v1"}
    });
    reviewId=p.id;bindingSha=p.binding_sha256;
    expect(await review.decideCandidateReview({
      id:reviewId,organizationId,actorId:ADMIN_A,
      decision:"approved",expectedBindingSha256:bindingSha
    })).toBeNull();
    expect(await review.decideCandidateReview({
      id:reviewId,organizationId:BAD_ORG,actorId:ADMIN_B,
      decision:"approved",expectedBindingSha256:bindingSha
    })).toBeNull();
    const approved=await review.decideCandidateReview({
      id:reviewId,organizationId,actorId:ADMIN_B,
      decision:"approved",expectedBindingSha256:bindingSha
    });
    expect(approved?.status).toBe("approved");
  });

  it("rejects unapproved hash, wrong tenant, unauthorized principal and replay",async()=>{
    const base={reviewId,organizationId,actorId:ADMIN_B,expectedBindingSha256:bindingSha};
    expect(await intent.requestExecuteApprovedIntent({
      ...base,actorId:FOREIGN
    })).toBeNull();
    expect(await intent.requestExecuteApprovedIntent({
      ...base,organizationId:BAD_ORG
    })).toBeNull();
    expect(await intent.requestExecuteApprovedIntent({
      ...base,expectedBindingSha256:"0".repeat(64)
    })).toBeNull();
    const received=await intent.requestExecuteApprovedIntent(base);
    expect(received).toMatchObject({
      review_id:reviewId,state:"pending_authorization",
      real_sql_executed:false,execution_authorized:false
    });
    executionRequestId=received!.request_id;
    expect(await intent.requestExecuteApprovedIntent(base)).toBeNull();
    const row=await db.query<{
      state:string;count:string;execution_status:string;sql_executed:string|null;
    }>([
      "SELECT i.state,",
      "(SELECT count(*)::text FROM public.ai_agent_candidate_execution_requests) count,",
      "r.execution_status,r.sql_executed",
      "FROM public.ai_agent_candidate_execution_requests i",
      "JOIN public.ai_agent_candidate_sql_reviews p ON p.id=i.review_id",
      "JOIN public.ai_agent_runs r ON r.id=p.agent_run_id",
      "WHERE i.id=$1::uuid"
    ].join(" "),[received!.request_id]);
    expect(row.rows[0]).toEqual({
      state:"pending_authorization",count:"1",
      execution_status:"generated",sql_executed:null
    });
    await expect(db.query(
      "UPDATE public.ai_agent_candidate_execution_requests " +
      "SET state='pending_authorization' WHERE id=$1::uuid",
      [received!.request_id]
    )).rejects.toThrow("candidate_execution_request_immutable");
  });

  it("records exactly one tenant-approved Shadow witness without running SQL",async()=>{
    expect(await shadow.claimShadowWitness({
      requestId:executionRequestId,organizationId,actorId:FOREIGN
    })).toBeNull();
    expect(await shadow.claimShadowWitness({
      requestId:executionRequestId,organizationId:BAD_ORG,actorId:ADMIN_B
    })).toBeNull();
    const claim=await shadow.claimShadowWitness({
      requestId:executionRequestId,organizationId,actorId:ADMIN_B
    });
    expect(claim).toMatchObject({
      agentRunId:RUN_ID,
      executionRequestId,
      organizationId,
      bindingSha256:bindingSha,
      approvedSql:candidateSql
    });
    expect(await shadow.claimShadowWitness({
      requestId:executionRequestId,organizationId,actorId:ADMIN_B
    })).toBeNull();
    expect(await shadow.completeShadowWitness({
      witnessId:claim!.witnessId,organizationId,status:"success",
      runId:"lg-shadow-synthetic",fingerprint:"a".repeat(64),
      requiresReapproval:false,securityStatus:"approved",
      contractStatus:"approved",preflightStatus:"approved"
    })).toBe(true);
    expect(await shadow.completeShadowWitness({
      witnessId:claim!.witnessId,organizationId,status:"rejected",
      runId:"lg-replay-synthetic",fingerprint:"b".repeat(64),
      requiresReapproval:true,securityStatus:"rejected",
      contractStatus:"rejected",preflightStatus:"rejected"
    })).toBe(false);
    await expect(db.query(
      "DELETE FROM public.ai_agent_candidate_shadow_witnesses WHERE id=$1::uuid",
      [claim!.witnessId]
    )).rejects.toThrow("candidate_witness_delete_forbidden");
    const state=await db.query<{
      status:string;count:string;sql_executed:string|null;
    }>([
      "SELECT w.status,",
      "(SELECT count(*)::text FROM public.ai_agent_candidate_shadow_witnesses) count,",
      "r.sql_executed FROM public.ai_agent_candidate_shadow_witnesses w",
      "JOIN public.ai_agent_runs r ON r.id=w.agent_run_id",
      "WHERE w.id=$1::uuid"
    ].join(" "),[claim!.witnessId]);
    expect(state.rows[0]).toEqual({
      status:"success",count:"1",sql_executed:null
    });
    const persistedProgress=await shadow.getCandidateReviewProgress({
      reviewId,organizationId,actorId:ADMIN_B
    });
    expect(persistedProgress).toMatchObject({
      request_id:executionRequestId,
      state:"pending_authorization",
      witness_status:"success",
      requires_reapproval:false,
      preflight_status:"approved",
      langgraph_run_id:"lg-shadow-synthetic"
    });
    expect(JSON.stringify(persistedProgress)).not.toContain(candidateSql);
    expect(await shadow.getCandidateReviewProgress({
      reviewId,organizationId:BAD_ORG,actorId:ADMIN_B
    })).toBeNull();
    expect(await shadow.getCandidateReviewProgress({
      reviewId,organizationId,actorId:FOREIGN
    })).toBeNull();
    for(const role of ["anon","authenticated","service_role"]){
      const rights=await db.query<{read:boolean;write:boolean}>(
        "SELECT has_table_privilege($1,'public.ai_agent_candidate_shadow_witnesses','SELECT') read,"+
        " has_table_privilege($1,'public.ai_agent_candidate_shadow_witnesses','INSERT') write",
        [role]
      );
      expect(rights.rows[0]).toEqual({read:false,write:false});
    }
  });

  it("does not expose a future execution request to Data API roles",async()=>{
    for(const role of ["anon","authenticated","service_role"]){
      const x=await db.query<{read:boolean;insert:boolean}>(
        "SELECT has_table_privilege($1,'public.ai_agent_candidate_execution_requests','SELECT') read," +
        " has_table_privilege($1,'public.ai_agent_candidate_execution_requests','INSERT') insert",
        [role]
      );
      expect(x.rows[0]).toEqual({read:false,insert:false});
    }
  });
});
