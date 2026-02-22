# AGENT.md — CoPI Development Guide

## Project Overview

CoPI (copi.science) is a web application that proposes scientific collaborations between academic researchers. It uses LLM-powered matching to generate specific, synergistic collaboration proposals based on researcher profiles built from publications, grants, and user-submitted content. Users evaluate proposals via a Tinder-style swipe interface and get notified on mutual interest.

## Tech Stack

- **Frontend:** Next.js + TypeScript + Tailwind CSS
- **Backend:** Next.js API routes + Prisma ORM
- **Database:** PostgreSQL (via Docker for local dev)
- **Job Queue:** AWS SQS (or in-process queue for local dev)
- **Auth:** ORCID OAuth 2.0
- **LLM:** Claude API (Opus) via Anthropic SDK
- **Email:** AWS SES

## Project Structure

```
copi/
├── specs/              # Application specifications (READ THESE FIRST)
├── prompts/            # LLM prompts for profile synthesis and matching engine
├── prisma/
│   └── schema.prisma   # Database schema
├── src/
│   ├── app/            # Next.js app router pages
│   │   ├── onboarding/ # Onboarding UI (client component with progress polling)
│   │   └── api/onboarding/  # Onboarding API (generate-profile, profile-status)
│   │   ├── api/profile/ # Profile API (GET/PUT profile, GET/PUT submitted-texts)
│   │   ├── api/match-pool/     # Match pool APIs (GET pool, DELETE entry, GET search, POST add)
│   │   ├── profile/edit/ # Profile edit page (post-onboarding)
│   │   ├── profile/submitted-texts/ # User-submitted text management page
│   ├── components/     # React components (TagInput, SignOutButton, Providers)
│   ├── lib/            # Shared utilities, API clients, auth config
│   ├── services/       # Business logic (profile pipeline, matching engine, notifications)
│   └── worker/         # Background job processor
├── docker-compose.yml  # Local development environment
├── Dockerfile          # App container
├── .env.example        # Environment variable template
├── AGENT.md            # This file
├── PROMPT.md           # Ralph loop prompt
└── fix_plan.md         # Current task list
```

## How to Build and Run

### Prerequisites
- Node.js 20+
- Docker and Docker Compose
- ORCID OAuth credentials (for auth testing)
- Anthropic API key (for LLM features)
- NCBI API key (for PubMed and PMC ID Converter, optional but recommended)

### Local Development

```bash
# Start database
docker-compose up -d postgres

# Install dependencies
npm install

# Run migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Start dev server
npm run dev

# Start worker (in separate terminal)
npm run worker
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- path/to/test.test.ts

# Run with coverage
npm run test:coverage
```

> **Note:** In non-interactive shells (scripts, tools that don't source your shell profile), `npm test` and `npx jest` will fail because nvm is not loaded. Source nvm first:
> ```bash
> source ~/.nvm/nvm.sh && npx jest src/lib/__tests__/orcid.test.ts
> ```

### Database Operations

```bash
# Create a migration after schema changes
npx prisma migrate dev --name description_of_change

# Reset database (destructive)
npx prisma migrate reset

# Open Prisma Studio (database browser)
npx prisma studio
```

### Linting

```bash
npm run lint
npm run type-check
```

## Environment Notes

1. **WSL2 (Ubuntu 24.04).** This project runs inside WSL2, not native Windows.
2. **Docker via Docker Desktop.** Use `docker.exe` (Docker Desktop on Windows with WSL integration), not `docker` directly.
3. **Node.js via nvm.** Node is installed through nvm, not the Windows Node. All npm/node commands must source nvm first:
   ```bash
   export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   ```
4. **Runtime versions:** Node v20.20.0, npm 10.8.2.
5. **ts-node is required** as a devDependency for Jest TypeScript config (`jest.config.ts`).
6. **next-auth v4** is used with the JWT session strategy. Session augmentation types are in `src/types/next-auth.d.ts`.
7. **fast-xml-parser** is used to parse PubMed E-utilities XML responses (efetch, db=pubmed). Configured with `isArray` for elements that can appear 0-N times (Author, AbstractText, etc.) and `ignoreAttributes: false` to access ArticleId IdType attributes. For PMC full-text XML (efetch, db=pmc), raw XML pattern matching with balanced tag extraction is used instead (`pmc.ts`) to preserve text ordering in mixed-content JATS XML elements. PMC uses a batch size of 10 (vs PubMed's 200) due to larger full-text response sizes.

## Key Design Decisions

1. **ORCID OAuth is the only auth method.** No email/password.
2. **User-submitted texts are NEVER shown to other users.** They inform profile synthesis and matching only.
3. **Direct profile editing is allowed.** Monthly refresh generates candidate profiles; user approves before overwrite.
4. **Match pool cap is 200 users per cycle.** Individual selections always prioritized.
5. **Matching engine uses Claude Opus.** Prompts are in `prompts/` directory.
6. **Proposals can be multiple per pair** but max 3 per LLM call.
7. **No bias signals in swipe UI.** Users don't see if the other party swiped.
8. **ORCID OAuth uses next-auth v4** with a custom provider. The config is in `src/lib/auth.ts`. ORCID's token endpoint returns `orcid` and `name` directly in the token response (non-standard). The custom token handler captures these fields and passes them to the userinfo handler which fetches full profile (email, institution) from the ORCID API.
9. **Member vs Public ORCID API**: When an access token is provided (from OAuth with /read-limited scope), the member API (api.orcid.org) is used. Without a token, the public API (pub.orcid.org) is used. Sandbox mode is toggled via `ORCID_SANDBOX=true` env var.
10. **Route protection** is handled by next-auth middleware (`src/middleware.ts`). All routes except `/login`, `/api/auth/*`, and static assets require authentication.

11. **LLM prompt architecture:** Each LLM prompt has two parts: (a) a markdown file in `prompts/` documenting the prompt design, validation rules, and implementation notes; (b) a TypeScript module in `src/lib/` (e.g., `profile-synthesis-prompt.ts`) providing functions to assemble the user message from input data, parse LLM output (handling code fences, trailing commas, deduplication), validate output against field requirements, and generate retry prompts when validation fails. The service layer in `src/services/` uses these modules to make the actual LLM API calls. The Anthropic SDK client is initialized as a singleton in `src/lib/anthropic.ts` (following the same pattern as Prisma in `src/lib/prisma.ts`) and injected into service functions for testability. Services handle the full LLM lifecycle: building messages, calling Claude, parsing/validating output, and retrying on validation failure per spec guidance.

12. **Profile pipeline orchestration** (`src/services/profile-pipeline.ts`): Coordinates the full ingestion pipeline. Takes `PrismaClient` and `Anthropic` client as injected dependencies for testability. Pipeline steps: (1) ORCID profile/grants/works fetched in parallel, (2) DOI-only works resolved to PMIDs via NCBI ID Converter, (3) PubMed abstracts batch-fetched, (4) PMC methods sections deep-mined with rate-limited batching, (5) Publication records stored (full refresh: delete-then-create), (6) SHA-256 abstracts hash computed for change detection, (7) LLM synthesis called, (8) ResearcherProfile created/updated with version bump. Inter-call NCBI rate limiting is enforced via delays (110ms with API key, 350ms without). PMC batching is done at the pipeline level (batch size 10 with delays) rather than relying on the client's internal batching. The pipeline exports helper functions (`extractLastName`, `computeAbstractsHash`, `parseUserSubmittedTexts`, `getNcbiDelayMs`) for unit testing.

13. **Testing with fake timers:** Pipeline tests use `jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync()` to avoid real delay waits. The pattern wraps `runProfilePipeline()` in a helper that advances timers by 10 seconds (enough to cover all NCBI delays). This makes the 30-test suite run in <0.3s instead of ~20s.

14. **Onboarding flow and pipeline progress tracking:** Pipeline progress is tracked via an in-memory status store (`src/lib/pipeline-status.ts`) keyed by userId, suitable for single-server pilot. The pipeline supports an `onProgress` callback in `PipelineOptions` that the API route uses to update status at each stage. API routes: `POST /api/onboarding/generate-profile` triggers the pipeline asynchronously (fire-and-forget), `GET /api/onboarding/profile-status` returns the current stage for UI polling. The home page (`src/app/page.tsx`) is a server component that checks for ResearcherProfile existence and redirects to `/onboarding` if none. The onboarding page (`src/app/onboarding/page.tsx`) is a client component that polls for status every 2 seconds and shows animated progress steps. On completion, the onboarding page redirects to `/onboarding/review` for profile review/editing.

15. **Profile API and review page:** `GET /api/profile` returns the authenticated user's researcher profile fields including `userSubmittedTexts`. `PUT /api/profile` validates and updates editable fields (researchSummary, techniques, experimentalModels, diseaseAreas, keyTargets, keywords) with the same constraints as LLM synthesis validation (150–250 word summary, ≥3 techniques, ≥1 disease area, ≥1 key target). PUT bumps `profileVersion` and updates `profileGeneratedAt`. The review page (`src/app/onboarding/review/page.tsx`) uses a TagInput component for array fields (add/remove chips) and a textarea for the research summary. Grant titles are displayed read-only. The "Looks Good" / "Save & Continue" button only calls PUT if the user made edits, avoiding unnecessary version bumps.

16. **Shared TagInput component:** `src/components/tag-input.tsx` is a reusable chip/tag list editor used by both the onboarding review page and the profile edit page. Supports add (Enter key or button), remove, case-insensitive duplicate prevention, and optional minimum item count validation.

17. **Profile edit page** (`src/app/profile/edit/page.tsx`): Standalone profile editing accessible from the main app home page after onboarding. Uses the same `PUT /api/profile` endpoint as onboarding review. Differences from onboarding: has back navigation to home, "Save Changes" / "Discard Changes" flow (instead of "Looks Good"), shows save success confirmation inline, and displays profile version metadata. Also includes a "Refresh Profile" button that triggers `POST /api/profile/refresh` to re-run the full pipeline (ORCID → PubMed → PMC → synthesis) and polls `GET /api/profile/refresh-status` for progress. The refresh button is disabled while the form has unsaved edits.

18. **React component testing:** Jest is configured with `jsx: "react-jsx"` override in `jest.config.ts` (overriding tsconfig's `jsx: "preserve"`) to support JSX transformation in tests. Component tests use `@jest-environment jsdom` directive, `@testing-library/react`, and `@testing-library/jest-dom`. Both packages plus `jest-environment-jsdom` are in devDependencies.

19. **User-submitted text management:** `GET/PUT /api/profile/submitted-texts` manages the JSONB array of user-submitted texts on ResearcherProfile. Validation: max 5 entries, each must have non-empty label and content, content max 2000 words. PUT replaces the entire array; timestamps are preserved for unchanged entries (matched by label+content). The management UI is at `/profile/submitted-texts` (add/edit/delete with inline forms, word counter, privacy notice). The profile edit page (`/profile/edit`) links to the submitted texts page with a "Manage" button showing the current count. Prisma JSONB fields require casting to `Prisma.InputJsonValue` when writing typed arrays. Re-synthesis trigger on text modification is deferred to the profile refresh task.

20. **Manual profile refresh:** `POST /api/profile/refresh` triggers a full pipeline re-run for users who already have a profile. Unlike the onboarding endpoint (which requires NO profile), this requires an existing profile. Uses the same `runProfilePipeline` and `pipeline-status` infrastructure as onboarding. `GET /api/profile/refresh-status` provides polling for refresh progress — unlike the onboarding status endpoint, it does NOT short-circuit when a profile exists in the database (since profile always exists during refresh), instead returning the actual in-memory pipeline status or `{ stage: "idle" }` when no refresh is running.

21. **React component testing with unstable router mock:** The `next/navigation` `useRouter()` mock returns a new object on every render, making the `router` reference unstable. If `router` is used as a `useCallback` dependency, the callback is recreated every render, potentially causing `useEffect` infinite loops. Keep `fetchProfile` inline in the useEffect (as the original pattern) rather than extracting it to a `useCallback` with `router` dependency. Use a separate `reloadProfile` callback (with no `router` dependency) for post-refresh profile reloading.

22. **Match pool management page:** `GET /api/match-pool` returns match pool entries with target user details (name, institution, department), affiliation selections, `totalCount`, and a cap of 200. `DELETE /api/match-pool/[entryId]` removes a single entry after ownership verification (returns 204). The management UI at `/match-pool/page.tsx` is a client component showing current pool entries with source badges, a stats bar with the 200-cap indicator, affiliation selection summary, entry removal with inline confirmation, and a contextual empty state. The page supports a `?onboarding=1` query parameter for the onboarding flow variant, which shows a different heading, requirement messaging, and a Continue button that is disabled until the pool is non-empty. The onboarding flow now routes: profile review → `/match-pool?onboarding=1` → home. The home page (`page.tsx`) enforces match pool setup by checking for both `MatchPoolEntry` and `AffiliationSelection` counts before allowing access. For Next.js 15 dynamic API routes with brackets (e.g., `[entryId]`), tests must live inside the bracketed directory's `__tests__/` folder since Jest can't resolve bracket paths from outside. The route handler receives `params` as a Promise (Next.js 15 convention).

23. **Match pool user search and individual selection:** `GET /api/match-pool/search?q=<query>` searches users by name or institution (case-insensitive, Prisma `contains` with `mode: "insensitive"`), excludes the current user, returns up to 20 results ordered by name, and includes profile preview data (researchSummary, techniques, diseaseAreas, keyTargets — never user-submitted texts per spec). Each result includes an `inMatchPool` boolean checked efficiently via a single batch query on the returned user IDs. `POST /api/match-pool/add` creates a MatchPoolEntry with `source: "individual_select"` after validating: auth, non-self, target exists, not duplicate (uses compound unique `userId_targetUserId`). The match pool page (`/match-pool`) integrates search with a debounced input (300ms), expandable profile previews, inline "Add"/"Added" state, and auto-refreshes the pool after additions.

## Specifications

All specs are in the `specs/` directory. READ THEM before making changes:
- `specs/data-model.md` — Database entities and relationships
- `specs/auth-and-user-management.md` — Auth, signup, profile management, match pools
- `specs/profile-ingestion.md` — Publication fetching and profile synthesis pipeline
- `specs/matching-engine.md` — Collaboration proposal generation
- `specs/swipe-interface.md` — Swipe UI, matching flow, archive, surveys
- `specs/notifications.md` — Email notifications
- `specs/tech-stack.md` — Infrastructure and deployment
