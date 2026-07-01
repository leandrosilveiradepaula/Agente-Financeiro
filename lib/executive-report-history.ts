import type { ExecutiveReportHistoryItem } from "@/lib/types";

const EXECUTIVE_REPORT_HISTORY_STORAGE_KEY = "ducklake-sql-agent-executive-report-history";
const MAX_EXECUTIVE_REPORT_HISTORY_ITEMS = 30;

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

export function readExecutiveReportHistory(): ExecutiveReportHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(EXECUTIVE_REPORT_HISTORY_STORAGE_KEY);

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

export function writeExecutiveReportHistory(items: ExecutiveReportHistoryItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    EXECUTIVE_REPORT_HISTORY_STORAGE_KEY,
    JSON.stringify(sortReports(items).slice(0, MAX_EXECUTIVE_REPORT_HISTORY_ITEMS))
  );
}

export function upsertExecutiveReportHistory(
  currentItems: ExecutiveReportHistoryItem[],
  nextItem: ExecutiveReportHistoryItem
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

  writeExecutiveReportHistory(nextItems);
  return nextItems;
}

export function removeExecutiveReportHistory(id: string): ExecutiveReportHistoryItem[] {
  const nextItems = readExecutiveReportHistory().filter((item) => item.id !== id);
  writeExecutiveReportHistory(nextItems);
  return nextItems;
}

export function clearExecutiveReportHistory() {
  writeExecutiveReportHistory([]);
  return [];
}
