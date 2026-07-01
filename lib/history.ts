import type { QueryHistoryItem } from "@/lib/types";

const HISTORY_STORAGE_KEY = "ducklake-sql-agent-history";
const MAX_HISTORY_ITEMS = 10;

function isHistoryItem(value: unknown): value is QueryHistoryItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    typeof item.pergunta === "string" &&
    typeof item.sql === "string" &&
    typeof item.agent_version === "string" &&
    typeof item.detected_intent === "string" &&
    typeof item.validation_status === "string" &&
    typeof item.created_at === "string" &&
    typeof item.executed_watson === "boolean"
  );
}

export function readQueryHistory(): QueryHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter(isHistoryItem) : [];
  } catch {
    return [];
  }
}

export function writeQueryHistory(items: QueryHistoryItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS))
  );
}

export function upsertQueryHistory(
  currentItems: QueryHistoryItem[],
  nextItem: QueryHistoryItem
): QueryHistoryItem[] {
  const deduped = currentItems.filter(
    (item) =>
      item.pergunta.trim().toLowerCase() !== nextItem.pergunta.trim().toLowerCase() ||
      item.sql.trim() !== nextItem.sql.trim()
  );

  return [nextItem, ...deduped].slice(0, MAX_HISTORY_ITEMS);
}
