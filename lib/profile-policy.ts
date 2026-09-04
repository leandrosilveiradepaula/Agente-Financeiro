import "server-only";
import { db } from "@/lib/db";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const SENSITIVE_KEYS = new Set([
  "authorization",
  "bearer",
  "cookie",
  "password",
  "password_hash",
  "secret",
  "session_token_hash",
  "token",
  "x-agent-internal-token"
]);

export type ProfilePolicyRow = {
  id: string;
  created_at: string;
  updated_at: string;
  profile: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  can_generate_sql: boolean;
  can_execute_sql: boolean;
  can_view_sql: boolean;
  can_view_own_runs: boolean;
  can_view_all_runs: boolean;
  can_manage_users: boolean;
  can_view_admin_area: boolean;
  allowed_intents: unknown;
  denied_intents: unknown;
  allowed_tables: unknown;
  denied_tables: unknown;
  allowed_columns: unknown;
  denied_columns: unknown;
  required_filters: unknown;
  max_rows: number | null;
  max_execution_time_ms: number | null;
  metadata: unknown;
};

export type SanitizedProfilePolicy = Omit<
  ProfilePolicyRow,
  | "allowed_intents"
  | "denied_intents"
  | "allowed_tables"
  | "denied_tables"
  | "allowed_columns"
  | "denied_columns"
  | "required_filters"
  | "metadata"
> & {
  allowed_intents: string[];
  denied_intents: string[];
  allowed_tables: string[];
  denied_tables: string[];
  allowed_columns: JsonValue;
  denied_columns: JsonValue;
  required_filters: JsonValue;
  metadata: JsonValue;
};

export type PublicProfilePolicy = Pick<
  SanitizedProfilePolicy,
  | "profile"
  | "display_name"
  | "can_generate_sql"
  | "can_execute_sql"
  | "can_view_sql"
  | "can_view_own_runs"
  | "can_view_all_runs"
  | "can_manage_users"
  | "can_view_admin_area"
  | "max_rows"
  | "max_execution_time_ms"
>;

export type ProfilePolicyUpdateInput = Partial<{
  display_name: string;
  description: string | null;
  is_active: boolean;
  can_generate_sql: boolean;
  can_execute_sql: boolean;
  can_view_sql: boolean;
  can_view_own_runs: boolean;
  can_view_all_runs: boolean;
  can_manage_users: boolean;
  can_view_admin_area: boolean;
  allowed_intents: string[];
  denied_intents: string[];
  allowed_tables: string[];
  denied_tables: string[];
  allowed_columns: Record<string, unknown>;
  denied_columns: Record<string, unknown>;
  required_filters: Record<string, unknown>;
  max_rows: number | null;
  max_execution_time_ms: number | null;
  metadata: Record<string, unknown>;
}>;

function sanitizeJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }

  if (typeof value === "object") {
    const sanitized: { [key: string]: JsonValue } = {};

    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      sanitized[key] = sanitizeJsonValue(nestedValue);
    }

    return sanitized;
  }

  return String(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeStringArray(value: unknown, options?: { lowercase?: boolean }) {
  if (!Array.isArray(value)) return null;

  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .map((item) => (options?.lowercase && item !== "*" ? item.toLowerCase() : item));

  return Array.from(new Set(normalized));
}

export function parsePolicyTextList(text: string, options?: { lowercase?: boolean }) {
  return normalizeStringArray(text.split(/\r?\n/), options) ?? [];
}

export function sanitizeProfilePolicy(policy: ProfilePolicyRow): SanitizedProfilePolicy {
  return {
    id: policy.id,
    created_at: policy.created_at,
    updated_at: policy.updated_at,
    profile: policy.profile,
    display_name: policy.display_name,
    description: policy.description,
    is_active: policy.is_active,
    can_generate_sql: policy.can_generate_sql,
    can_execute_sql: policy.can_execute_sql,
    can_view_sql: policy.can_view_sql,
    can_view_own_runs: policy.can_view_own_runs,
    can_view_all_runs: policy.can_view_all_runs,
    can_manage_users: policy.can_manage_users,
    can_view_admin_area: policy.can_view_admin_area,
    allowed_intents: toStringArray(policy.allowed_intents),
    denied_intents: toStringArray(policy.denied_intents),
    allowed_tables: toStringArray(policy.allowed_tables),
    denied_tables: toStringArray(policy.denied_tables),
    allowed_columns: sanitizeJsonValue(policy.allowed_columns),
    denied_columns: sanitizeJsonValue(policy.denied_columns),
    required_filters: sanitizeJsonValue(policy.required_filters),
    max_rows: policy.max_rows,
    max_execution_time_ms: policy.max_execution_time_ms,
    metadata: sanitizeJsonValue(policy.metadata)
  };
}

export function sanitizeProfilePolicyCapabilities(
  policy: SanitizedProfilePolicy
): PublicProfilePolicy {
  return {
    profile: policy.profile,
    display_name: policy.display_name,
    can_generate_sql: policy.can_generate_sql,
    can_execute_sql: policy.can_execute_sql,
    can_view_sql: policy.can_view_sql,
    can_view_own_runs: policy.can_view_own_runs,
    can_view_all_runs: policy.can_view_all_runs,
    can_manage_users: policy.can_manage_users,
    can_view_admin_area: policy.can_view_admin_area,
    max_rows: policy.max_rows,
    max_execution_time_ms: policy.max_execution_time_ms
  };
}

export async function getProfilePolicy(profile: string) {
  const result = await db.query<ProfilePolicyRow>(
    `
    SELECT *
    FROM public.ai_agent_profile_policies
    WHERE profile = $1
      AND is_active = true
    LIMIT 1
    `,
    [profile]
  );

  const policy = result.rows[0];
  return policy ? sanitizeProfilePolicy(policy) : null;
}

export async function getProfilePolicyForAdmin(profile: string) {
  const result = await db.query<ProfilePolicyRow>(
    `
    SELECT *
    FROM public.ai_agent_profile_policies
    WHERE profile = $1
    LIMIT 1
    `,
    [profile]
  );

  const policy = result.rows[0];
  return policy ? sanitizeProfilePolicy(policy) : null;
}

export async function listProfilePolicies() {
  const result = await db.query<ProfilePolicyRow>(
    `
    SELECT *
    FROM public.ai_agent_profile_policies
    ORDER BY profile ASC
    `
  );

  return result.rows.map(sanitizeProfilePolicy);
}

export function sanitizePolicyForAdmin(policy: SanitizedProfilePolicy) {
  return sanitizeProfilePolicy(policy as unknown as ProfilePolicyRow);
}

export const sanitizePolicyForAccount = sanitizeProfilePolicyCapabilities;

export function diffPolicyFields(
  beforePolicy: SanitizedProfilePolicy,
  afterPolicy: SanitizedProfilePolicy
) {
  const diff: Record<string, { before: JsonValue; after: JsonValue }> = {};

  for (const key of Object.keys(afterPolicy) as Array<keyof SanitizedProfilePolicy>) {
    if (["id", "created_at", "updated_at", "profile"].includes(String(key))) continue;

    const beforeValue = beforePolicy[key] as JsonValue;
    const afterValue = afterPolicy[key] as JsonValue;

    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      diff[String(key)] = {
        before: sanitizeJsonValue(beforeValue),
        after: sanitizeJsonValue(afterValue)
      };
    }
  }

  return diff;
}

export function validateProfilePolicyUpdatePayload(
  profile: string,
  body: unknown
): { ok: true; value: ProfilePolicyUpdateInput } | { ok: false; error: string } {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_payload" };
  if ("profile" in body && body.profile !== profile) {
    return { ok: false, error: "invalid_payload" };
  }

  const value: ProfilePolicyUpdateInput = {};
  const booleanFields = [
    "is_active",
    "can_generate_sql",
    "can_execute_sql",
    "can_view_sql",
    "can_view_own_runs",
    "can_view_all_runs",
    "can_manage_users",
    "can_view_admin_area"
  ] as const;

  if ("display_name" in body) {
    if (typeof body.display_name !== "string" || !body.display_name.trim()) {
      return { ok: false, error: "invalid_payload" };
    }
    value.display_name = body.display_name.trim();
  }

  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") {
      return { ok: false, error: "invalid_payload" };
    }
    value.description = typeof body.description === "string" ? body.description.trim() : null;
  }

  for (const field of booleanFields) {
    if (field in body) {
      if (typeof body[field] !== "boolean") return { ok: false, error: "invalid_payload" };
      value[field] = body[field];
    }
  }

  const allowedIntents = "allowed_intents" in body ? normalizeStringArray(body.allowed_intents) : undefined;
  if ("allowed_intents" in body && !allowedIntents) return { ok: false, error: "invalid_allowed_intents" };
  if (allowedIntents) value.allowed_intents = allowedIntents;

  const deniedIntents = "denied_intents" in body ? normalizeStringArray(body.denied_intents) : undefined;
  if ("denied_intents" in body && !deniedIntents) return { ok: false, error: "invalid_denied_intents" };
  if (deniedIntents) value.denied_intents = deniedIntents;

  const allowedTables =
    "allowed_tables" in body ? normalizeStringArray(body.allowed_tables, { lowercase: true }) : undefined;
  if ("allowed_tables" in body && !allowedTables) return { ok: false, error: "invalid_allowed_tables" };
  if (allowedTables) value.allowed_tables = allowedTables;

  const deniedTables =
    "denied_tables" in body ? normalizeStringArray(body.denied_tables, { lowercase: true }) : undefined;
  if ("denied_tables" in body && !deniedTables) return { ok: false, error: "invalid_denied_tables" };
  if (deniedTables) value.denied_tables = deniedTables;

  for (const field of ["allowed_columns", "denied_columns", "required_filters", "metadata"] as const) {
    if (field in body) {
      if (!isPlainObject(body[field])) return { ok: false, error: "invalid_payload" };
      value[field] = body[field];
    }
  }

  for (const field of ["max_rows", "max_execution_time_ms"] as const) {
    if (field in body) {
      if (body[field] === null) {
        value[field] = null;
        continue;
      }

      if (
        typeof body[field] !== "number" ||
        !Number.isInteger(body[field]) ||
        body[field] < 0
      ) {
        return {
          ok: false,
          error: field === "max_rows" ? "invalid_max_rows" : "invalid_max_execution_time_ms"
        };
      }

      value[field] = body[field];
    }
  }

  if (profile === "admin") {
    if (value.is_active === false) return { ok: false, error: "cannot_disable_admin_policy" };

    const adminCoreFields = [
      "can_manage_users",
      "can_view_admin_area",
      "can_view_all_runs",
      "can_generate_sql",
      "can_execute_sql"
    ] as const;

    if (adminCoreFields.some((field) => value[field] === false)) {
      return { ok: false, error: "cannot_remove_admin_core_permissions" };
    }
  }

  return { ok: true, value };
}

export async function updateProfilePolicy(profile: string, input: ProfilePolicyUpdateInput) {
  const result = await db.query<ProfilePolicyRow>(
    `
    UPDATE public.ai_agent_profile_policies
    SET
      display_name = COALESCE($2, display_name),
      description = CASE WHEN $3::boolean THEN $4 ELSE description END,
      is_active = COALESCE($5, is_active),
      can_generate_sql = COALESCE($6, can_generate_sql),
      can_execute_sql = COALESCE($7, can_execute_sql),
      can_view_sql = COALESCE($8, can_view_sql),
      can_view_own_runs = COALESCE($9, can_view_own_runs),
      can_view_all_runs = COALESCE($10, can_view_all_runs),
      can_manage_users = COALESCE($11, can_manage_users),
      can_view_admin_area = COALESCE($12, can_view_admin_area),
      allowed_intents = CASE WHEN $13::boolean THEN $14::jsonb ELSE allowed_intents END,
      denied_intents = CASE WHEN $15::boolean THEN $16::jsonb ELSE denied_intents END,
      allowed_tables = CASE WHEN $17::boolean THEN $18::jsonb ELSE allowed_tables END,
      denied_tables = CASE WHEN $19::boolean THEN $20::jsonb ELSE denied_tables END,
      allowed_columns = CASE WHEN $21::boolean THEN $22::jsonb ELSE allowed_columns END,
      denied_columns = CASE WHEN $23::boolean THEN $24::jsonb ELSE denied_columns END,
      required_filters = CASE WHEN $25::boolean THEN $26::jsonb ELSE required_filters END,
      max_rows = CASE WHEN $27::boolean THEN $28 ELSE max_rows END,
      max_execution_time_ms = CASE WHEN $29::boolean THEN $30 ELSE max_execution_time_ms END,
      metadata = CASE WHEN $31::boolean THEN $32::jsonb ELSE metadata END,
      updated_at = now()
    WHERE profile = $1
    RETURNING *
    `,
    [
      profile,
      input.display_name ?? null,
      "description" in input,
      input.description ?? null,
      input.is_active ?? null,
      input.can_generate_sql ?? null,
      input.can_execute_sql ?? null,
      input.can_view_sql ?? null,
      input.can_view_own_runs ?? null,
      input.can_view_all_runs ?? null,
      input.can_manage_users ?? null,
      input.can_view_admin_area ?? null,
      "allowed_intents" in input,
      JSON.stringify(input.allowed_intents ?? []),
      "denied_intents" in input,
      JSON.stringify(input.denied_intents ?? []),
      "allowed_tables" in input,
      JSON.stringify(input.allowed_tables ?? []),
      "denied_tables" in input,
      JSON.stringify(input.denied_tables ?? []),
      "allowed_columns" in input,
      JSON.stringify(sanitizeJsonValue(input.allowed_columns ?? {})),
      "denied_columns" in input,
      JSON.stringify(sanitizeJsonValue(input.denied_columns ?? {})),
      "required_filters" in input,
      JSON.stringify(sanitizeJsonValue(input.required_filters ?? {})),
      "max_rows" in input,
      input.max_rows ?? null,
      "max_execution_time_ms" in input,
      input.max_execution_time_ms ?? null,
      "metadata" in input,
      JSON.stringify(sanitizeJsonValue(input.metadata ?? {}))
    ]
  );

  const policy = result.rows[0];
  return policy ? sanitizeProfilePolicy(policy) : null;
}

export function profileHasWildcard(list: string[]) {
  return list.includes("*");
}

export function isIntentAllowedByPolicy(
  policy: SanitizedProfilePolicy | null,
  intent: string
) {
  if (!policy?.is_active) return false;
  if (profileHasWildcard(policy.denied_intents) || policy.denied_intents.includes(intent)) {
    return false;
  }
  if (profileHasWildcard(policy.allowed_intents)) return true;
  return policy.allowed_intents.includes(intent);
}

export function isTableAllowedByPolicy(
  policy: SanitizedProfilePolicy | null,
  tableName: string
) {
  if (!policy?.is_active) return false;
  if (profileHasWildcard(policy.denied_tables) || policy.denied_tables.includes(tableName)) {
    return false;
  }
  if (profileHasWildcard(policy.allowed_tables)) return true;
  return policy.allowed_tables.includes(tableName);
}

export function extractSqlTableNames(sql: string): string[] {
  const matches = sql.match(/\bdev_lakehouse\.main_gold\.[a-zA-Z0-9_]+\b/g) ?? [];
  return Array.from(new Set(matches.map((tableName) => tableName.toLowerCase())));
}

export function validateSqlTablesForPolicy(
  policy: SanitizedProfilePolicy | null,
  sql: string
) {
  const extractedTables = extractSqlTableNames(sql);
  const blockedTable =
    extractedTables.find((tableName) => !isTableAllowedByPolicy(policy, tableName)) ?? null;

  return {
    allowed: Boolean(policy?.is_active) && !blockedTable,
    blockedTable,
    extractedTables
  };
}

export async function enforceCanGenerateSql(profile: string) {
  const policy = await getProfilePolicy(profile);

  if (!policy) {
    return {
      allowed: false as const,
      policy,
      reason: "profile_policy_not_found"
    };
  }

  if (!policy.can_generate_sql) {
    return {
      allowed: false as const,
      policy,
      reason: "profile_cannot_generate_sql"
    };
  }

  return { allowed: true as const, policy, reason: null };
}

export function enforceIntentPolicy(
  policy: SanitizedProfilePolicy | null,
  intent: string
) {
  if (isIntentAllowedByPolicy(policy, intent)) {
    return { allowed: true as const, reason: null };
  }

  return {
    allowed: false as const,
    reason: "profile_not_allowed_for_intent"
  };
}

export function enforceSqlTablePolicy(
  policy: SanitizedProfilePolicy | null,
  sql: string
) {
  const result = validateSqlTablesForPolicy(policy, sql);

  if (result.allowed) {
    return {
      allowed: true as const,
      reason: null,
      blockedTable: result.blockedTable,
      extractedTables: result.extractedTables
    };
  }

  return {
    allowed: false as const,
    reason: result.extractedTables.length
      ? "profile_not_allowed_for_table"
      : "no_allowed_tables_detected",
    blockedTable: result.blockedTable,
    extractedTables: result.extractedTables
  };
}

export async function enforceCanExecuteSql(profile: string) {
  const policy = await getProfilePolicy(profile);

  if (!policy) {
    return {
      allowed: false as const,
      policy,
      reason: "profile_policy_not_found"
    };
  }

  if (!policy.can_execute_sql) {
    return {
      allowed: false as const,
      policy,
      reason: "profile_cannot_execute_sql"
    };
  }

  return { allowed: true as const, policy, reason: null };
}

export function buildPolicyDeniedResponse(reason: string) {
  const messages: Record<string, string> = {
    profile_policy_not_found: "Seu perfil não possui uma política ativa configurada.",
    profile_cannot_generate_sql: "Seu perfil não possui permissão para gerar consultas SQL.",
    profile_not_allowed_for_intent:
      "Seu perfil não possui permissão para consultar esse tipo de informação.",
    profile_not_allowed_for_table:
      "Seu perfil não possui permissão para consultar uma das tabelas solicitadas.",
    profile_cannot_execute_sql: "Seu perfil não possui permissão para executar consultas SQL.",
    no_allowed_tables_detected:
      "Não foi possível identificar tabelas permitidas na consulta gerada."
  };

  return {
    success: false,
    error: reason,
    message: messages[reason] ?? "Ação bloqueada pela política do perfil."
  };
}

export async function canProfileGenerateSql(profile: string) {
  return Boolean((await getProfilePolicy(profile))?.can_generate_sql);
}

export async function canProfileExecuteSql(profile: string) {
  return Boolean((await getProfilePolicy(profile))?.can_execute_sql);
}

export async function canProfileViewSql(profile: string) {
  return Boolean((await getProfilePolicy(profile))?.can_view_sql);
}

export async function canProfileViewAllRuns(profile: string) {
  return Boolean((await getProfilePolicy(profile))?.can_view_all_runs);
}
