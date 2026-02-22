/**
 * Tests for GET /api/profile and PUT /api/profile.
 *
 * Validates: authentication checks, 404 when no profile exists,
 * successful profile fetch, profile update with validation,
 * version bumping on edit, and input sanitization.
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

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.researcherProfile.findUnique);
const mockUpdate = jest.mocked(prisma.researcherProfile.update);

const { GET, PUT } = require("../route");

/** Helper: generates a word string of exact length for summary validation. */
function wordsOf(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

/** A valid profile record as returned by Prisma. */
const VALID_PROFILE = {
  id: "profile-1",
  userId: "user-1",
  researchSummary: wordsOf(180),
  techniques: ["RNA-seq", "CRISPR screening", "Mass spectrometry"],
  experimentalModels: ["Mouse", "HeLa cells"],
  diseaseAreas: ["Cancer biology"],
  keyTargets: ["p53"],
  keywords: ["transcriptomics"],
  grantTitles: ["NIH R01 Grant"],
  userSubmittedTexts: null,
  profileVersion: 1,
  profileGeneratedAt: new Date("2025-01-01"),
};

/** Builds a valid PUT request payload. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    researchSummary: VALID_PROFILE.researchSummary,
    techniques: VALID_PROFILE.techniques,
    experimentalModels: VALID_PROFILE.experimentalModels,
    diseaseAreas: VALID_PROFILE.diseaseAreas,
    keyTargets: VALID_PROFILE.keyTargets,
    keywords: VALID_PROFILE.keywords,
    ...overrides,
  };
}

/** Builds a NextRequest-like object for PUT. */
function makePutRequest(body: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve(body) };
}

describe("GET /api/profile", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 404 when profile does not exist", async () => {
    /** Users without a generated profile get a 404. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns the profile when it exists", async () => {
    /** Fetches all editable fields plus read-only grant titles and metadata. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(VALID_PROFILE as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.researchSummary).toBe(VALID_PROFILE.researchSummary);
    expect(data.techniques).toEqual(VALID_PROFILE.techniques);
    expect(data.experimentalModels).toEqual(VALID_PROFILE.experimentalModels);
    expect(data.diseaseAreas).toEqual(VALID_PROFILE.diseaseAreas);
    expect(data.keyTargets).toEqual(VALID_PROFILE.keyTargets);
    expect(data.keywords).toEqual(VALID_PROFILE.keywords);
    expect(data.grantTitles).toEqual(VALID_PROFILE.grantTitles);
    expect(data.profileVersion).toBe(1);
  });
});

describe("PUT /api/profile", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await PUT(makePutRequest(validPayload()));
    expect(res.status).toBe(401);
  });

  it("returns 404 when profile does not exist", async () => {
    /** Cannot edit a profile that hasn't been generated yet. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue(null);

    const res = await PUT(makePutRequest(validPayload()));
    expect(res.status).toBe(404);
  });

  it("returns 422 when research summary is too short", async () => {
    /** Summary under 150 words must fail validation. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const res = await PUT(
      makePutRequest(validPayload({ researchSummary: wordsOf(100) })),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("150 words")]),
    );
  });

  it("returns 422 when research summary is too long", async () => {
    /** Summary over 250 words must fail validation. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const res = await PUT(
      makePutRequest(validPayload({ researchSummary: wordsOf(300) })),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("250 words")]),
    );
  });

  it("returns 422 when fewer than 3 techniques", async () => {
    /** Spec requires at least 3 techniques for a valid profile. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const res = await PUT(
      makePutRequest(validPayload({ techniques: ["RNA-seq", "CRISPR"] })),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("3 techniques")]),
    );
  });

  it("returns 422 when disease areas is empty", async () => {
    /** At least 1 disease area or biological process is required. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const res = await PUT(makePutRequest(validPayload({ diseaseAreas: [] })));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("disease area")]),
    );
  });

  it("returns 422 when key targets is empty", async () => {
    /** At least 1 key target is required. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const res = await PUT(makePutRequest(validPayload({ keyTargets: [] })));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.details).toEqual(
      expect.arrayContaining([expect.stringContaining("key target")]),
    );
  });

  it("updates profile and bumps version on valid input", async () => {
    /** Successful edit should persist changes and increment profileVersion. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const updatedProfile = {
      ...VALID_PROFILE,
      profileVersion: 2,
      profileGeneratedAt: new Date(),
    };
    mockUpdate.mockResolvedValue(updatedProfile as never);

    const res = await PUT(makePutRequest(validPayload()));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.profileVersion).toBe(2);

    // Verify Prisma was called with version bump
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        data: expect.objectContaining({
          profileVersion: 2,
          researchSummary: VALID_PROFILE.researchSummary,
          techniques: VALID_PROFILE.techniques,
        }),
      }),
    );
  });

  it("trims whitespace and filters empty strings from arrays", async () => {
    /** Input sanitization: whitespace-only and empty strings are stripped. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const updatedProfile = {
      ...VALID_PROFILE,
      techniques: ["RNA-seq", "CRISPR", "Mass spec"],
      profileVersion: 2,
      profileGeneratedAt: new Date(),
    };
    mockUpdate.mockResolvedValue(updatedProfile as never);

    const res = await PUT(
      makePutRequest(
        validPayload({
          techniques: ["  RNA-seq  ", "CRISPR", "", "  ", "Mass spec"],
        }),
      ),
    );
    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          techniques: ["RNA-seq", "CRISPR", "Mass spec"],
        }),
      }),
    );
  });

  it("returns 422 with multiple errors when multiple fields invalid", async () => {
    /** All validation errors are reported at once so the user can fix them. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const res = await PUT(
      makePutRequest(
        validPayload({
          researchSummary: wordsOf(100),
          techniques: ["one"],
          diseaseAreas: [],
          keyTargets: [],
        }),
      ),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    // Should have at least 4 errors: summary, techniques, disease areas, key targets
    expect(data.details.length).toBeGreaterThanOrEqual(4);
  });

  it("returns 400 for malformed JSON body", async () => {
    /** Bad request body should return 400, not crash. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockFindUnique.mockResolvedValue({
      id: "profile-1",
      profileVersion: 1,
    } as never);

    const res = await PUT({
      json: () => Promise.reject(new Error("Invalid JSON")),
    });
    expect(res.status).toBe(400);
  });
});
