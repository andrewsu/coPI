/**
 * Tests for GET /api/profile/pending and POST /api/profile/pending.
 *
 * Validates the side-by-side profile comparison API:
 * - GET: auth checks, 404 when no profile, 404 when no pending profile,
 *   returns current + candidate with changed fields
 * - POST accept: applies candidate fields, bumps version, clears pending,
 *   supports field overrides for "edit before saving", validates fields
 * - POST dismiss: clears pending profile without applying changes
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
      update: jest.fn(),
    },
  },
}));
jest.mock("@/services/matching-triggers", () => ({
  triggerMatchingForProfileUpdate: jest.fn().mockResolvedValue(undefined),
}));

import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { triggerMatchingForProfileUpdate } from "@/services/matching-triggers";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.researcherProfile.findUnique);
const mockUpdate = jest.mocked(prisma.researcherProfile.update);
const mockTriggerMatching = jest.mocked(triggerMatchingForProfileUpdate);

const { GET, POST } = require("../route");

/** Helper: generates a word string of exact length for summary validation. */
function wordsOf(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

/** A pending profile candidate stored as JSONB. */
const PENDING_CANDIDATE = {
  researchSummary: wordsOf(200),
  techniques: ["scRNA-seq", "Spatial transcriptomics", "CRISPR screening", "Flow cytometry"],
  experimentalModels: ["Mouse", "iPSC-derived neurons"],
  diseaseAreas: ["Neurodegeneration", "Alzheimer's disease"],
  keyTargets: ["Tau", "APP", "BACE1"],
  keywords: ["single-cell", "neuroinflammation"],
  grantTitles: ["NIH R01 - Tau pathology", "NIA P30 - ADRC"],
  rawAbstractsHash: "abc123hash",
  generatedAt: "2026-02-15T10:00:00.000Z",
};

/** Current profile fields. */
const CURRENT_PROFILE = {
  id: "profile-1",
  userId: "user-1",
  researchSummary: wordsOf(180),
  techniques: ["RNA-seq", "CRISPR screening", "Mass spectrometry"],
  experimentalModels: ["Mouse", "HeLa cells"],
  diseaseAreas: ["Cancer biology"],
  keyTargets: ["p53"],
  keywords: ["transcriptomics"],
  grantTitles: ["NIH R01 Grant"],
  profileVersion: 3,
  pendingProfile: PENDING_CANDIDATE,
  pendingProfileCreatedAt: new Date("2026-02-15"),
};

/** Profile record with no pending update. */
const PROFILE_NO_PENDING = {
  ...CURRENT_PROFILE,
  pendingProfile: null,
  pendingProfileCreatedAt: null,
};

/** Builds a NextRequest-like object for POST. */
function makePostRequest(body: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve(body) };
}

describe("GET /api/profile/pending", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 404 when profile does not exist", async () => {
    /** Users without any profile get 404. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns 404 when no pending profile exists", async () => {
    /** Users with a profile but no pending update get 404. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue(PROFILE_NO_PENDING as never);
    const res = await GET();
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/pending/i);
  });

  it("returns current and candidate profiles with changed fields", async () => {
    /** When a pending profile exists, both current and candidate are returned
     * with a list of changed fields for the UI to highlight differences. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue(CURRENT_PROFILE as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    // Current profile fields
    expect(data.current.researchSummary).toBe(CURRENT_PROFILE.researchSummary);
    expect(data.current.techniques).toEqual(CURRENT_PROFILE.techniques);
    expect(data.current.grantTitles).toEqual(CURRENT_PROFILE.grantTitles);

    // Candidate profile fields
    expect(data.candidate.researchSummary).toBe(PENDING_CANDIDATE.researchSummary);
    expect(data.candidate.techniques).toEqual(PENDING_CANDIDATE.techniques);
    expect(data.candidate.grantTitles).toEqual(PENDING_CANDIDATE.grantTitles);
    expect(data.candidate.generatedAt).toBe(PENDING_CANDIDATE.generatedAt);

    // Changed fields detected (all fields differ between current and candidate)
    expect(data.changedFields).toContain("researchSummary");
    expect(data.changedFields).toContain("techniques");
    expect(data.changedFields).toContain("diseaseAreas");
    expect(data.changedFields).toContain("keyTargets");
    expect(data.changedFields).toContain("grantTitles");

    // Metadata
    expect(data.profileVersion).toBe(3);
    expect(data.pendingProfileCreatedAt).toBeDefined();
  });
});

describe("POST /api/profile/pending — dismiss", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(makePostRequest({ action: "dismiss" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when no pending profile exists", async () => {
    /** Cannot dismiss a non-existent pending profile. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 3,
      pendingProfile: null,
    } as never);

    const res = await POST(makePostRequest({ action: "dismiss" }));
    expect(res.status).toBe(404);
  });

  it("clears pending profile on dismiss", async () => {
    /** Dismiss should null out pendingProfile without applying changes. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 3,
      pendingProfile: PENDING_CANDIDATE,
    } as never);
    mockUpdate.mockResolvedValue({} as never);

    const res = await POST(makePostRequest({ action: "dismiss" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("dismissed");

    // Verify pending fields are cleared (Prisma.DbNull sets JSONB column to SQL NULL)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          pendingProfile: Prisma.DbNull,
          pendingProfileCreatedAt: null,
        },
      }),
    );

    // Matching should NOT be triggered on dismiss
    expect(mockTriggerMatching).not.toHaveBeenCalled();
  });
});

describe("POST /api/profile/pending — accept", () => {
  beforeEach(() => jest.clearAllMocks());

  it("accepts candidate as-is and bumps version", async () => {
    /** Accept without field overrides copies all candidate fields,
     * bumps profileVersion, clears pending, and triggers matching. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 3,
      pendingProfile: PENDING_CANDIDATE,
    } as never);

    const updatedRecord = {
      profileVersion: 4,
      researchSummary: PENDING_CANDIDATE.researchSummary,
      techniques: PENDING_CANDIDATE.techniques,
      experimentalModels: PENDING_CANDIDATE.experimentalModels,
      diseaseAreas: PENDING_CANDIDATE.diseaseAreas,
      keyTargets: PENDING_CANDIDATE.keyTargets,
      keywords: PENDING_CANDIDATE.keywords,
      grantTitles: PENDING_CANDIDATE.grantTitles,
    };
    mockUpdate.mockResolvedValue(updatedRecord as never);

    const res = await POST(makePostRequest({ action: "accept" }));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.status).toBe("accepted");
    expect(data.profileVersion).toBe(4);
    expect(data.techniques).toEqual(PENDING_CANDIDATE.techniques);

    // Verify version bump and pending cleared
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profileVersion: 4,
          researchSummary: PENDING_CANDIDATE.researchSummary,
          techniques: PENDING_CANDIDATE.techniques,
          grantTitles: PENDING_CANDIDATE.grantTitles,
          rawAbstractsHash: PENDING_CANDIDATE.rawAbstractsHash,
          pendingProfile: Prisma.DbNull,
          pendingProfileCreatedAt: null,
        }),
      }),
    );

    // Matching trigger should fire after version bump
    expect(mockTriggerMatching).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
    );
  });

  it("accepts candidate with field overrides for edit-before-saving", async () => {
    /** User can edit candidate fields before accepting. Only overridden
     * fields replace the candidate; non-overridden use candidate values. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 3,
      pendingProfile: PENDING_CANDIDATE,
    } as never);

    const customTechniques = ["RNA-seq", "Proteomics", "scRNA-seq", "CRISPR"];
    mockUpdate.mockResolvedValue({
      profileVersion: 4,
      researchSummary: PENDING_CANDIDATE.researchSummary,
      techniques: customTechniques,
      experimentalModels: PENDING_CANDIDATE.experimentalModels,
      diseaseAreas: PENDING_CANDIDATE.diseaseAreas,
      keyTargets: PENDING_CANDIDATE.keyTargets,
      keywords: PENDING_CANDIDATE.keywords,
      grantTitles: PENDING_CANDIDATE.grantTitles,
    } as never);

    const res = await POST(
      makePostRequest({
        action: "accept",
        fields: {
          techniques: customTechniques,
        },
      }),
    );
    expect(res.status).toBe(200);

    // Verify overridden techniques used, but summary from candidate
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          techniques: customTechniques,
          researchSummary: PENDING_CANDIDATE.researchSummary,
        }),
      }),
    );
  });

  it("returns 422 when overridden fields fail validation", async () => {
    /** Edited fields must still pass the same validation as PUT /api/profile. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 3,
      pendingProfile: PENDING_CANDIDATE,
    } as never);

    const res = await POST(
      makePostRequest({
        action: "accept",
        fields: {
          techniques: ["only-one"], // needs >= 3
          diseaseAreas: [], // needs >= 1
        },
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("3 techniques"),
        expect.stringContaining("disease area"),
      ]),
    );

    // Profile should NOT be updated
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid action", async () => {
    /** Only 'accept' and 'dismiss' are valid actions. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    const res = await POST(makePostRequest({ action: "something_else" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON body", async () => {
    /** Bad request body should return 400. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    const res = await POST({
      json: () => Promise.reject(new Error("Invalid JSON")),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when profile does not exist", async () => {
    /** Cannot accept pending profile for a non-existent profile. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(makePostRequest({ action: "accept" }));
    expect(res.status).toBe(404);
  });
});
