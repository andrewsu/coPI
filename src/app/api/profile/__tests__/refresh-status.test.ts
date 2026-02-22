/**
 * Tests for GET /api/profile/refresh-status.
 *
 * Validates the polling endpoint that returns pipeline progress during
 * a manual profile refresh. Unlike the onboarding profile-status endpoint,
 * this does NOT short-circuit when a profile exists — it returns the actual
 * in-memory pipeline status since profile always exists during refresh.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));
jest.mock("@/lib/pipeline-status", () => ({
  getPipelineStatus: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { getPipelineStatus } from "@/lib/pipeline-status";

const mockGetServerSession = jest.mocked(getServerSession);
const mockGetStatus = jest.mocked(getPipelineStatus);

// Import route handler after mocks are set up
const { GET } = require("../../profile/refresh-status/route");

describe("GET /api/profile/refresh-status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns idle when no refresh is in progress", async () => {
    /** Default state: no pipeline running for this user. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockGetStatus.mockReturnValue(null);

    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stage).toBe("idle");
    expect(data.message).toBe("No refresh in progress.");
    expect(data.warnings).toEqual([]);
  });

  it("returns current stage when pipeline is running", async () => {
    /** During refresh, returns the in-memory pipeline progress stage. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockGetStatus.mockReturnValue({
      stage: "fetching_publications",
      message: "Pulling your publications...",
      warnings: [],
    });

    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stage).toBe("fetching_publications");
    expect(data.message).toBe("Pulling your publications...");
  });

  it("returns complete with result when pipeline finishes", async () => {
    /** Verifies result data (publication count) is forwarded to the client. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockGetStatus.mockReturnValue({
      stage: "complete",
      message: "Your profile is ready!",
      warnings: ["Sparse ORCID"],
      result: {
        publicationsFound: 20,
        profileCreated: false,
      },
    });

    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stage).toBe("complete");
    expect(data.warnings).toEqual(["Sparse ORCID"]);
    expect(data.result.publicationsFound).toBe(20);
    expect(data.result.profileCreated).toBe(false);
  });

  it("returns error details when pipeline fails", async () => {
    /** Error messages from the pipeline are forwarded for UI display. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockGetStatus.mockReturnValue({
      stage: "error",
      message: "Something went wrong.",
      warnings: [],
      error: "ORCID API 503",
    });

    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stage).toBe("error");
    expect(data.error).toBe("ORCID API 503");
  });

  it("returns synthesizing stage during LLM synthesis", async () => {
    /** Verifies the synthesizing stage is forwarded correctly. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockGetStatus.mockReturnValue({
      stage: "synthesizing",
      message: "Building your profile...",
      warnings: [],
    });

    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stage).toBe("synthesizing");
    expect(data.message).toBe("Building your profile...");
  });
});
