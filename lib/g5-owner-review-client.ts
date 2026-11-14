import "server-only";

export type G5ReviewKind = "financial" | "physical";
export type G5ReviewDecision = {
  kind: G5ReviewKind;
  index: number;
  expected_revision: string;
  decision: Record<string, unknown>;
};
export type G5ReviewResult =
  | { status: "ok"; data: Record<string, unknown> }
  | { status: "disabled" | "unavailable" | "invalid_response" | "rejected" };
type Env = Record<string, string | undefined>;
type Options = { env?: Env; fetchImpl?: typeof fetch };
const MAX_RESPONSE_BYTES = 400_000;
const MAX_REQUEST_BYTES = 8_192;
const REQUEST_TIMEOUT_MS = 12_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_SHA = /^[a-f0-9]{64}$/;

export function isG5ReviewEnabled(env: Env = process.env): boolean {
  return env.G5_OWNER_REVIEW_ENABLED === "true";
}

function serviceConfig(env: Env) {
  if (!isG5ReviewEnabled(env)) return null;
  const token = env.G5_OWNER_REVIEW_INTERNAL_TOKEN ?? "";
  const tenant = env.G5_OWNER_REVIEW_TENANT_ID ?? "";
  const allowedHost = env.G5_OWNER_REVIEW_ALLOWED_HOST ?? "";
  const inputUrl = env.G5_OWNER_REVIEW_INTERNAL_URL ?? "";
  if (token.length < 32 || token.length > 512 || !SAFE_ID.test(tenant) || !inputUrl) return null;
  try {
    const uri = new URL(inputUrl);
    const localTest = env.G5_OWNER_REVIEW_ALLOW_LOCAL_HTTP === "true" &&
      process.env.NODE_ENV !== "production" &&
      ["127.0.0.1", "localhost", "::1"].includes(uri.hostname);
    if (
      (uri.protocol !== "https:" && !(localTest && uri.protocol === "http:")) ||
      uri.username || uri.password || uri.search || uri.hash ||
      uri.pathname !== "/" || !allowedHost ||
      uri.hostname !== allowedHost
    ) return null;
    return { base: uri.origin, token, tenant };
  } catch {
    return null;
  }
}

function fail(status: "disabled" | "unavailable" | "invalid_response" | "rejected"): G5ReviewResult {
  return { status };
}

function validate(value: unknown, kind: "status" | "item" | "decision"): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.accounting_approved !== false || result.status === "approved") return null;
  if (kind === "status") {
    if (result.status !== "unapproved" || !SAFE_SHA.test(String(result.revision)) ||
        !result.counts || typeof result.counts !== "object") return null;
  }
  if (kind === "item") {
    if (result.status !== "unapproved" ||
        !["financial", "physical"].includes(String(result.kind)) ||
        !Number.isInteger(result.index) || !SAFE_SHA.test(String(result.revision)) ||
        !result.source || typeof result.source !== "object" ||
        !result.decision || typeof result.decision !== "object") return null;
  }
  if (kind === "decision") {
    if (result.status !== "draft_saved" || !SAFE_SHA.test(String(result.revision)) ||
        result.context_activated !== false || result.sql_executed !== false) return null;
  }
  return result;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > MAX_RESPONSE_BYTES) throw new Error("response_oversize");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("response_missing");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("response_oversize");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
}

async function callReview(
  kind: "status" | "item" | "decision",
  actorId: string,
  payload: Record<string, unknown> | null,
  options: Options = {}
): Promise<G5ReviewResult> {
  const env = options.env ?? process.env;
  const conf = serviceConfig(env);
  if (!conf || !SAFE_ID.test(actorId)) return fail("disabled");
  const path = "/v1/internal/g5-owner-review/" + kind;
  const params = kind === "item" && payload
    ? "?kind=" + encodeURIComponent(String(payload.kind)) +
      "&index=" + encodeURIComponent(String(payload.index))
    : "";
  const body = kind === "decision" ? JSON.stringify(payload) : undefined;
  if (body && new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) return fail("rejected");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(conf.base + path + params, {
      method: kind === "decision" ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + conf.token,
        "x-g5-product-role": "admin",
        "x-g5-product-tenant": conf.tenant,
        "x-g5-product-actor": actorId,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body } : {}),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    if ([403, 404, 405, 409].includes(response.status)) return fail("rejected");
    if (!response.ok) return fail("unavailable");
    const json = await readBoundedJson(response);
    const valid = validate(json, kind);
    return valid ? { status: "ok", data: valid } : fail("invalid_response");
  } catch {
    return fail("unavailable");
  } finally { clearTimeout(timeout); }
}

export function getG5ReviewStatus(actorId: string, options?: Options): Promise<G5ReviewResult> {
  return callReview("status", actorId, null, options);
}
export function getG5ReviewItem(
  actorId: string,
  input: { kind: G5ReviewKind; index: number },
  options?: Options
): Promise<G5ReviewResult> {
  if (!["financial", "physical"].includes(input.kind) ||
      !Number.isInteger(input.index) || input.index < 0 || input.index > 100_000) {
    return Promise.resolve(fail("rejected"));
  }
  return callReview("item", actorId, input, options);
}
export function submitG5ReviewDecision(
  actorId: string, payload: G5ReviewDecision, options?: Options
): Promise<G5ReviewResult> {
  if (!["financial", "physical"].includes(payload.kind) ||
      !Number.isInteger(payload.index) || payload.index < 0 || payload.index > 100_000 ||
      !SAFE_SHA.test(payload.expected_revision)) {
    return Promise.resolve(fail("rejected"));
  }
  return callReview("decision", actorId, payload as unknown as Record<string, unknown>, options);
}
