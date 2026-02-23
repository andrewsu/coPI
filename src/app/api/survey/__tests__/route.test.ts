/**
 * Tests for POST /api/survey — Record proposal quality survey responses.
 *
 * Validates: authentication, request body validation (failureModes required,
 * must be non-empty array of valid values), freeText validation (optional,
 * string, max 1000 chars), successful survey creation, and that the survey
 * stores the correct data.
 *
 * The periodic survey appears after every Nth archive action and collects
 * aggregate feedback on proposal quality issues for analysis.
 *
 * Spec reference: specs/swipe-interface.md, "Periodic Survey" section.
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
    surveyResponse: {
      create: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockSurveyCreate = jest.mocked(prisma.surveyResponse.create);

const { POST } = require("../route");

/** Helper: build a request for the survey endpoint. */
function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/survey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/survey", () => {
  beforeEach(() => jest.clearAllMocks());

  // --- Authentication ---

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ failureModes: ["too_generic"] })
    );
    expect(res.status).toBe(401);
  });

  // --- Request Validation ---

  it("returns 400 for non-JSON body", async () => {
    /** Non-JSON body should return 400. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const request = new Request("http://localhost/api/survey", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("returns 400 when failureModes is missing", async () => {
    /** failureModes is a required field. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("failureModes");
  });

  it("returns 400 when failureModes is empty array", async () => {
    /** At least one failure mode must be selected. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(makeRequest({ failureModes: [] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("non-empty");
  });

  it("returns 400 when failureModes is not an array", async () => {
    /** failureModes must be an array, not a string or object. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(makeRequest({ failureModes: "too_generic" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid failure mode values", async () => {
    /** Only predefined failure mode strings are accepted. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(
      makeRequest({ failureModes: ["too_generic", "invalid_mode"] })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("invalid_mode");
  });

  it("returns 400 when freeText is not a string", async () => {
    /** freeText must be a string if provided. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(
      makeRequest({ failureModes: ["other"], freeText: 123 })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("freeText");
  });

  it("returns 400 when freeText exceeds 1000 characters", async () => {
    /** Free text input is capped at 1000 characters. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(
      makeRequest({
        failureModes: ["other"],
        freeText: "x".repeat(1001),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("1000");
  });

  // --- Successful Submissions ---

  it("creates a survey response with selected failure modes", async () => {
    /** A valid survey submission creates a SurveyResponse record. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSurveyCreate.mockResolvedValue({
      id: "survey-1",
      userId: "user-aaa",
      failureModes: ["too_generic", "lack_of_synergy"],
      freeText: null,
      createdAt: new Date("2026-02-22T10:00:00Z"),
    } as never);

    const res = await POST(
      makeRequest({
        failureModes: ["too_generic", "lack_of_synergy"],
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe("survey-1");
    expect(data.failureModes).toEqual(["too_generic", "lack_of_synergy"]);
    expect(data.freeText).toBeNull();
    expect(data.createdAt).toBe("2026-02-22T10:00:00.000Z");

    expect(mockSurveyCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-aaa",
        failureModes: ["too_generic", "lack_of_synergy"],
        freeText: null,
      },
    });
  });

  it("creates a survey response with freeText when 'other' is selected", async () => {
    /** When 'other' is selected and freeText is provided, both are stored. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSurveyCreate.mockResolvedValue({
      id: "survey-2",
      userId: "user-aaa",
      failureModes: ["other"],
      freeText: "Proposals don't account for funding constraints",
      createdAt: new Date("2026-02-22T10:00:00Z"),
    } as never);

    const res = await POST(
      makeRequest({
        failureModes: ["other"],
        freeText: "Proposals don't account for funding constraints",
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.failureModes).toEqual(["other"]);
    expect(data.freeText).toBe(
      "Proposals don't account for funding constraints"
    );

    expect(mockSurveyCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-aaa",
        failureModes: ["other"],
        freeText: "Proposals don't account for funding constraints",
      },
    });
  });

  it("trims whitespace-only freeText to null", async () => {
    /** Whitespace-only freeText is treated as not provided. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSurveyCreate.mockResolvedValue({
      id: "survey-3",
      userId: "user-aaa",
      failureModes: ["too_generic"],
      freeText: null,
      createdAt: new Date("2026-02-22T10:00:00Z"),
    } as never);

    const res = await POST(
      makeRequest({
        failureModes: ["too_generic"],
        freeText: "   ",
      })
    );
    expect(res.status).toBe(200);

    expect(mockSurveyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ freeText: null }),
    });
  });

  it("accepts all valid failure mode values", async () => {
    /** All seven predefined failure modes should be accepted together. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    const allModes = [
      "scientifically_nonsensical",
      "scientifically_uninteresting",
      "lack_of_synergy",
      "experiment_too_complex",
      "too_generic",
      "already_pursuing_similar",
      "other",
    ];
    mockSurveyCreate.mockResolvedValue({
      id: "survey-4",
      userId: "user-aaa",
      failureModes: allModes,
      freeText: null,
      createdAt: new Date("2026-02-22T10:00:00Z"),
    } as never);

    const res = await POST(makeRequest({ failureModes: allModes }));
    expect(res.status).toBe(200);
  });
});
