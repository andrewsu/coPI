/**
 * Tests for GET /api/onboarding/profile-status.
 *
 * Validates the polling endpoint that returns current pipeline progress.
 * Covers: auth checks, profile-already-exists recovery, in-progress status,
 * not-started state, and error state propagation.
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
jest.mock("@/lib/pipeline-status", () => ({
  getPipelineStatus: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getPipelineStatus } from "@/lib/pipeline-status";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.researcherProfile.findUnique);
const mockGetStatus = jest.mocked(getPipelineStatus);

const { GET } = require("../profile-status/route");

describe("GET /api/onboarding/profile-status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns complete with hasProfile=true when profile exists in DB", async () => {
    /** Handles server-restart recovery: in-memory status lost but profile exists. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({ id: "profile-1" } as never);

    const response = await GET();
    const data = await response.json();
    expect(data.stage).toBe("complete");
    expect(data.hasProfile).toBe(true);
    expect(data.warnings).toEqual([]);
  });

  it("returns not_started when no profile and no in-memory status", async () => {
    /** First load before pipeline has been triggered. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(null);
    mockGetStatus.mockReturnValue(null);

    const response = await GET();
    const data = await response.json();
    expect(data.stage).toBe("not_started");
    expect(data.hasProfile).toBe(false);
  });

  it("returns current pipeline stage when in progress", async () => {
    /** Polling while the pipeline is actively running. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(null);
    mockGetStatus.mockReturnValue({
      stage: "mining_methods",
      message: "Analyzing your research...",
      warnings: ["Sparse ORCID profile"],
    });

    const response = await GET();
    const data = await response.json();
    expect(data.stage).toBe("mining_methods");
    expect(data.message).toBe("Analyzing your research...");
    expect(data.warnings).toEqual(["Sparse ORCID profile"]);
    expect(data.hasProfile).toBe(false);
  });

  it("returns error stage with error message", async () => {
    /** Pipeline failed — UI should show retry button. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(null);
    mockGetStatus.mockReturnValue({
      stage: "error",
      message: "Something went wrong.",
      warnings: [],
      error: "ORCID API 503",
    });

    const response = await GET();
    const data = await response.json();
    expect(data.stage).toBe("error");
    expect(data.error).toBe("ORCID API 503");
    expect(data.hasProfile).toBe(false);
  });
});
