/**
 * Admin CLI for granting and revoking admin access by ORCID ID.
 *
 * Per specs/admin-dashboard.md "CLI Addition":
 *   npm run admin:grant -- <ORCID>
 *   npm run admin:revoke -- <ORCID>
 *
 * Sets the `isAdmin` boolean field on the User model. There is no
 * self-service way to become an admin — this CLI is the only mechanism.
 *
 * Run with:
 *   npm run admin:grant -- 0000-0001-2345-6789
 *   npm run admin:revoke -- 0000-0001-2345-6789
 *   tsx src/cli/admin-access.ts grant 0000-0001-2345-6789
 *   tsx src/cli/admin-access.ts revoke 0000-0001-2345-6789
 */

import { prisma } from "@/lib/prisma";
import { ORCID_REGEX } from "@/services/seed-profile";

export type Action = "grant" | "revoke";

export interface CliOptions {
  action: Action;
  orcid: string;
  help: boolean;
}

const USAGE = `
CoPI Admin CLI — Grant/Revoke Admin Access

Usage:
  npm run admin:grant -- <ORCID>
  npm run admin:revoke -- <ORCID>

Or directly:
  tsx src/cli/admin-access.ts grant <ORCID>
  tsx src/cli/admin-access.ts revoke <ORCID>

Arguments:
  grant   Grant admin access to the user with the given ORCID iD
  revoke  Revoke admin access from the user with the given ORCID iD
  ORCID   An ORCID iD (e.g., 0000-0002-1234-5678)

Options:
  --help, -h  Show this help message

Examples:
  npm run admin:grant -- 0000-0002-1234-5678
  npm run admin:revoke -- 0000-0002-1234-5678
`.trim();

/**
 * Parses command-line arguments into structured CLI options.
 * Exported for testability.
 */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    action: "grant",
    orcid: "",
    help: false,
  };

  let actionSet = false;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (options.help) {
    return options;
  }

  // First positional is the action (grant/revoke)
  if (positionals.length >= 1) {
    const action = positionals[0]!;
    if (action !== "grant" && action !== "revoke") {
      throw new Error(
        `Invalid action: "${action}". Must be "grant" or "revoke".`,
      );
    }
    options.action = action;
    actionSet = true;
  }

  // Second positional is the ORCID ID
  if (positionals.length >= 2) {
    options.orcid = positionals[1]!;
  }

  if (!actionSet && !options.help) {
    throw new Error("Missing action. Must specify 'grant' or 'revoke'.");
  }

  if (!options.orcid && !options.help) {
    throw new Error("Missing ORCID ID argument.");
  }

  if (positionals.length > 2) {
    throw new Error("Too many arguments. Expected: <action> <ORCID>");
  }

  return options;
}

/**
 * Validates an ORCID ID format.
 * Exported for testability.
 */
export function validateOrcid(orcid: string): boolean {
  return ORCID_REGEX.test(orcid);
}

/**
 * Grants or revokes admin access for a user identified by ORCID.
 * Returns a result object with status and user details.
 * Exported for testability — accepts injected PrismaClient.
 */
export async function setAdminAccess(
  db: typeof prisma,
  orcid: string,
  action: Action,
): Promise<{
  success: boolean;
  userName?: string;
  wasAlready?: boolean;
  error?: string;
}> {
  const user = await db.user.findUnique({
    where: { orcid },
    select: { id: true, name: true, isAdmin: true, deletedAt: true },
  });

  if (!user) {
    return { success: false, error: `No user found with ORCID ${orcid}` };
  }

  if (user.deletedAt) {
    return {
      success: false,
      error: `User ${user.name ?? orcid} has been deleted`,
    };
  }

  const targetValue = action === "grant";

  if (user.isAdmin === targetValue) {
    return {
      success: true,
      userName: user.name ?? orcid,
      wasAlready: true,
    };
  }

  await db.user.update({
    where: { orcid },
    data: { isAdmin: targetValue },
  });

  return {
    success: true,
    userName: user.name ?? orcid,
    wasAlready: false,
  };
}

async function main(): Promise<void> {
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

  if (!validateOrcid(options.orcid)) {
    console.error(`Error: Invalid ORCID format: ${options.orcid}`);
    console.error("Expected format: 0000-0000-0000-000X");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const actionVerb = options.action === "grant" ? "Granting" : "Revoking";
  console.log(`\n${actionVerb} admin access for ORCID ${options.orcid}...`);

  const result = await setAdminAccess(prisma, options.orcid, options.action);

  if (!result.success) {
    console.error(`\nError: ${result.error}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (result.wasAlready) {
    const state = options.action === "grant" ? "already an admin" : "not an admin";
    console.log(`\n${result.userName} is ${state}. No changes made.`);
  } else {
    const pastVerb = options.action === "grant" ? "granted to" : "revoked from";
    console.log(`\nAdmin access ${pastVerb} ${result.userName}.`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

// Only run when executed as a script, not when imported in tests
if (process.env.NODE_ENV !== "test") {
  main().catch((err: unknown) => {
    console.error("[Admin] Fatal error:", err);
    process.exit(1);
  });
}
