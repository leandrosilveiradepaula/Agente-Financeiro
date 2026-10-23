import { beforeEach, describe, expect, it } from "vitest";
import {
  getAuthenticatedHistoryScope,
  sessionHistoryIdentityChanged
} from "@/lib/authenticated-history-scope";
import { readQueryHistory, writeQueryHistory } from "@/lib/history";
import {
  readExecutiveReportHistory,
  writeExecutiveReportHistory
} from "@/lib/executive-report-history";
import type { ExecutiveReportHistoryItem, QueryHistoryItem } from "@/lib/types";

const USER = "33333333-3333-4333-8333-333333333333";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function queryItem(question: string): QueryHistoryItem {
  return {
    id: crypto.randomUUID(),
    pergunta: question,
    sql: "SELECT synthetic_measure",
    agent_version: "synthetic-context-v1",
    detected_intent: "synthetic_metric",
    validation_status: "aprovado",
    created_at: new Date().toISOString(),
    executed_watson: false
  };
}

function report(question: string): ExecutiveReportHistoryItem {
  return {
    id: crypto.randomUUID(),
    question,
    sql: "SELECT synthetic_measure",
    markdown: "# Synthetic test report",
    summary: {
      title: "Synthetic",
      paragraphs: ["Synthetic fixture only"],
      highlights: [],
      warnings: []
    },
    generated_at: new Date().toISOString()
  };
}

describe("authenticated browser history partition", () => {
  beforeEach(() => window.localStorage.clear());

  it("preserves exactly the legacy user storage key when tenant mode is off", () => {
    const legacy = getAuthenticatedHistoryScope({ id: USER });
    expect(legacy).toBe(USER);
    expect(getAuthenticatedHistoryScope({
      id: USER, tenantIdentityEnabled: false, organizationId: A
    })).toBe(USER);
    const item = queryItem("Legacy");
    writeQueryHistory([item], legacy);
    expect(readQueryHistory(USER)).toEqual([item]);
  });

  it("does not read old user-only SQL or reports when tenant mode turns on", () => {
    const legacyQuery = queryItem("Legacy A data");
    const legacyReport = report("Legacy sensitive report");
    writeQueryHistory([legacyQuery], USER);
    writeExecutiveReportHistory([legacyReport], USER);
    const ownerA = getAuthenticatedHistoryScope({
      id: USER, tenantIdentityEnabled: true, organizationId: A
    });
    expect(ownerA).not.toBe(USER);
    expect(readQueryHistory(ownerA)).toEqual([]);
    expect(readExecutiveReportHistory(ownerA)).toEqual([]);
    // Legacy data still exists for rollback, but is never migrated or
    // read as an organization-specific record.
    expect(readQueryHistory(USER)).toEqual([legacyQuery]);
    expect(readExecutiveReportHistory(USER)).toEqual([legacyReport]);
  });

  it("keeps local financial SQL and executive reports in separate organization stores", () => {
    const keyA = getAuthenticatedHistoryScope({
      id: USER, tenantIdentityEnabled: true, organizationId: A
    });
    const keyB = getAuthenticatedHistoryScope({
      id: USER, tenantIdentityEnabled: true, organizationId: B
    });
    const queryA = queryItem("A only");
    const queryB = queryItem("B only");
    const reportA = report("Report A");
    const reportB = report("Report B");
    expect(keyA).not.toBe(keyB);

    writeQueryHistory([queryA], keyA);
    writeQueryHistory([queryB], keyB);
    writeExecutiveReportHistory([reportA], keyA);
    writeExecutiveReportHistory([reportB], keyB);

    expect(readQueryHistory(keyA)).toEqual([queryA]);
    expect(readQueryHistory(keyB)).toEqual([queryB]);
    expect(readExecutiveReportHistory(keyA)).toEqual([reportA]);
    expect(readExecutiveReportHistory(keyB)).toEqual([reportB]);
    expect(JSON.stringify(readQueryHistory(keyB))).not.toContain("A only");
    expect(JSON.stringify(readExecutiveReportHistory(keyB))).not.toContain("Report A");
  });

  it("returns no scope for unresolved or forged organizations in tenant mode", () => {
    for (const org of [undefined, null, "", " ", "org-name", "x;y", "a/b"]) {
      const scope = getAuthenticatedHistoryScope({
        id: USER, tenantIdentityEnabled: true, organizationId: org
      });
      expect(scope).toBeNull();
      const sentinel = queryItem("Must never persist");
      writeQueryHistory([sentinel], scope);
      expect(readQueryHistory(scope)).toEqual([]);
    }
    expect(window.localStorage.length).toBe(0);
  });

  it("separates users and normalizes only the identifier, not the active membership", () => {
    const first = getAuthenticatedHistoryScope({
      id: USER, tenantIdentityEnabled: true, organizationId: A.toUpperCase()
    });
    const second = getAuthenticatedHistoryScope({
      id: USER, tenantIdentityEnabled: true, organizationId: A
    });
    const otherUser = getAuthenticatedHistoryScope({
      id: "44444444-4444-4444-8444-444444444444",
      tenantIdentityEnabled: true, organizationId: A
    });
    expect(first).toBe(second);
    expect(first).not.toBe(otherUser);
  });

  it("marks account and tenant changes as requiring workspace invalidation", () => {
    const current = { id: USER, tenantIdentityEnabled: true, organizationId: A };
    expect(sessionHistoryIdentityChanged(current, { ...current })).toBe(false);
    expect(sessionHistoryIdentityChanged(current, {
      ...current, organizationId: B
    })).toBe(true);
    expect(sessionHistoryIdentityChanged(current, {
      ...current, tenantIdentityEnabled: false
    })).toBe(true);
    expect(sessionHistoryIdentityChanged(current, {
      ...current, organizationId: null
    })).toBe(true);
    expect(sessionHistoryIdentityChanged(current, null)).toBe(true);
    expect(sessionHistoryIdentityChanged(null, current)).toBe(true);
  });
});
