/**
 * Tests for the admin CLI seed-profiles command.
 *
 * These tests verify the CLI argument parsing, file loading, ORCID validation,
 * and result formatting logic. The actual seeding (calling seedProfiles) is
 * tested in src/services/__tests__/seed-profile.test.ts.
 */

import * as fs from "fs";
import * as path from "path";
import {
  parseArgs,
  loadOrcidsFromFile,
  validateOrcids,
  formatResults,
} from "../seed-profiles";
import type { SeedProfileResult } from "@/services/seed-profile";

// Mock fs for file loading tests
jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock the main() execution dependencies so importing the module doesn't run the CLI
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/anthropic", () => ({ anthropic: {} }));
jest.mock("@/services/seed-profile", () => ({
  seedProfiles: jest.fn(),
  ORCID_REGEX: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/,
}));

describe("parseArgs", () => {
  /** Verifies that bare ORCID IDs on the command line are captured as positional args. */
  it("parses positional ORCID arguments", () => {
    const result = parseArgs(["0000-0001-2345-6789", "0000-0002-3456-7890"]);
    expect(result.orcids).toEqual([
      "0000-0001-2345-6789",
      "0000-0002-3456-7890",
    ]);
    expect(result.file).toBeUndefined();
    expect(result.skipDeepMining).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(result.help).toBe(false);
  });

  /** Verifies --file flag is parsed with its path argument. */
  it("parses --file option", () => {
    const result = parseArgs(["--file", "orcids.txt"]);
    expect(result.file).toBe("orcids.txt");
    expect(result.orcids).toEqual([]);
  });

  /** Verifies -f shorthand works the same as --file. */
  it("parses -f shorthand for --file", () => {
    const result = parseArgs(["-f", "orcids.txt"]);
    expect(result.file).toBe("orcids.txt");
  });

  /** Verifies --skip-deep-mining boolean flag. */
  it("parses --skip-deep-mining flag", () => {
    const result = parseArgs(["--skip-deep-mining", "0000-0001-2345-6789"]);
    expect(result.skipDeepMining).toBe(true);
    expect(result.orcids).toEqual(["0000-0001-2345-6789"]);
  });

  /** Verifies --dry-run boolean flag. */
  it("parses --dry-run flag", () => {
    const result = parseArgs(["--dry-run", "0000-0001-2345-6789"]);
    expect(result.dryRun).toBe(true);
  });

  /** Verifies --help flag. */
  it("parses --help flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  /** Verifies -h shorthand works the same as --help. */
  it("parses -h shorthand for --help", () => {
    const result = parseArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  /** Verifies all options can be combined together. */
  it("handles combined options", () => {
    const result = parseArgs([
      "--file",
      "list.txt",
      "--skip-deep-mining",
      "--dry-run",
      "0000-0001-2345-6789",
    ]);
    expect(result.file).toBe("list.txt");
    expect(result.skipDeepMining).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.orcids).toEqual(["0000-0001-2345-6789"]);
  });

  /** Verifies that --file without a following path throws an error. */
  it("throws on --file without path argument", () => {
    expect(() => parseArgs(["--file"])).toThrow(
      "--file requires a path argument",
    );
  });

  /** Verifies that unknown flags are rejected. */
  it("throws on unknown option", () => {
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown option: --unknown");
  });

  /** Verifies parsing with no arguments returns empty defaults. */
  it("returns defaults when no arguments given", () => {
    const result = parseArgs([]);
    expect(result.orcids).toEqual([]);
    expect(result.file).toBeUndefined();
    expect(result.skipDeepMining).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(result.help).toBe(false);
  });
});

describe("loadOrcidsFromFile", () => {
  /** Verifies ORCID IDs are loaded from a file, one per line. */
  it("reads ORCID IDs from file, one per line", () => {
    const filePath = "/tmp/orcids.txt";
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      "0000-0001-2345-6789\n0000-0002-3456-7890\n",
    );

    const result = loadOrcidsFromFile(filePath);
    expect(result).toEqual(["0000-0001-2345-6789", "0000-0002-3456-7890"]);
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      path.resolve(filePath),
      "utf-8",
    );
  });

  /** Verifies blank lines and # comments are filtered out. */
  it("ignores blank lines and comments", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      [
        "# Researchers from Lab A",
        "0000-0001-2345-6789",
        "",
        "# Researchers from Lab B",
        "0000-0002-3456-7890",
        "  ",
        "0000-0003-4567-8901",
      ].join("\n"),
    );

    const result = loadOrcidsFromFile("/tmp/orcids.txt");
    expect(result).toEqual([
      "0000-0001-2345-6789",
      "0000-0002-3456-7890",
      "0000-0003-4567-8901",
    ]);
  });

  /** Verifies whitespace around ORCID IDs is trimmed. */
  it("trims whitespace from lines", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      "  0000-0001-2345-6789  \n  0000-0002-3456-7890\t\n",
    );

    const result = loadOrcidsFromFile("/tmp/orcids.txt");
    expect(result).toEqual(["0000-0001-2345-6789", "0000-0002-3456-7890"]);
  });

  /** Verifies an error is thrown when the file doesn't exist. */
  it("throws when file does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    expect(() => loadOrcidsFromFile("/tmp/nonexistent.txt")).toThrow(
      "File not found:",
    );
  });

  /** Verifies an empty file returns an empty array. */
  it("returns empty array for empty file", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("");

    const result = loadOrcidsFromFile("/tmp/empty.txt");
    expect(result).toEqual([]);
  });
});

describe("validateOrcids", () => {
  /** Verifies valid ORCID formats are accepted (including X checksum). */
  it("separates valid and invalid ORCID IDs", () => {
    const result = validateOrcids([
      "0000-0001-2345-6789",
      "invalid-orcid",
      "0000-0002-3456-789X",
      "1234",
      "0000-0003-4567-8901",
    ]);
    expect(result.valid).toEqual([
      "0000-0001-2345-6789",
      "0000-0002-3456-789X",
      "0000-0003-4567-8901",
    ]);
    expect(result.invalid).toEqual(["invalid-orcid", "1234"]);
  });

  /** Verifies all-valid list returns empty invalid array. */
  it("returns all valid when all IDs are correct", () => {
    const result = validateOrcids([
      "0000-0001-2345-6789",
      "0000-0002-3456-7890",
    ]);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(0);
  });

  /** Verifies empty input returns empty arrays. */
  it("handles empty input", () => {
    const result = validateOrcids([]);
    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual([]);
  });
});

describe("formatResults", () => {
  /** Verifies successful results show publication count and version. */
  it("formats successful result", () => {
    const results: SeedProfileResult[] = [
      {
        orcid: "0000-0001-2345-6789",
        success: true,
        userId: "user-1",
        pipeline: { publicationsStored: 25, profileVersion: 1 } as SeedProfileResult["pipeline"],
      },
    ];

    const output = formatResults(results);
    expect(output).toContain("[OK]");
    expect(output).toContain("0000-0001-2345-6789");
    expect(output).toContain("25 publications");
    expect(output).toContain("profile v1");
    expect(output).toContain("1 seeded, 0 skipped, 0 failed");
  });

  /** Verifies skipped (already existing) results show user ID. */
  it("formats already_exists result", () => {
    const results: SeedProfileResult[] = [
      {
        orcid: "0000-0001-2345-6789",
        success: false,
        userId: "user-1",
        reason: "already_exists",
      },
    ];

    const output = formatResults(results);
    expect(output).toContain("[SKIP]");
    expect(output).toContain("already exists");
    expect(output).toContain("0 seeded, 1 skipped, 0 failed");
  });

  /** Verifies invalid ORCID format results are formatted. */
  it("formats invalid_orcid_format result", () => {
    const results: SeedProfileResult[] = [
      {
        orcid: "bad-format",
        success: false,
        reason: "invalid_orcid_format",
      },
    ];

    const output = formatResults(results);
    expect(output).toContain("[FAIL]");
    expect(output).toContain("invalid ORCID format");
  });

  /** Verifies pipeline error results include the error message. */
  it("formats pipeline_error result with error message", () => {
    const results: SeedProfileResult[] = [
      {
        orcid: "0000-0001-2345-6789",
        success: false,
        reason: "pipeline_error",
        error: "ORCID API timeout",
      },
    ];

    const output = formatResults(results);
    expect(output).toContain("[FAIL]");
    expect(output).toContain("pipeline_error");
    expect(output).toContain("ORCID API timeout");
  });

  /** Verifies mixed results are correctly summarized. */
  it("formats mixed results with correct summary counts", () => {
    const results: SeedProfileResult[] = [
      {
        orcid: "0000-0001-2345-6789",
        success: true,
        userId: "user-1",
        pipeline: { publicationsStored: 10, profileVersion: 1 } as SeedProfileResult["pipeline"],
      },
      {
        orcid: "0000-0002-3456-7890",
        success: false,
        userId: "user-2",
        reason: "already_exists",
      },
      {
        orcid: "0000-0003-4567-8901",
        success: false,
        reason: "pipeline_error",
        error: "API error",
      },
      {
        orcid: "bad-id",
        success: false,
        reason: "invalid_orcid_format",
      },
    ];

    const output = formatResults(results);
    expect(output).toContain("1 seeded, 1 skipped, 2 failed (4 total)");
  });

  /** Verifies empty results array produces a valid summary. */
  it("handles empty results", () => {
    const output = formatResults([]);
    expect(output).toContain("0 seeded, 0 skipped, 0 failed (0 total)");
  });
});
