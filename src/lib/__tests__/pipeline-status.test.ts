/**
 * Tests for the in-memory pipeline status tracker.
 *
 * Validates that pipeline stage transitions, warning preservation,
 * error/result storage, and cleanup all work correctly. This module
 * enables the onboarding UI to poll for real-time pipeline progress.
 */

import {
  getPipelineStatus,
  setPipelineStage,
  clearPipelineStatus,
  _clearAllStatuses,
} from "../pipeline-status";

describe("pipeline-status", () => {
  beforeEach(() => {
    _clearAllStatuses();
  });

  it("returns null for a userId with no tracked status", () => {
    /** No status should exist before any pipeline run. */
    expect(getPipelineStatus("unknown-user")).toBeNull();
  });

  it("sets and retrieves a pipeline stage with correct message", () => {
    /** Each stage maps to a user-friendly progress message. */
    setPipelineStage("user-1", "fetching_orcid");
    const status = getPipelineStatus("user-1");
    expect(status).not.toBeNull();
    expect(status!.stage).toBe("fetching_orcid");
    expect(status!.message).toBe("Pulling your publications...");
    expect(status!.warnings).toEqual([]);
  });

  it("maps each stage to the correct display message", () => {
    /** Verify all stage→message mappings match the spec text. */
    const expectations: [Parameters<typeof setPipelineStage>[1], string][] = [
      ["starting", "Starting profile generation..."],
      ["fetching_orcid", "Pulling your publications..."],
      ["fetching_publications", "Pulling your publications..."],
      ["mining_methods", "Analyzing your research..."],
      ["synthesizing", "Building your profile..."],
      ["complete", "Your profile is ready!"],
      ["error", "Something went wrong."],
    ];

    for (const [stage, expectedMessage] of expectations) {
      setPipelineStage("user-msg", stage);
      expect(getPipelineStatus("user-msg")!.message).toBe(expectedMessage);
    }
  });

  it("preserves warnings from earlier stages when advancing", () => {
    /** Warnings (e.g. sparse ORCID) should persist across stage transitions. */
    setPipelineStage("user-1", "fetching_orcid", {
      warnings: ["Sparse ORCID profile"],
    });
    setPipelineStage("user-1", "synthesizing");
    const status = getPipelineStatus("user-1");
    expect(status!.warnings).toEqual(["Sparse ORCID profile"]);
  });

  it("overwrites warnings when explicitly provided", () => {
    /** Explicit warnings in a new stage replace previous ones. */
    setPipelineStage("user-1", "fetching_orcid", { warnings: ["old warning"] });
    setPipelineStage("user-1", "complete", { warnings: ["new warning"] });
    expect(getPipelineStatus("user-1")!.warnings).toEqual(["new warning"]);
  });

  it("stores error details on error stage", () => {
    /** Error stage should capture the failure message for UI display. */
    setPipelineStage("user-1", "error", { error: "ORCID API 503" });
    const status = getPipelineStatus("user-1");
    expect(status!.stage).toBe("error");
    expect(status!.error).toBe("ORCID API 503");
    expect(status!.message).toBe("Something went wrong.");
  });

  it("stores pipeline result on completion", () => {
    /** Complete stage carries summary stats for the UI. */
    setPipelineStage("user-1", "complete", {
      result: { publicationsFound: 42, profileCreated: true },
    });
    const status = getPipelineStatus("user-1");
    expect(status!.result).toEqual({
      publicationsFound: 42,
      profileCreated: true,
    });
  });

  it("tracks multiple users independently", () => {
    /** Concurrent pipeline runs for different users don't interfere. */
    setPipelineStage("user-1", "synthesizing");
    setPipelineStage("user-2", "fetching_orcid");
    expect(getPipelineStatus("user-1")!.stage).toBe("synthesizing");
    expect(getPipelineStatus("user-2")!.stage).toBe("fetching_orcid");
  });

  it("clears status for a specific user without affecting others", () => {
    setPipelineStage("user-1", "synthesizing");
    setPipelineStage("user-2", "fetching_orcid");
    clearPipelineStatus("user-1");
    expect(getPipelineStatus("user-1")).toBeNull();
    expect(getPipelineStatus("user-2")).not.toBeNull();
  });

  it("clears all statuses via _clearAllStatuses", () => {
    /** Test helper to reset state between test runs. */
    setPipelineStage("user-1", "synthesizing");
    setPipelineStage("user-2", "complete");
    _clearAllStatuses();
    expect(getPipelineStatus("user-1")).toBeNull();
    expect(getPipelineStatus("user-2")).toBeNull();
  });

  it("does not carry error from previous stage into new stage", () => {
    /** When advancing past an error (retry), error should not persist. */
    setPipelineStage("user-1", "error", { error: "temporary failure" });
    setPipelineStage("user-1", "starting");
    const status = getPipelineStatus("user-1");
    expect(status!.stage).toBe("starting");
    expect(status!.error).toBeUndefined();
  });
});
