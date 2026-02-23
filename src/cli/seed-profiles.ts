/**
 * Admin CLI for seeding researcher profiles by ORCID ID.
 *
 * Per specs/auth-and-user-management.md "Admin Functions > Seed Profiles":
 * Admin provides a list of ORCID IDs. For each:
 *   1. Create User record with ORCID ID, name, and affiliation from ORCID API
 *   2. Run full profile pipeline (publications, synthesis)
 *   3. Profile is visible in match pool browser
 *   4. No OAuth session — user claims on first ORCID login
 *
 * Usage:
 *   npm run seed -- 0000-0001-2345-6789 0000-0002-3456-7890
 *   npm run seed -- --file orcids.txt
 *   npm run seed -- --file orcids.txt --skip-deep-mining
 *   npm run seed -- --dry-run 0000-0001-2345-6789
 *
 * File format: one ORCID per line. Lines starting with # and blank lines are ignored.
 *
 * Run with: npm run seed -- [OPTIONS] [ORCID_IDS...]
 *   or:     tsx src/cli/seed-profiles.ts [OPTIONS] [ORCID_IDS...]
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/lib/prisma";
import { anthropic } from "@/lib/anthropic";
import {
  seedProfiles,
  ORCID_REGEX,
  type SeedProfileResult,
} from "@/services/seed-profile";

export interface CliOptions {
  orcids: string[];
  file?: string;
  skipDeepMining: boolean;
  dryRun: boolean;
  help: boolean;
}

const USAGE = `
CoPI Admin CLI — Seed Researcher Profiles

Usage:
  npm run seed -- [OPTIONS] [ORCID_IDS...]

Options:
  --file <path>       Read ORCID IDs from a file (one per line)
  --skip-deep-mining  Skip PMC methods section extraction (faster but less detailed)
  --dry-run           Validate ORCID IDs without running the pipeline
  --help              Show this help message

Arguments:
  ORCID_IDS           One or more ORCID iDs (e.g., 0000-0002-1234-5678)

Examples:
  npm run seed -- 0000-0002-1234-5678
  npm run seed -- 0000-0002-1234-5678 0000-0003-4567-8901
  npm run seed -- --file researchers.txt
  npm run seed -- --file researchers.txt --skip-deep-mining
  npm run seed -- --dry-run 0000-0002-1234-5678

File format:
  One ORCID iD per line. Lines starting with # and blank lines are ignored.

  # Example file
  0000-0002-1234-5678
  0000-0003-4567-8901
`.trim();

/**
 * Parses command-line arguments into structured CLI options.
 * Exported for testability.
 */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    orcids: [],
    skipDeepMining: false,
    dryRun: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      i++;
    } else if (arg === "--file" || arg === "-f") {
      i++;
      if (i >= argv.length) {
        throw new Error("--file requires a path argument");
      }
      options.file = argv[i]!;
      i++;
    } else if (arg === "--skip-deep-mining") {
      options.skipDeepMining = true;
      i++;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
      i++;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.orcids.push(arg);
      i++;
    }
  }

  return options;
}

/**
 * Loads ORCID IDs from a file. One ORCID per line.
 * Lines starting with # and blank lines are ignored.
 * Exported for testability.
 */
export function loadOrcidsFromFile(filePath: string): string[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Validates ORCID IDs and returns invalid ones.
 * Exported for testability.
 */
export function validateOrcids(orcids: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const orcid of orcids) {
    if (ORCID_REGEX.test(orcid)) {
      valid.push(orcid);
    } else {
      invalid.push(orcid);
    }
  }

  return { valid, invalid };
}

/**
 * Formats seed results into a human-readable summary table.
 * Exported for testability.
 */
export function formatResults(results: SeedProfileResult[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== Seed Results ===");
  lines.push("");

  for (const r of results) {
    if (r.success) {
      const pubs = r.pipeline?.publicationsStored ?? 0;
      const version = r.pipeline?.profileVersion ?? 1;
      lines.push(
        `  [OK]   ${r.orcid} — ${pubs} publications, profile v${version}`,
      );
    } else if (r.reason === "already_exists") {
      lines.push(`  [SKIP] ${r.orcid} — already exists (user ${r.userId})`);
    } else if (r.reason === "invalid_orcid_format") {
      lines.push(`  [FAIL] ${r.orcid} — invalid ORCID format`);
    } else {
      lines.push(
        `  [FAIL] ${r.orcid} — ${r.reason ?? "unknown error"}${r.error ? `: ${r.error}` : ""}`,
      );
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const skipped = results.filter(
    (r) => !r.success && r.reason === "already_exists",
  ).length;
  const failed = results.length - succeeded - skipped;

  lines.push("");
  lines.push(
    `Summary: ${succeeded} seeded, ${skipped} skipped, ${failed} failed (${results.length} total)`,
  );

  return lines.join("\n");
}

async function main(): Promise<void> {
  // Parse args (skip node and script path: argv[0]=node, argv[1]=script)
  const args = process.argv.slice(2);
  let options: CliOptions;

  try {
    options = parseArgs(args);
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  // Load ORCID IDs from file if specified
  if (options.file) {
    try {
      const fileOrcids = loadOrcidsFromFile(options.file);
      options.orcids = [...options.orcids, ...fileOrcids];
    } catch (err) {
      console.error(
        `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  }

  // Deduplicate
  options.orcids = [...new Set(options.orcids)];

  if (options.orcids.length === 0) {
    console.error("Error: No ORCID IDs provided.");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  console.log(`\nCoPI Admin — Seed Profiles`);
  console.log(`ORCID IDs to process: ${options.orcids.length}`);

  // Validate all ORCID IDs
  const { valid, invalid } = validateOrcids(options.orcids);

  if (invalid.length > 0) {
    console.warn(`\nWarning: ${invalid.length} invalid ORCID format(s):`);
    for (const orcid of invalid) {
      console.warn(`  - ${orcid}`);
    }
  }

  if (options.dryRun) {
    console.log(`\n[Dry Run] Validation complete.`);
    console.log(`  Valid:   ${valid.length}`);
    console.log(`  Invalid: ${invalid.length}`);
    if (valid.length > 0) {
      console.log(`\n  Valid ORCID IDs:`);
      for (const orcid of valid) {
        console.log(`    ${orcid}`);
      }
    }
    process.exit(invalid.length > 0 ? 1 : 0);
  }

  if (valid.length === 0) {
    console.error("\nError: No valid ORCID IDs to seed.");
    process.exit(1);
  }

  // Check required environment variables
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  console.log(
    `\nSeeding ${valid.length} profile(s)...${options.skipDeepMining ? " (deep mining disabled)" : ""}`,
  );
  console.log("");

  // Run seeding with all ORCID IDs (including invalid — the service handles validation too)
  const startTime = Date.now();
  const results = await seedProfiles(prisma, anthropic, options.orcids, {
    skipDeepMining: options.skipDeepMining,
    onProgress: (orcid: string, stage: string) => {
      const stageLabel = stage
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      console.log(`  [${orcid}] ${stageLabel}...`);
    },
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(formatResults(results));
  console.log(`\nCompleted in ${elapsed}s`);

  await prisma.$disconnect();

  const anyFailed = results.some(
    (r) =>
      !r.success &&
      r.reason !== "already_exists" &&
      r.reason !== "invalid_orcid_format",
  );
  process.exit(anyFailed ? 1 : 0);
}

// Only run when executed as a script, not when imported in tests
if (process.env.NODE_ENV !== "test") {
  main().catch((err: unknown) => {
    console.error("[Seed] Fatal error:", err);
    process.exit(1);
  });
}
