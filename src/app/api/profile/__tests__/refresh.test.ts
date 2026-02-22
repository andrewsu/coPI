/**
 * Tests for POST /api/profile/refresh.
 *
 * Validates the API route that triggers a full profile pipeline re-run
 * for users who already have a profile. Covers: authentication checks,
 * no-profile guard, already-running guard, and successful pipeline kickoff.
 *
 * This endpoint differs from onboarding generate-profile:
 * - Requires an existing profile (vs. requires NO profile)
 * - Updates the existing profile in place (pipeline handles version bump)
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    researcherProfile: {
      findUnique: jest.fn(),
    },
  },
}));
jest.mock("@/lib/anthropic", () => ({
  anthropic: {},
}));
jest.mock("@/services/profile-pipeline", () => ({
  runProfilePipeline: jest.fn(),
}));
jest.mock("@/lib/pipeline-status", () => ({
  getPipelineStatus: jest.fn(),
  setPipelineStage: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { runProfilePipeline } from "@/services/profile-pipeline";
import {
  getPipelineStatus,
  setPipelineStage,
} from "@/lib/pipeline-status";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.researcherProfile.findUnique);
const mockRunPipeline = jest.mocked(runProfilePipeline);
const mockGetStatus = jest.mocked(getPipelineStatus);
const mockSetStage = jest.mocked(setPipelineStage);

// Import route handler after mocks are set up
const { POST } = require("../../profile/refresh/route");

describe("POST /api/profile/refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it("returns 401 when session is missing orcid", async () => {
    /** Session without ORCID (malformed JWT) should be rejected. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it("returns no_profile when user has no profile to refresh", async () => {
    /** Users without a profile should be directed to onboarding instead. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue(null);

    const response = await POST();
    const data = await response.json();
    expect(data.status).toBe("no_profile");
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("returns already_running when pipeline is in progress", async () => {
    /** Prevents duplicate pipeline runs from rapid button clicks. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);
    mockGetStatus.mockReturnValue({
      stage: "synthesizing",
      message: "Building your profile...",
      warnings: [],
    });

    const response = await POST();
    const data = await response.json();
    expect(data.status).toBe("already_running");
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("allows re-trigger after error status", async () => {
    /** Users should be able to retry after a pipeline failure. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);
    mockGetStatus.mockReturnValue({
      stage: "error",
      message: "Something went wrong.",
      warnings: [],
      error: "ORCID API failed",
    });
    mockRunPipeline.mockReturnValue(new Promise(() => {}) as never);

    const response = await POST();
    const data = await response.json();
    expect(data.status).toBe("started");
    expect(mockRunPipeline).toHaveBeenCalled();
  });

  it("allows re-trigger after complete status", async () => {
    /** Users can refresh again after a previous refresh completed. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);
    mockGetStatus.mockReturnValue({
      stage: "complete",
      message: "Your profile is ready!",
      warnings: [],
    });
    mockRunPipeline.mockReturnValue(new Promise(() => {}) as never);

    const response = await POST();
    const data = await response.json();
    expect(data.status).toBe("started");
    expect(mockRunPipeline).toHaveBeenCalled();
  });

  it("starts pipeline and returns started for valid refresh request", async () => {
    /** Happy path: user with existing profile triggers a full refresh. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);
    mockGetStatus.mockReturnValue(null);
    mockRunPipeline.mockReturnValue(new Promise(() => {}) as never);

    const response = await POST();
    const data = await response.json();
    expect(data.status).toBe("started");
    expect(mockSetStage).toHaveBeenCalledWith("user-1", "starting");
    expect(mockRunPipeline).toHaveBeenCalledWith(
      expect.anything(), // prisma
      expect.anything(), // anthropic
      "user-1",
      "0000-0001-2345-6789",
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
  });

  it("sets complete status when pipeline succeeds", async () => {
    /** Verifies the .then() handler stores pipeline results for polling. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);
    mockGetStatus.mockReturnValue(null);

    mockRunPipeline.mockResolvedValue({
      userId: "user-1",
      profileCreated: false,
      publicationsStored: 25,
      synthesis: { output: null, valid: false, validation: null, attempts: 1, model: "test", retried: false },
      warnings: ["Sparse ORCID"],
      profileVersion: 4,
    } as never);

    await POST();

    // Allow microtasks to run (the .then handler)
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetStage).toHaveBeenCalledWith("user-1", "complete", {
      warnings: ["Sparse ORCID"],
      result: {
        publicationsFound: 25,
        profileCreated: false,
      },
    });
  });

  it("sets error status when pipeline throws", async () => {
    /** Verifies the .catch() handler stores the error for polling. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);
    mockGetStatus.mockReturnValue(null);

    mockRunPipeline.mockRejectedValue(new Error("PubMed API timeout"));

    await POST();

    // Allow microtasks to run (the .catch handler)
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetStage).toHaveBeenCalledWith("user-1", "error", {
      error: "PubMed API timeout",
    });
  });

  it("passes onProgress callback that updates pipeline stage", async () => {
    /** Ensures the progress callback is wired to setPipelineStage for polling. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);
    mockGetStatus.mockReturnValue(null);
    mockRunPipeline.mockReturnValue(new Promise(() => {}) as never);

    await POST();

    // Extract the onProgress callback from the pipeline call
    const callArgs = mockRunPipeline.mock.calls[0]!;
    const options = callArgs[4] as { onProgress: (stage: string) => void };
    options.onProgress("fetching_publications");

    expect(mockSetStage).toHaveBeenCalledWith("user-1", "fetching_publications");
  });
});
