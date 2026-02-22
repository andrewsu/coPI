/**
 * In-memory pipeline execution status tracking.
 *
 * Tracks the progress of profile pipeline executions per user,
 * enabling the onboarding UI to poll for status updates.
 * Suitable for single-server pilot deployments.
 */

export type PipelineStage =
  | "starting"
  | "fetching_orcid"
  | "fetching_publications"
  | "mining_methods"
  | "synthesizing"
  | "complete"
  | "error";

export interface PipelineStatus {
  stage: PipelineStage;
  message: string;
  warnings: string[];
  error?: string;
  result?: {
    publicationsFound: number;
    profileCreated: boolean;
  };
}

const STAGE_MESSAGES: Record<PipelineStage, string> = {
  starting: "Starting profile generation...",
  fetching_orcid: "Pulling your publications...",
  fetching_publications: "Pulling your publications...",
  mining_methods: "Analyzing your research...",
  synthesizing: "Building your profile...",
  complete: "Your profile is ready!",
  error: "Something went wrong.",
};

/** In-memory store of pipeline status keyed by userId. */
const statusMap = new Map<string, PipelineStatus>();

export function getPipelineStatus(userId: string): PipelineStatus | null {
  return statusMap.get(userId) ?? null;
}

/**
 * Sets the pipeline stage for a user, updating the display message automatically.
 * Warnings from previous stages are preserved unless explicitly overwritten.
 */
export function setPipelineStage(
  userId: string,
  stage: PipelineStage,
  extra?: Partial<Pick<PipelineStatus, "warnings" | "error" | "result">>,
): void {
  const existing = statusMap.get(userId);
  statusMap.set(userId, {
    stage,
    message: STAGE_MESSAGES[stage],
    warnings: extra?.warnings ?? existing?.warnings ?? [],
    error: extra?.error,
    result: extra?.result,
  });
}

export function clearPipelineStatus(userId: string): void {
  statusMap.delete(userId);
}

/** Exposed for testing: clears all entries. */
export function _clearAllStatuses(): void {
  statusMap.clear();
}
