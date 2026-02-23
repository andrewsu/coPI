/**
 * NextAuth configuration with custom ORCID OAuth 2.0 provider.
 *
 * Auth flow:
 * 1. User clicks "Sign in with ORCID" → redirect to ORCID OAuth
 * 2. ORCID redirects back with auth code
 * 3. Custom token handler exchanges code (ORCID returns orcid + name in token response)
 * 4. Custom userinfo handler fetches full profile from ORCID API
 * 5. signIn callback creates or links database User
 * 6. jwt/session callbacks attach database user ID to session
 *
 * Handles: new signups, returning logins, and seeded profile claiming.
 */

import type { NextAuthOptions } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";
import { prisma } from "@/lib/prisma";
import { getJobQueue } from "@/lib/job-queue";
import { fetchOrcidProfile, type OrcidProfile } from "@/lib/orcid";
import { flipPendingProposalsOnClaim } from "@/services/seed-profile";

function getOrcidBaseUrl(): string {
  return process.env.ORCID_SANDBOX === "true"
    ? "https://sandbox.orcid.org"
    : "https://orcid.org";
}

function OrcidProvider(): OAuthConfig<OrcidProfile> {
  const orcidBaseUrl = getOrcidBaseUrl();

  return {
    id: "orcid",
    name: "ORCID",
    type: "oauth",
    clientId: process.env.ORCID_CLIENT_ID!,
    clientSecret: process.env.ORCID_CLIENT_SECRET!,
    authorization: {
      url: `${orcidBaseUrl}/oauth/authorize`,
      params: { scope: "/authenticate" },
    },
    token: {
      url: `${orcidBaseUrl}/oauth/token`,
      async request({ params, provider }) {
        // ORCID's token endpoint returns orcid and name alongside standard OAuth fields
        const response = await fetch(`${orcidBaseUrl}/oauth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            code: params.code as string,
            client_id: provider.clientId as string,
            client_secret: provider.clientSecret as string,
            grant_type: "authorization_code",
            redirect_uri: provider.callbackUrl,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `ORCID token exchange failed (${response.status}): ${text}`
          );
        }

        const data = await response.json();

        return {
          tokens: {
            access_token: data.access_token,
            token_type: data.token_type,
            refresh_token: data.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
            scope: data.scope,
            // ORCID-specific fields passed through for use in userinfo handler
            orcid: data.orcid,
            orcid_name: data.name,
          },
        };
      },
    },
    userinfo: {
      async request({ tokens }) {
        const orcid = (tokens as Record<string, unknown>).orcid as string;
        // Use public API (no access token) since we have Public API credentials.
        // The member API (api.orcid.org) requires Member API credentials and
        // /read-limited scope; the public API (pub.orcid.org) provides all
        // publicly-visible profile data without authentication.
        const profile = await fetchOrcidProfile(orcid);
        // next-auth Profile expects email as string | undefined, not null
        return {
          ...profile,
          email: profile.email ?? undefined,
        };
      },
    },
    profile(profile: OrcidProfile) {
      return {
        id: profile.orcid,
        name: profile.name,
        email: profile.email,
        image: null,
      };
    },
  };
}

export const authOptions: NextAuthOptions = {
  providers: [OrcidProvider()],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days inactivity expiration per spec
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.provider !== "orcid") return false;

      // user.id is the ORCID (set by the profile() callback above)
      const orcid = user.id;
      if (!orcid) return false;

      const orcidProfile = profile as OrcidProfile | undefined;

      try {
        // Check for existing user by ORCID ID.
        // This handles both returning users and seeded profile claiming.
        const existingUser = await prisma.user.findUnique({
          where: { orcid },
        });

        if (existingUser) {
          // Returning user or claiming a seeded profile.
          // Update name from ORCID in case it changed.
          const updates: Record<string, unknown> = {};
          if (user.name && user.name !== existingUser.name) {
            updates.name = user.name;
          }
          // Update institution/department if available and currently placeholder
          if (
            orcidProfile?.institution &&
            existingUser.institution === "Unknown"
          ) {
            updates.institution = orcidProfile.institution;
          }
          if (orcidProfile?.department && !existingUser.department) {
            updates.department = orcidProfile.department;
          }
          // Mark seeded profiles as claimed on first login
          if (!existingUser.claimedAt) {
            updates.claimedAt = new Date();
          }

          if (Object.keys(updates).length > 0) {
            await prisma.user.update({
              where: { id: existingUser.id },
              data: updates,
            });
          }

          // Per spec: when a seeded profile is claimed, flip pending_other_interest
          // proposals to visible so they appear in the user's swipe queue
          if (!existingUser.claimedAt) {
            flipPendingProposalsOnClaim(prisma, existingUser.id).catch(
              (err) => {
                console.error(
                  "[Auth] Failed to flip pending proposals on claim:",
                  err,
                );
              },
            );
          }
        } else {
          // New user — create account from ORCID data
          const newUser = await prisma.user.create({
            data: {
              email: user.email ?? `${orcid}@orcid.placeholder`,
              name: user.name ?? orcid,
              institution: orcidProfile?.institution ?? "Unknown",
              department: orcidProfile?.department ?? null,
              orcid,
              claimedAt: new Date(),
            },
          });

          // Enqueue match pool expansion so existing users' affiliation/all-users
          // selections automatically include this new user. Fire-and-forget:
          // failures here don't block sign-in.
          getJobQueue()
            .enqueue({ type: "expand_match_pool", userId: newUser.id })
            .catch((err) => {
              console.error(
                "[Auth] Failed to enqueue expand_match_pool:",
                err,
              );
            });
        }

        return true;
      } catch (error) {
        console.error("Error in signIn callback:", error);
        return false;
      }
    },

    async jwt({ token, user, account }) {
      // On initial sign-in, look up the database user by ORCID and store the DB ID in the JWT
      if (user && account?.provider === "orcid") {
        const orcid = user.id;
        const dbUser = await prisma.user.findUnique({
          where: { orcid },
          select: { id: true, orcid: true },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.orcid = dbUser.orcid;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId;
      }
      if (token.orcid) {
        session.user.orcid = token.orcid;
      }
      return session;
    },
  },
};
