import type { ExecuteWatsonResponse, ExecutiveSummaryResult, GenerateSqlResponse } from "@/lib/types";

export type GenerationStateSnapshot = {
  response: GenerateSqlResponse | null;
  isLoading: boolean;
  error: string;
};

export type ExecutionStateSnapshot = {
  response: ExecuteWatsonResponse | null;
  isLoading: boolean;
  error: string;
  message: string;
  source: "automatico" | "manual" | null;
};

export type ExecutiveSummaryStateSnapshot = {
  resultKey: string;
  summary: ExecutiveSummaryResult;
} | null;

export function createNewSqlGenerationResetState() {
  return {
    sql: "",
    generation: {
      response: null,
      isLoading: true,
      error: ""
    } satisfies GenerationStateSnapshot,
    execution: {
      response: null,
      isLoading: false,
      error: "",
      message: "",
      source: null
    } satisfies ExecutionStateSnapshot,
    executiveSummaryState: null satisfies ExecutiveSummaryStateSnapshot
  };
}

export function isLatestInterfaceRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}
