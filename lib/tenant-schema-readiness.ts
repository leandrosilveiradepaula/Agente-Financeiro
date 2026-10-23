import "server-only";

import { db } from "@/lib/db";

// Platform identity tables only. No financial schema, business SQL or customer
// mapping is embedded here. This deliberately never reads application rows.
type ColumnFact = {
  table_name: string;
  column_name: string;
  type_name: string;
  nullable: boolean;
  has_default: boolean;
};

type ConstraintFact = {
  table_name: string;
  constraint_type: string;
  target_table: string | null;
  target_schema: string | null;
  column_names: string[];
  target_column_names: string[];
  validated: boolean;
};

type IndexFact = {
  table_name: string;
  index_name: string;
  column_names: string[];
  valid: boolean;
  ready: boolean;
  partial: boolean;
};

type ExpectedColumn = readonly [string, string, string];
type ExpectedIndex = readonly [string, string, readonly string[]];

const LEGACY_COLUMNS: readonly ExpectedColumn[] = [
  ["ai_agent_users", "id", "uuid"],
  ["ai_agent_users", "is_active", "bool"],
  ["ai_agent_sessions", "id", "uuid"],
  ["ai_agent_sessions", "user_id", "uuid"],
  ["ai_agent_sessions", "session_token_hash", "text"],
  ["ai_agent_sessions", "expires_at", "timestamptz"],
  ["ai_agent_runs", "id", "uuid"],
  ["ai_agent_runs", "user_id", "uuid"],
  ["ai_agent_runs", "created_at", "timestamptz"]
];

const TENANT_COLUMNS: readonly ExpectedColumn[] = [
  ["ai_agent_organizations", "id", "uuid"],
  ["ai_agent_organizations", "is_active", "bool"],
  ["ai_agent_user_organizations", "user_id", "uuid"],
  ["ai_agent_user_organizations", "organization_id", "uuid"],
  ["ai_agent_user_organizations", "is_active", "bool"],
  ["ai_agent_sessions", "organization_id", "uuid"],
  ["ai_agent_runs", "organization_id", "uuid"]
];

const TENANT_INDEXES: readonly ExpectedIndex[] = [
  ["ai_agent_user_organizations", "idx_ai_agent_user_organizations_active_user", ["user_id", "organization_id"]],
  ["ai_agent_sessions", "idx_ai_agent_sessions_organization", ["organization_id"]],
  ["ai_agent_runs", "idx_ai_agent_runs_organization_created_at", ["organization_id", "created_at"]]
];

const TABLES = Array.from(
  new Set([...LEGACY_COLUMNS, ...TENANT_COLUMNS].map(([table]) => table))
);

const COLUMNS_SQL = `
  SELECT c.relname::text AS table_name,
         a.attname::text AS column_name,
         t.typname::text AS type_name,
         NOT a.attnotnull AS nullable,
         a.atthasdef AS has_default
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname = ANY($1::text[])
    AND a.attnum > 0 AND NOT a.attisdropped
`;

const CONSTRAINTS_SQL = `
  SELECT source.relname::text AS table_name,
         c.contype::text AS constraint_type,
         target.relname::text AS target_table,
         target_ns.nspname::text AS target_schema,
         ARRAY(
           SELECT a.attname::text
           FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_catalog.pg_attribute a
             ON a.attrelid = source.oid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS column_names,
         ARRAY(
           SELECT a.attname::text
           FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_catalog.pg_attribute a
             ON a.attrelid = target.oid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS target_column_names,
         c.convalidated AS validated
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class source ON source.oid = c.conrelid
  JOIN pg_catalog.pg_namespace source_ns ON source_ns.oid = source.relnamespace
  LEFT JOIN pg_catalog.pg_class target ON target.oid = c.confrelid
  LEFT JOIN pg_catalog.pg_namespace target_ns ON target_ns.oid = target.relnamespace
  WHERE source_ns.nspname = 'public'
    AND source.relname = ANY($1::text[])
    AND c.contype IN ('f', 'p')
`;

const INDEXES_SQL = `
  SELECT t.relname::text AS table_name,
         ix.relname::text AS index_name,
         i.indisvalid AS valid,
         i.indisready AS ready,
         i.indpred IS NOT NULL AS partial,
         ARRAY(
           SELECT a.attname::text
           FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_catalog.pg_attribute a
             ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE k.ord <= i.indnkeyatts
           ORDER BY k.ord
         ) AS column_names
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_catalog.pg_class ix ON ix.oid = i.indexrelid
  WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])
`;

export type TenantSchemaReadiness = {
  status: "legacy_incompatible" | "migration_pending" | "migration_incomplete" |
    "structurally_present" | "unavailable";
  legacy_compatible: boolean;
  tenant_structure_present: boolean;
  checks: {
    legacy_columns: boolean;
    tenant_columns: boolean;
    tenant_relationships: boolean;
    tenant_indexes: boolean;
    nullable_unassigned_runs_and_sessions: boolean;
  };
  blockers: string[];
  // Checking metadata is not evidence of migrations applied, tenant data
  // assignments, RLS, source isolation or permission to activate.
  records_read: false;
  activation_authorized: false;
};

const EMPTY_CHECKS: TenantSchemaReadiness["checks"] = {
  legacy_columns: false,
  tenant_columns: false,
  tenant_relationships: false,
  tenant_indexes: false,
  nullable_unassigned_runs_and_sessions: false
};

export function assessTenantSchemaCatalog(
  columns: ColumnFact[],
  constraints: ConstraintFact[],
  indexes: IndexFact[]
): TenantSchemaReadiness {
  const lookup = new Map(columns.map((item) => [
    item.table_name + "." + item.column_name, item
  ]));
  const matches = ([table, name, type]: ExpectedColumn) =>
    lookup.get(table + "." + name)?.type_name === type;

  const legacyColumns = LEGACY_COLUMNS.every(matches);
  const tenantColumns = TENANT_COLUMNS.every(matches);
  const tenantColumnMatches = TENANT_COLUMNS.filter(matches).length;
  const optionalLinks = ["ai_agent_sessions", "ai_agent_runs"].every((table) => {
    const column = lookup.get(table + ".organization_id");
    return column?.type_name === "uuid" &&
      column.nullable === true && column.has_default === false;
  });

  const hasConstraint = (
    table: string, type: string, names: string[],
    target?: string, targetColumns?: string[]
  ) => constraints.some((c) =>
    c.table_name === table && c.constraint_type === type &&
    c.validated === true &&
    c.column_names.join(",") === names.join(",") &&
    (target === undefined ||
      (c.target_table === target && c.target_schema === "public" &&
        c.target_column_names.join(",") === (targetColumns ?? []).join(",")))
  );

  const relationships =
    hasConstraint("ai_agent_user_organizations", "p", ["user_id", "organization_id"]) &&
    hasConstraint("ai_agent_user_organizations", "f", ["user_id"], "ai_agent_users", ["id"]) &&
    hasConstraint("ai_agent_user_organizations", "f", ["organization_id"], "ai_agent_organizations", ["id"]) &&
    hasConstraint("ai_agent_sessions", "f", ["organization_id"], "ai_agent_organizations", ["id"]) &&
    hasConstraint("ai_agent_runs", "f", ["organization_id"], "ai_agent_organizations", ["id"]);

  const tenantIndexes = TENANT_INDEXES.every(([table, index, expectedColumns]) =>
    indexes.some((actual) =>
      actual.table_name === table && actual.index_name === index &&
      actual.valid === true && actual.ready === true &&
      actual.partial === true &&
      actual.column_names.join(",") === expectedColumns.join(","))
  );

  const checks = {
    legacy_columns: legacyColumns,
    tenant_columns: tenantColumns,
    tenant_relationships: relationships,
    tenant_indexes: tenantIndexes,
    nullable_unassigned_runs_and_sessions: optionalLinks
  };

  const fullyPresent = Object.values(checks).every(Boolean);
  const tenantTouched = tenantColumnMatches > 0 ||
    constraints.some((c) => c.table_name === "ai_agent_user_organizations") ||
    indexes.some((i) => TENANT_INDEXES.some(([, name]) => i.index_name === name));

  const status: TenantSchemaReadiness["status"] = !legacyColumns
    ? "legacy_incompatible"
    : fullyPresent
      ? "structurally_present"
      : tenantTouched
        ? "migration_incomplete"
        : "migration_pending";

  const blockers = !legacyColumns ? ["legacy_schema_incompatible"]
    : status === "migration_pending" ? ["tenant_migration_not_applied"]
    : status === "migration_incomplete"
      ? [
          ...(!tenantColumns ? ["tenant_columns_missing_or_incompatible"] : []),
          ...(!relationships ? ["tenant_relationships_missing"] : []),
          ...(!tenantIndexes ? ["tenant_indexes_missing"] : []),
          ...(!optionalLinks ? ["historical_records_schema_incompatible"] : [])
        ]
      : [];

  return {
    status,
    legacy_compatible: legacyColumns,
    tenant_structure_present: fullyPresent,
    checks,
    blockers,
    records_read: false,
    activation_authorized: false
  };
}

export async function inspectTenantSchemaReadiness(): Promise<TenantSchemaReadiness> {
  try {
    // All three statements are catalog-only SELECTs. No business table SELECT,
    // transaction mutation, migration, network probe or financial SQL.
    const [columns, constraints, indexes] = await Promise.all([
      db.query<ColumnFact>(COLUMNS_SQL, [TABLES]),
      db.query<ConstraintFact>(CONSTRAINTS_SQL, [TABLES]),
      db.query<IndexFact>(INDEXES_SQL, [TABLES])
    ]);
    return assessTenantSchemaCatalog(
      columns.rows, constraints.rows, indexes.rows
    );
  } catch {
    // Never expose connection strings, PostgreSQL diagnostics or schema
    // identifiers from the runtime; metadata failures fail closed.
    return {
      status: "unavailable",
      legacy_compatible: false,
      tenant_structure_present: false,
      checks: { ...EMPTY_CHECKS },
      blockers: ["catalog_read_unavailable"],
      records_read: false,
      activation_authorized: false
    };
  }
}
