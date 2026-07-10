import type { ExecutiveReportHistoryItem } from "@/lib/types";

const MAX_EXECUTIVE_REPORT_HISTORY_ITEMS = 30;

function getExecutiveReportHistoryStorageKey(userId?: string | null) {
  return userId ? `ducklake:report-history:${userId}` : null;
}

function isExecutiveReportHistoryItem(value: unknown): value is ExecutiveReportHistoryItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  const summary = item.summary as Record<string, unknown> | undefined;

  return (
    typeof item.id === "string" &&
    typeof item.question === "string" &&
    typeof item.sql === "string" &&
    typeof item.markdown === "string" &&
    typeof item.generated_at === "string" &&
    typeof summary === "object" &&
    summary !== null &&
    typeof summary.title === "string" &&
    Array.isArray(summary.paragraphs) &&
    Array.isArray(summary.highlights)
  );
}

function sortReports(items: ExecutiveReportHistoryItem[]) {
  return [...items].sort(
    (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
  );
}

export function sanitizeExecutiveReportHistoryForPolicy(
  items: ExecutiveReportHistoryItem[],
  options: { canViewSql: boolean }
) {
  if (options.canViewSql) return items;

  return items.map((item) => ({
    ...item,
    sql: ""
  }));
}

export function readExecutiveReportHistory(userId?: string | null): ExecutiveReportHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  const storageKey = getExecutiveReportHistoryStorageKey(userId);
  if (!storageKey) return [];

  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed.filter(isExecutiveReportHistoryItem) : [];

    return sortReports(items).slice(0, MAX_EXECUTIVE_REPORT_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function writeExecutiveReportHistory(
  items: ExecutiveReportHistoryItem[],
  userId?: string | null
) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = getExecutiveReportHistoryStorageKey(userId);
  if (!storageKey) return;

  window.localStorage.setItem(
    storageKey,
    JSON.stringify(sortReports(items).slice(0, MAX_EXECUTIVE_REPORT_HISTORY_ITEMS))
  );
}

export function upsertExecutiveReportHistory(
  currentItems: ExecutiveReportHistoryItem[],
  nextItem: ExecutiveReportHistoryItem,
  userId?: string | null
): ExecutiveReportHistoryItem[] {
  if (!nextItem.markdown.trim() || !nextItem.summary.paragraphs.length) {
    return currentItems;
  }

  const nextQuestion = nextItem.question.trim().toLowerCase();
  const nextSql = nextItem.sql.trim();
  const deduped = currentItems.filter((item) => {
    if (nextItem.query_id && item.query_id) {
      return item.query_id !== nextItem.query_id;
    }

    return item.question.trim().toLowerCase() !== nextQuestion || item.sql.trim() !== nextSql;
  });
  const nextItems = sortReports([nextItem, ...deduped]).slice(0, MAX_EXECUTIVE_REPORT_HISTORY_ITEMS);

  writeExecutiveReportHistory(nextItems, userId);
  return nextItems;
}

export function removeExecutiveReportHistory(
  id: string,
  userId?: string | null
): ExecutiveReportHistoryItem[] {
  const nextItems = readExecutiveReportHistory(userId).filter((item) => item.id !== id);
  writeExecutiveReportHistory(nextItems, userId);
  return nextItems;
}

export function clearExecutiveReportHistory(userId?: string | null) {
  writeExecutiveReportHistory([], userId);
  return [];
}
