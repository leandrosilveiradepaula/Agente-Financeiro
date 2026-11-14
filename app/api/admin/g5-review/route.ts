import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server-auth";
import {
  getG5ReviewStatus, getG5ReviewItem, submitG5ReviewDecision,
  isG5ReviewEnabled,
  type G5ReviewKind, type G5ReviewDecision
} from "@/lib/g5-owner-review-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SAFE_SHA = /^[a-f0-9]{64}$/;
const EXTRA_HEADERS = {
  "Cache-Control": "no-store, private, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

function response(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: EXTRA_HEADERS });
}
function forbidden() {
  return response({ success: false, error: "forbidden" }, 403);
}
function unavailable() {
  return response({ success: false, error: "review_unavailable" }, 503);
}
function isPinnedG5Owner(userId: string): boolean {
  const expected = process.env.G5_OWNER_REVIEW_ALLOWED_USER_ID;
  const tenant = process.env.G5_OWNER_REVIEW_TENANT_ID;
  return Boolean(
    expected && tenant && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(expected)
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(tenant)
    && userId === expected
  );
}
function safeIndex(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,5})$/.test(value)) return null;
  const index = Number(value);
  return Number.isSafeInteger(index) && index <= 100_000 ? index : null;
}
function safeKind(value: unknown): G5ReviewKind | null {
  return value === "financial" || value === "physical" ? value : null;
}
function safeDecision(kind: G5ReviewKind, value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (kind === "financial") {
    if (Object.keys(item).sort().join(",") !== "classification,destinations") return null;
    if (!["UNRESOLVED", "STRUCTURAL", "FORBIDDEN"].includes(String(item.classification))) return null;
    if (!Array.isArray(item.destinations) || item.destinations.length > 24) return null;
    if (!item.destinations.every((v) =>
      v && typeof v === "object" && !Array.isArray(v) &&
      Object.keys(v).sort().join(",") === "collection,index" &&
      typeof v.collection === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(v.collection) &&
      Number.isInteger(v.index) && v.index >= 0 && v.index <= 100_000
    )) return null;
  } else {
    if (Object.keys(item).sort().join(",") !== "qualified_table,review_rationale,target_column") return null;
    if (item.qualified_table !== null && (
      typeof item.qualified_table !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,62}\.[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(item.qualified_table)
    )) return null;
    if (item.target_column !== null && (
      typeof item.target_column !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(item.target_column)
    )) return null;
    if (item.review_rationale !== null && (
      typeof item.review_rationale !== "string" ||
      item.review_rationale.length > 4096
    )) return null;
  }
  return item;
}

function resolveBackendResult(result: Awaited<ReturnType<typeof getG5ReviewStatus>>) {
  if (result.status === "ok") return response({ success: true, review: result.data }, 200);
  if (result.status === "rejected") return response({ success: false, error: "review_conflict" }, 409);
  return unavailable();
}

export async function GET(request: Request) {
  const { session, response: authResponse } = await requireAdminSession();
  if (authResponse || !session) return authResponse ?? forbidden();
  if (!isG5ReviewEnabled()) return unavailable();
  if (!isPinnedG5Owner(session.userId)) return forbidden();
  const url = new URL(request.url);
  const kinds = url.searchParams.getAll("kind");
  const indexes = url.searchParams.getAll("index");
  if (!kinds.length && !indexes.length && [...url.searchParams.keys()].length === 0) {
    return resolveBackendResult(await getG5ReviewStatus(session.userId));
  }
  if (kinds.length !== 1 || indexes.length !== 1 ||
      [...url.searchParams.keys()].some((key) => !["kind", "index"].includes(key))) {
    return response({ success: false, error: "invalid_selector" }, 400);
  }
  const kind = safeKind(kinds[0]);
  const index = safeIndex(indexes[0]);
  if (!kind || index === null) return response({ success: false, error: "invalid_selector" }, 400);
  return resolveBackendResult(await getG5ReviewItem(session.userId, { kind, index }));
}

export async function POST(request: Request) {
  const { session, response: authResponse } = await requireAdminSession();
  if (authResponse || !session) return authResponse ?? forbidden();
  if (!isG5ReviewEnabled()) return unavailable();
  if (!isPinnedG5Owner(session.userId)) return forbidden();
  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.G5_OWNER_REVIEW_WEB_ORIGIN;
  const site = request.headers.get("sec-fetch-site");
  if (!expectedOrigin || origin !== expectedOrigin || (site && site !== "same-origin")) {
    return forbidden();
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response({ success: false, error: "content_type_invalid" }, 415);
  }
  if (Number(request.headers.get("content-length") ?? "0") > 8192) {
    return response({ success: false, error: "request_too_large" }, 413);
  }
  let payload: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 8192) {
      return response({ success: false, error: "request_too_large" }, 413);
    }
    payload = JSON.parse(text);
  } catch {
    return response({ success: false, error: "body_invalid" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return response({ success: false, error: "body_invalid" }, 400);
  }
  const fields = payload as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== "decision,expected_revision,index,kind") {
    return response({ success: false, error: "body_invalid" }, 400);
  }
  const kind = safeKind(fields.kind);
  const index = safeIndex(String(fields.index));
  const expectedRevision = fields.expected_revision;
  if (!kind || index === null || typeof expectedRevision !== "string" ||
      !SAFE_SHA.test(expectedRevision)) {
    return response({ success: false, error: "body_invalid" }, 400);
  }
  const decision = safeDecision(kind, fields.decision);
  if (!decision) return response({ success: false, error: "decision_invalid" }, 400);
  const body: G5ReviewDecision = { kind, index, expected_revision: expectedRevision, decision };
  return resolveBackendResult(await submitG5ReviewDecision(session.userId, body));
}
