import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));

import { db } from "@/lib/db";
import {
  assessTenantSchemaCatalog,
  inspectTenantSchemaReadiness
} from "@/lib/tenant-schema-readiness";

type Column = { table_name: string; column_name: string; type_name: string; nullable: boolean; has_default: boolean };
type Constraint = { table_name: string; constraint_type: string; column_names: string[]; target_table: string | null; target_schema: string | null; target_column_names: string[]; validated: boolean };
type Index = { table_name: string; index_name: string; column_names: string[]; valid: boolean; ready: boolean; partial: boolean; predicate_sql: string | null };

const legacy: Column[] = ([
  ["ai_agent_users","id","uuid"],["ai_agent_users","is_active","bool"],
  ["ai_agent_sessions","id","uuid"],["ai_agent_sessions","user_id","uuid"],
  ["ai_agent_sessions","session_token_hash","text"],["ai_agent_sessions","expires_at","timestamptz"],
  ["ai_agent_runs","id","uuid"],["ai_agent_runs","user_id","uuid"],
  ["ai_agent_runs","created_at","timestamptz"]
] as const).map(([table_name,column_name,type_name]) => ({table_name,column_name,type_name,nullable:false,has_default:false}));

const tenant: Column[] = ([
  ["ai_agent_organizations","id","uuid"],["ai_agent_organizations","is_active","bool"],
  ["ai_agent_user_organizations","user_id","uuid"],["ai_agent_user_organizations","organization_id","uuid"],
  ["ai_agent_user_organizations","is_active","bool"],["ai_agent_sessions","organization_id","uuid"],
  ["ai_agent_runs","organization_id","uuid"]
] as const).map(([table_name,column_name,type_name]) => ({table_name,column_name,type_name,nullable:true,has_default:false}));

const pk = (table_name: string, column_names: string[]): Constraint =>
  ({table_name, constraint_type:"p",column_names,target_table:null,target_schema:null,target_column_names:[],validated:true});
const fk = (table_name:string,column_names:string[],target_table:string):Constraint =>
  ({table_name,constraint_type:"f",column_names,target_table,target_schema:"public",target_column_names:["id"],validated:true});

const constraints:Constraint[] = [
  pk("ai_agent_user_organizations",["user_id","organization_id"]),
  fk("ai_agent_user_organizations",["user_id"],"ai_agent_users"),
  fk("ai_agent_user_organizations",["organization_id"],"ai_agent_organizations"),
  fk("ai_agent_sessions",["organization_id"],"ai_agent_organizations"),
  fk("ai_agent_runs",["organization_id"],"ai_agent_organizations")
];
const indexes:Index[] = ([
  ["ai_agent_user_organizations","idx_ai_agent_user_organizations_active_user",["user_id","organization_id"]],
  ["ai_agent_sessions","idx_ai_agent_sessions_organization",["organization_id"]],
  ["ai_agent_runs","idx_ai_agent_runs_organization_created_at",["organization_id","created_at"]]
] as const).map(([table_name,index_name,column_names]) => ({table_name,index_name,column_names:[...column_names],valid:true,ready:true,partial:true,
  predicate_sql:table_name==="ai_agent_user_organizations"?"is_active = true":"organization_id IS NOT NULL"}));

describe("read-only live tenant schema readiness", () => {
  it("distinguishes an unmigrated legacy database", () => {
    const result=assessTenantSchemaCatalog(legacy,[],[]);
    expect(result.status).toBe("migration_pending");
    expect(result.blockers).toEqual(["tenant_migration_not_applied"]);
    expect(result.activation_authorized).toBe(false);
  });
  it("rejects incompatible legacy structure without implying a migration will fix it", () => {
    const result=assessTenantSchemaCatalog([],[],[]);
    expect(result.status).toBe("legacy_incompatible");
  });
  it("rejects a partially applied or incorrectly constrained tenant schema", () => {
    const result=assessTenantSchemaCatalog([...legacy,...tenant],constraints.slice(1),indexes);
    expect(result.status).toBe("migration_incomplete");
    expect(result.blockers).toContain("tenant_relationships_missing");
  });
  it("rejects schema that forces historical rows to have a tenant", () => {
    const incompatible=tenant.map(c=>c.table_name==="ai_agent_runs" && c.column_name==="organization_id" ? {...c,nullable:false} : c);
    const result=assessTenantSchemaCatalog([...legacy,...incompatible],constraints,indexes);
    expect(result.status).toBe("migration_incomplete");
    expect(result.blockers).toContain("historical_records_schema_incompatible");
  });
  it("requires effective partial indexes and fully validated foreign keys", () => {
    const missingIndex=indexes.map((idx,i)=>i===1?{...idx,partial:false}:idx);
    expect(assessTenantSchemaCatalog([...legacy,...tenant],constraints,missingIndex).status).toBe("migration_incomplete");
    const invalidFk=constraints.map((c,i)=>i===2?{...c,validated:false}:c);
    expect(assessTenantSchemaCatalog([...legacy,...tenant],invalidFk,indexes).status).toBe("migration_incomplete");
  });
  it("refuses a partial index that filters different rows from the migration", () => {
    const wrongPredicate=indexes.map((idx,i)=>i===2?{...idx,predicate_sql:"organization_id IS NULL"}:idx);
    const result=assessTenantSchemaCatalog([...legacy,...tenant],constraints,wrongPredicate);
    expect(result.status).toBe("migration_incomplete");
    expect(result.blockers).toContain("tenant_indexes_missing");
  });
  it("recognizes matching structure but never authorizes activation", () => {
    const result=assessTenantSchemaCatalog([...legacy,...tenant],constraints,indexes);
    expect(result.status).toBe("structurally_present");
    expect(result.tenant_structure_present).toBe(true);
    expect(result.activation_authorized).toBe(false);
    expect(result.records_read).toBe(false);
  });
  it("queries only PostgreSQL catalog SELECTs and redacts database errors", async () => {
    const query=vi.mocked(db.query);
    query.mockReset();
    query.mockResolvedValueOnce({rows:[...legacy,...tenant]} as never);
    query.mockResolvedValueOnce({rows:constraints} as never);
    query.mockResolvedValueOnce({rows:indexes} as never);
    const result=await inspectTenantSchemaReadiness();
    expect(result.status).toBe("structurally_present");
    expect(query).toHaveBeenCalledTimes(3);
    for(const call of query.mock.calls){
      const sql=String(call[0]);
      expect(sql.trimStart().startsWith("SELECT")).toBe(true);
      expect(sql).toContain("pg_catalog");
      expect(sql).not.toMatch(/\bFROM\s+public\./i);
    }
    query.mockReset();
    query.mockRejectedValue(new Error("postgres://secret:password@internal/db"));
    expect(await inspectTenantSchemaReadiness()).toMatchObject({
      status:"unavailable",blockers:["catalog_read_unavailable"],activation_authorized:false
    });
  });
});
