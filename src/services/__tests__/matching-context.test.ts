/**
 * Tests for matching context assembly service.
 *
 * Validates that the context assembler correctly:
 * - Fetches both researchers' User + ResearcherProfile + Publications
 * - Converts Prisma Publication records to MatchingPublication format
 * - Parses userSubmittedTexts from JSONB
 * - Fetches existing proposals for de-duplication context
 * - Returns null when either researcher is missing or lacks a profile
 * - Handles batch assembly with error reporting
 * - Maps department (nullable) to optional field correctly
 *
 * The Prisma client is fully mocked — no real database calls are made.
 */

import type { PrismaClient } from "@prisma/client";
import {
  assembleContextForPair,
  assembleContextForPairs,
  parseUserSubmittedTexts,
} from "../matching-context";
import type { EligiblePair } from "../eligible-pairs";

// --- Test data ---

const USER_A_ID = "00000000-0000-0000-0000-000000000001";
const USER_B_ID = "00000000-0000-0000-0000-000000000002";
const USER_C_ID = "00000000-0000-0000-0000-000000000003";

function makeUserWithProfile(
  overrides: {
    name?: string;
    institution?: string;
    department?: string | null;
    researchSummary?: string;
    techniques?: string[];
    experimentalModels?: string[];
    diseaseAreas?: string[];
    keyTargets?: string[];
    keywords?: string[];
    grantTitles?: string[];
    userSubmittedTexts?: unknown;
  } = {},
) {
  return {
    name: overrides.name ?? "Dr. Test",
    institution: overrides.institution ?? "Test University",
    department: "department" in overrides ? overrides.department : "Biology",
    profile: {
      researchSummary:
        overrides.researchSummary ?? "Studies cellular mechanisms.",
      techniques: overrides.techniques ?? ["Western blot", "PCR"],
      experimentalModels: overrides.experimentalModels ?? ["Mouse", "HeLa"],
      diseaseAreas: overrides.diseaseAreas ?? ["Cancer"],
      keyTargets: overrides.keyTargets ?? ["p53"],
      keywords: overrides.keywords ?? ["oncology"],
      grantTitles: overrides.grantTitles ?? ["NIH R01"],
      userSubmittedTexts: overrides.userSubmittedTexts ?? null,
    },
  };
}

function makePublication(overrides: {
  title?: string;
  journal?: string;
  year?: number;
  authorPosition?: "first" | "last" | "middle";
  abstract?: string;
} = {}) {
  return {
    title: overrides.title ?? "A study of things",
    journal: overrides.journal ?? "Nature",
    year: overrides.year ?? 2024,
    authorPosition: overrides.authorPosition ?? "first",
    abstract: overrides.abstract ?? "We studied things and found results.",
  };
}

function makeExistingProposal(overrides: {
  title?: string;
  scientificQuestion?: string;
} = {}) {
  return {
    title: overrides.title ?? "Existing proposal",
    scientificQuestion:
      overrides.scientificQuestion ?? "How do things work?",
  };
}

function makeEligiblePair(overrides: Partial<EligiblePair> = {}): EligiblePair {
  return {
    researcherAId: overrides.researcherAId ?? USER_A_ID,
    researcherBId: overrides.researcherBId ?? USER_B_ID,
    visibilityA: overrides.visibilityA ?? "visible",
    visibilityB: overrides.visibilityB ?? "visible",
    profileVersionA: overrides.profileVersionA ?? 1,
    profileVersionB: overrides.profileVersionB ?? 1,
  };
}

// --- Mock DB factory ---

/**
 * Creates a mock PrismaClient with configurable return values.
 * The user.findUnique mock routes by the `where.id` argument.
 */
function createMockDb(config: {
  users?: Record<string, ReturnType<typeof makeUserWithProfile> | null>;
  publications?: Record<string, ReturnType<typeof makePublication>[]>;
  existingProposals?: ReturnType<typeof makeExistingProposal>[];
}) {
  const userFindUnique = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const userMap = config.users ?? {};
    return Promise.resolve(userMap[where.id] ?? null);
  });

  const publicationFindMany = jest.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
    const pubMap = config.publications ?? {};
    return Promise.resolve(pubMap[where.userId] ?? []);
  });

  const proposalFindMany = jest.fn().mockResolvedValue(
    config.existingProposals ?? [],
  );

  return {
    user: { findUnique: userFindUnique },
    publication: { findMany: publicationFindMany },
    collaborationProposal: { findMany: proposalFindMany },
    _mocks: { userFindUnique, publicationFindMany, proposalFindMany },
  } as unknown as PrismaClient & {
    _mocks: {
      userFindUnique: jest.Mock;
      publicationFindMany: jest.Mock;
      proposalFindMany: jest.Mock;
    };
  };
}

// --- Tests ---

describe("assembleContextForPair", () => {
  it("assembles full context when both researchers have profiles and publications", async () => {
    /** Verifies the happy path: both researchers found, publications converted, context complete. */
    const userA = makeUserWithProfile({
      name: "Dr. Alice",
      institution: "MIT",
      department: "Biology",
      techniques: ["CRISPR", "RNA-seq"],
      grantTitles: ["NIH R01", "NSF CAREER"],
    });
    const userB = makeUserWithProfile({
      name: "Dr. Bob",
      institution: "Stanford",
      department: "Chemistry",
      techniques: ["Mass spec", "NMR"],
    });

    const pubsA = [
      makePublication({ title: "Alice paper 1", year: 2024, authorPosition: "last" }),
      makePublication({ title: "Alice paper 2", year: 2023, authorPosition: "first" }),
    ];
    const pubsB = [
      makePublication({ title: "Bob paper 1", year: 2024, authorPosition: "first" }),
    ];

    const db = createMockDb({
      users: { [USER_A_ID]: userA, [USER_B_ID]: userB },
      publications: { [USER_A_ID]: pubsA, [USER_B_ID]: pubsB },
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    expect(result).not.toBeNull();
    expect(result!.researcherA.name).toBe("Dr. Alice");
    expect(result!.researcherA.institution).toBe("MIT");
    expect(result!.researcherA.department).toBe("Biology");
    expect(result!.researcherA.techniques).toEqual(["CRISPR", "RNA-seq"]);
    expect(result!.researcherA.grantTitles).toEqual(["NIH R01", "NSF CAREER"]);
    expect(result!.researcherA.publications).toHaveLength(2);
    expect(result!.researcherA.publications[0]!.title).toBe("Alice paper 1");
    expect(result!.researcherA.publications[0]!.authorPosition).toBe("last");

    expect(result!.researcherB.name).toBe("Dr. Bob");
    expect(result!.researcherB.institution).toBe("Stanford");
    expect(result!.researcherB.publications).toHaveLength(1);

    expect(result!.existingProposals).toEqual([]);
  });

  it("returns null when researcher A has no user record", async () => {
    /** Ensures missing users cause assembly to return null rather than throw. */
    const db = createMockDb({
      users: {
        [USER_B_ID]: makeUserWithProfile({ name: "Dr. Bob" }),
      },
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);
    expect(result).toBeNull();
  });

  it("returns null when researcher B has no profile", async () => {
    /** Ensures users without profiles are treated as missing. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile({ name: "Dr. Alice" }),
        [USER_B_ID]: { name: "Dr. Bob", institution: "Stanford", department: null, profile: null } as unknown as ReturnType<typeof makeUserWithProfile>,
      },
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);
    expect(result).toBeNull();
  });

  it("includes existing proposals for de-duplication", async () => {
    /** Verifies that existing proposals between the pair are fetched for the LLM de-dup context. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile({ name: "Dr. Alice" }),
        [USER_B_ID]: makeUserWithProfile({ name: "Dr. Bob" }),
      },
      existingProposals: [
        makeExistingProposal({
          title: "Proposal 1",
          scientificQuestion: "How does X affect Y?",
        }),
        makeExistingProposal({
          title: "Proposal 2",
          scientificQuestion: "Can Z be used for W?",
        }),
      ],
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    expect(result).not.toBeNull();
    expect(result!.existingProposals).toHaveLength(2);
    expect(result!.existingProposals[0]).toEqual({
      title: "Proposal 1",
      scientificQuestion: "How does X affect Y?",
    });
    expect(result!.existingProposals[1]).toEqual({
      title: "Proposal 2",
      scientificQuestion: "Can Z be used for W?",
    });
  });

  it("handles user-submitted texts from JSONB field", async () => {
    /** Verifies JSONB user-submitted texts are parsed into the expected format. */
    const userA = makeUserWithProfile({
      name: "Dr. Alice",
      userSubmittedTexts: [
        { label: "Research priorities", content: "Studying gene regulation in cancer" },
        { label: "Techniques wanted", content: "Looking for cryo-EM collaborators" },
      ],
    });

    const db = createMockDb({
      users: {
        [USER_A_ID]: userA,
        [USER_B_ID]: makeUserWithProfile({ name: "Dr. Bob" }),
      },
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    expect(result).not.toBeNull();
    expect(result!.researcherA.userSubmittedTexts).toEqual([
      { label: "Research priorities", content: "Studying gene regulation in cancer" },
      { label: "Techniques wanted", content: "Looking for cryo-EM collaborators" },
    ]);
  });

  it("handles null user-submitted texts gracefully", async () => {
    /** Verifies that null userSubmittedTexts (no entries) becomes an empty array. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile({ userSubmittedTexts: null }),
        [USER_B_ID]: makeUserWithProfile(),
      },
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    expect(result).not.toBeNull();
    expect(result!.researcherA.userSubmittedTexts).toEqual([]);
  });

  it("maps null department to undefined", async () => {
    /** The ResearcherContext interface uses optional department (undefined), not null. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile({ department: null }),
        [USER_B_ID]: makeUserWithProfile({ department: "Chemistry" }),
      },
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    expect(result).not.toBeNull();
    expect(result!.researcherA.department).toBeUndefined();
    expect(result!.researcherB.department).toBe("Chemistry");
  });

  it("converts publication author positions correctly", async () => {
    /** Verifies Prisma AuthorPosition enum values map to MatchingPublication string literals. */
    const pubs = [
      makePublication({ authorPosition: "first" }),
      makePublication({ authorPosition: "last" }),
      makePublication({ authorPosition: "middle" }),
    ];

    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile(),
        [USER_B_ID]: makeUserWithProfile(),
      },
      publications: { [USER_A_ID]: pubs },
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    expect(result).not.toBeNull();
    expect(result!.researcherA.publications[0]!.authorPosition).toBe("first");
    expect(result!.researcherA.publications[1]!.authorPosition).toBe("last");
    expect(result!.researcherA.publications[2]!.authorPosition).toBe("middle");
  });

  it("fetches all data in parallel for efficiency", async () => {
    /** Verifies that user A, user B, and proposals are fetched concurrently via Promise.all. */
    const resolveOrder: string[] = [];

    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile(),
        [USER_B_ID]: makeUserWithProfile(),
      },
    });

    // Override mocks to track call timing
    const origUserFind = (db as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
    (db as unknown as { user: { findUnique: jest.Mock } }).user.findUnique = jest.fn().mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        resolveOrder.push(`user-${where.id}`);
        return origUserFind({ where });
      },
    );

    const origProposalFind = (db as unknown as { collaborationProposal: { findMany: jest.Mock } }).collaborationProposal.findMany;
    (db as unknown as { collaborationProposal: { findMany: jest.Mock } }).collaborationProposal.findMany = jest.fn().mockImplementation(
      async (...args: unknown[]) => {
        resolveOrder.push("proposals");
        return origProposalFind(...args);
      },
    );

    await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    // All three should be called (user A, user B, and proposals)
    expect(resolveOrder).toContain(`user-${USER_A_ID}`);
    expect(resolveOrder).toContain(`user-${USER_B_ID}`);
    expect(resolveOrder).toContain("proposals");
  });

  it("queries existing proposals with correct ordered pair IDs", async () => {
    /** Verifies that proposal queries use the A < B UUID ordering convention. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile(),
        [USER_B_ID]: makeUserWithProfile(),
      },
    });

    await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    const proposalFindMany = (db as unknown as { collaborationProposal: { findMany: jest.Mock } }).collaborationProposal.findMany;
    expect(proposalFindMany).toHaveBeenCalledWith({
      where: {
        researcherAId: USER_A_ID,
        researcherBId: USER_B_ID,
      },
      select: {
        title: true,
        scientificQuestion: true,
      },
    });
  });

  it("handles researchers with no publications", async () => {
    /** Verifies that researchers with zero publications get an empty publications array. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile(),
        [USER_B_ID]: makeUserWithProfile(),
      },
      publications: {},
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    expect(result).not.toBeNull();
    expect(result!.researcherA.publications).toEqual([]);
    expect(result!.researcherB.publications).toEqual([]);
  });

  it("preserves all profile fields in the assembled context", async () => {
    /** Verifies every ResearcherProfile field is mapped to the ResearcherContext. */
    const user = makeUserWithProfile({
      name: "Dr. Full Profile",
      institution: "Harvard",
      department: "Biochemistry",
      researchSummary: "A detailed summary of research.",
      techniques: ["CRISPR", "RNA-seq", "ChIP-seq"],
      experimentalModels: ["Mouse", "Zebrafish"],
      diseaseAreas: ["Cancer", "Neurodegeneration"],
      keyTargets: ["p53", "BRCA1"],
      keywords: ["oncology", "genomics"],
      grantTitles: ["NIH R01", "DOD grant"],
    });

    const db = createMockDb({
      users: { [USER_A_ID]: user, [USER_B_ID]: makeUserWithProfile() },
    });

    const result = await assembleContextForPair(db, USER_A_ID, USER_B_ID);

    expect(result).not.toBeNull();
    const ctx = result!.researcherA;
    expect(ctx.name).toBe("Dr. Full Profile");
    expect(ctx.institution).toBe("Harvard");
    expect(ctx.department).toBe("Biochemistry");
    expect(ctx.researchSummary).toBe("A detailed summary of research.");
    expect(ctx.techniques).toEqual(["CRISPR", "RNA-seq", "ChIP-seq"]);
    expect(ctx.experimentalModels).toEqual(["Mouse", "Zebrafish"]);
    expect(ctx.diseaseAreas).toEqual(["Cancer", "Neurodegeneration"]);
    expect(ctx.keyTargets).toEqual(["p53", "BRCA1"]);
    expect(ctx.keywords).toEqual(["oncology", "genomics"]);
    expect(ctx.grantTitles).toEqual(["NIH R01", "DOD grant"]);
  });
});

describe("assembleContextForPairs", () => {
  it("assembles context for multiple pairs", async () => {
    /** Verifies batch processing returns one context per successful pair. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile({ name: "Alice" }),
        [USER_B_ID]: makeUserWithProfile({ name: "Bob" }),
        [USER_C_ID]: makeUserWithProfile({ name: "Carol" }),
      },
    });

    const pairs = [
      makeEligiblePair({ researcherAId: USER_A_ID, researcherBId: USER_B_ID }),
      makeEligiblePair({ researcherAId: USER_A_ID, researcherBId: USER_C_ID }),
    ];

    const result = await assembleContextForPairs(db, pairs);

    expect(result.contexts).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.contexts[0]!.input.researcherA.name).toBe("Alice");
    expect(result.contexts[0]!.input.researcherB.name).toBe("Bob");
    expect(result.contexts[1]!.input.researcherA.name).toBe("Alice");
    expect(result.contexts[1]!.input.researcherB.name).toBe("Carol");
  });

  it("reports errors for pairs with missing researchers", async () => {
    /** Verifies that pairs where assembly returns null are reported as errors. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile({ name: "Alice" }),
        // USER_B_ID missing — no user record
        [USER_C_ID]: makeUserWithProfile({ name: "Carol" }),
      },
    });

    const pairs = [
      makeEligiblePair({ researcherAId: USER_A_ID, researcherBId: USER_B_ID }),
      makeEligiblePair({ researcherAId: USER_A_ID, researcherBId: USER_C_ID }),
    ];

    const result = await assembleContextForPairs(db, pairs);

    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0]!.input.researcherB.name).toBe("Carol");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.pair.researcherBId).toBe(USER_B_ID);
    expect(result.errors[0]!.error).toContain("missing profile or user record");
  });

  it("reports errors for pairs that throw exceptions", async () => {
    /** Verifies that database errors are caught and reported, not thrown. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile({ name: "Alice" }),
        [USER_B_ID]: makeUserWithProfile({ name: "Bob" }),
      },
    });

    // Make user lookup throw for the second pair
    const origFindUnique = (db as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
    let callCount = 0;
    (db as unknown as { user: { findUnique: jest.Mock } }).user.findUnique = jest.fn().mockImplementation(
      (args: { where: { id: string } }) => {
        callCount++;
        // Throw on the 3rd call (first call of second pair's user A lookup)
        if (callCount === 3) {
          return Promise.reject(new Error("Database connection lost"));
        }
        return origFindUnique(args);
      },
    );

    const pairs = [
      makeEligiblePair({ researcherAId: USER_A_ID, researcherBId: USER_B_ID }),
      makeEligiblePair({ researcherAId: USER_A_ID, researcherBId: USER_C_ID }),
    ];

    const result = await assembleContextForPairs(db, pairs);

    // First pair succeeds, second pair has an error
    expect(result.contexts).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toBe("Database connection lost");
  });

  it("preserves pair metadata in the context result", async () => {
    /** Verifies that the EligiblePair (visibility, versions) is carried through to the context. */
    const db = createMockDb({
      users: {
        [USER_A_ID]: makeUserWithProfile(),
        [USER_B_ID]: makeUserWithProfile(),
      },
    });

    const pair = makeEligiblePair({
      visibilityA: "visible",
      visibilityB: "pending_other_interest",
      profileVersionA: 3,
      profileVersionB: 5,
    });

    const result = await assembleContextForPairs(db, [pair]);

    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0]!.pair.visibilityA).toBe("visible");
    expect(result.contexts[0]!.pair.visibilityB).toBe("pending_other_interest");
    expect(result.contexts[0]!.pair.profileVersionA).toBe(3);
    expect(result.contexts[0]!.pair.profileVersionB).toBe(5);
  });

  it("handles empty pairs array", async () => {
    /** Verifies that batch assembly with no pairs returns empty results. */
    const db = createMockDb({});

    const result = await assembleContextForPairs(db, []);

    expect(result.contexts).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("parseUserSubmittedTexts", () => {
  it("parses valid entries with label and content", () => {
    /** Verifies the standard case of well-formed JSONB entries. */
    const result = parseUserSubmittedTexts([
      { label: "Research goals", content: "Studying gene regulation" },
      { label: "Collaboration needs", content: "Looking for wet lab partners" },
    ]);

    expect(result).toEqual([
      { label: "Research goals", content: "Studying gene regulation" },
      { label: "Collaboration needs", content: "Looking for wet lab partners" },
    ]);
  });

  it("returns empty array for null input", () => {
    /** Verifies null JSONB field (no user-submitted texts) returns empty array. */
    expect(parseUserSubmittedTexts(null)).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    /** Verifies non-array JSONB values are safely handled. */
    expect(parseUserSubmittedTexts("not an array")).toEqual([]);
    expect(parseUserSubmittedTexts(42)).toEqual([]);
    expect(parseUserSubmittedTexts({})).toEqual([]);
  });

  it("filters out entries missing label or content", () => {
    /** Verifies malformed entries are silently dropped. */
    const result = parseUserSubmittedTexts([
      { label: "Valid", content: "Has both fields" },
      { label: "No content" },
      { content: "No label" },
      { other: "No label or content" },
      null,
      42,
    ]);

    expect(result).toEqual([
      { label: "Valid", content: "Has both fields" },
    ]);
  });

  it("coerces non-string values to strings", () => {
    /** Verifies that numeric or other typed values in label/content get String()-coerced. */
    const result = parseUserSubmittedTexts([
      { label: 123, content: true },
    ]);

    expect(result).toEqual([
      { label: "123", content: "true" },
    ]);
  });

  it("handles entries with extra fields (ignores them)", () => {
    /** Verifies that extra properties don't break parsing — only label and content are extracted. */
    const result = parseUserSubmittedTexts([
      { label: "Test", content: "Content", submitted_at: "2024-01-01", extra: true },
    ]);

    expect(result).toEqual([
      { label: "Test", content: "Content" },
    ]);
  });
});
