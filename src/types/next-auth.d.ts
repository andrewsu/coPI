import { DefaultSession } from "next-auth";

/**
 * Type augmentation for next-auth to include CoPI-specific session fields.
 * - user.id: Database UUID (not the ORCID)
 * - user.orcid: ORCID identifier (e.g., "0000-0001-2345-6789")
 * - user.isAdmin: Whether the user has admin dashboard access
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      orcid: string;
      isAdmin: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    orcid?: string;
    isAdmin?: boolean;
  }
}
