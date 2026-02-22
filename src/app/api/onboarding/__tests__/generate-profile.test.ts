/**
 * Tests for POST /api/onboarding/generate-profile.
 *
 * Validates the API route that triggers the profile pipeline for new users.
 * Covers: authentication checks, already-exists guard, already-running guard,
 * and successful pipeline kickoff.
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
const { POST } = require("../generate-profile/route");

describe("POST /api/onboarding/generate-profile", () => {
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

  it("returns already_exists when profile exists in database", async () => {
    /** Users who already have a profile should not re-run the pipeline. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);

    const response = await POST();
    const data = await response.json();
    expect(data.status).toBe("already_exists");
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("returns already_running when pipeline is in progress", async () => {
    /** Prevents duplicate pipeline runs from rapid page refreshes. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue(null);
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
    mockFindUnique.mockResolvedValue(null);
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

  it("starts pipeline and returns started when no profile or status exists", async () => {
    /** Happy path: new user triggers their first pipeline run. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue(null);
    mockGetStatus.mockReturnValue(null);
    // Pipeline returns a never-resolving promise (background execution)
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
    /** Verifies the .then() handler correctly stores pipeline results. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue(null);
    mockGetStatus.mockReturnValue(null);

    // Pipeline resolves with a result
    mockRunPipeline.mockResolvedValue({
      userId: "user-1",
      profileCreated: true,
      publicationsStored: 15,
      synthesis: { output: null, valid: false, validation: null, attempts: 1, model: "test", retried: false },
      warnings: ["Sparse ORCID"],
      profileVersion: 1,
    } as never);

    await POST();

    // Allow microtasks to run (the .then handler)
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetStage).toHaveBeenCalledWith("user-1", "complete", {
      warnings: ["Sparse ORCID"],
      result: {
        publicationsFound: 15,
        profileCreated: true,
      },
    });
  });

  it("sets error status when pipeline throws", async () => {
    /** Verifies the .catch() handler correctly stores the error message. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", orcid: "0000-0001-2345-6789" },
    });
    mockFindUnique.mockResolvedValue(null);
    mockGetStatus.mockReturnValue(null);

    mockRunPipeline.mockRejectedValue(new Error("ORCID API 503"));

    await POST();

    // Allow microtasks to run (the .catch handler)
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetStage).toHaveBeenCalledWith("user-1", "error", {
      error: "ORCID API 503",
    });
  });
});
