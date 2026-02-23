# Fix Plan — CoPI Development

## Phase 1: Foundation

- [x] Initialize Next.js project with TypeScript and Tailwind CSS
- [x] Set up Docker Compose with PostgreSQL
- [x] Define Prisma schema matching specs/data-model.md
- [x] Run initial migration
- [x] Set up ESLint and TypeScript strict mode
- [x] Create .env.example with all required environment variables
- [x] Set up basic project structure (app/, components/, lib/, services/, worker/)

## Phase 2: Authentication

- [x] Configure ORCID OAuth 2.0 (using next-auth or custom)
- [x] Implement login page with "Sign in with ORCID" button
- [x] Handle first-time login (create User record from ORCID data)
- [x] Handle returning login (match existing User by ORCID ID)
- [x] Handle seeded profile claiming (match seeded User record)
- [x] Implement session management with secure cookies
- [x] Protect all routes except login

## Phase 3: Profile Pipeline

- [x] Implement ORCID API client (fetch profile, grants, works)
- [x] Implement PubMed API client (fetch abstracts by PMID, batch)
- [x] Implement PMC client for deep mining (methods section extraction)
- [x] Implement NCBI ID converter client (PMID ↔ PMCID)
- [x] Build profile synthesis LLM prompt (store in prompts/profile-synthesis.md)
- [x] Implement profile synthesis service (assemble context, call Claude, parse output)
- [x] Implement profile validation (word count, minimum fields)
- [x] Implement full pipeline orchestration (ORCID → PubMed → synthesis → store)
- [x] Build onboarding UI: profile generation progress indicator
- [x] Build onboarding UI: profile review/edit page
- [x] Build profile edit page (direct editing of all synthesized fields)
- [x] Build user-submitted text management UI (add/edit/delete, max 5)
- [x] Implement profile refresh (manual trigger)
- [x] Implement monthly refresh cron job (detect new publications, generate candidate, notify)
- [x] Build side-by-side profile comparison UI for refresh candidates

## Phase 4: Match Pool

- [x] Build match pool management page
- [x] Implement user search (by name, institution)
- [x] Implement profile preview in search results (excluding user-submitted texts)
- [x] Implement individual user selection (add/remove from match pool)
- [x] Implement affiliation selection (institution/department filter, dynamic expansion)
- [x] Implement "all users" selection (dynamic expansion)
- [x] Implement match pool cap logic (200 cap, priority ordering)
- [x] Store AffiliationSelection records
- [x] Auto-expand match pools when new users join (check affiliation selections and all-users flags)
- [x] Build match pool view (show who's in it, how added, remove option)
- [x] Enforce match pool setup as required step before showing main app

## Phase 5: Matching Engine

- [x] Build matching engine LLM prompt with few-shot examples (store in prompts/matching-engine.md)
- [x] Implement eligible pair computation (mutual selection + incoming logic)
- [x] Implement visibility assignment logic
- [x] Implement context assembly per pair (profiles, abstracts, existing proposals)
- [x] Implement abstract selection (up to 10 per researcher, prioritized by author position/recency/type)
- [x] Implement LLM call with structured JSON output parsing
- [x] Implement output validation (required fields, discard invalid)
- [x] Implement de-duplication against existing proposals
- [x] Implement MatchingResult tracking (avoid redundant evaluations)
- [x] Implement job queue integration (SQS or in-process for dev)
- [x] Implement matching triggers (match pool change, profile update, scheduled)
- [x] Implement error handling and retry logic

## Phase 6: Swipe Interface

- [x] Build swipe queue page with card UI
- [x] Implement summary card (collaborator info, type, one-line summary, confidence indicator)
- [x] Implement detail expansion (rationale, contributions, benefits, first experiment, publications)
- [x] Implement "Interested" swipe action with match detection
- [x] Implement "Archive" swipe action
- [x] Implement visibility state transitions (pending_other_interest → visible on interested swipe)
- [x] Build archive tab (view archived proposals, move back to interested)
- [x] Build matches tab (full proposal, profiles, contact info per email_visibility setting)
- [x] Implement empty states for all tabs
- [x] Implement periodic survey (every Nth archive, multi-select failure modes)
- [x] Track swipe analytics (viewed_detail, time_spent_ms)

## Phase 7: Notifications

- [x] Set up AWS SES email sending
- [x] Implement match notification email (immediate)
- [x] Implement new proposals digest email (weekly batch)
- [x] Implement profile refresh notification email
- [x] Implement unclaimed profile recruitment email (with rate limiting)
- [x] Implement user-facing invite template for unclaimed profiles
- [x] Build notification preferences in settings
- [x] Implement unsubscribe link handling

## Phase 8: Admin and Settings

- [x] Build settings page (email visibility, incoming proposals toggle, notification prefs)
- [x] Implement account deletion (with proposal preservation logic)
- [x] Build admin CLI or panel for seeding profiles by ORCID ID list
- [x] Implement seeded profile pipeline (create user + run pipeline without OAuth)

## Phase 9: Deployment

- [x] Create Dockerfile for the app
- [x] Create Docker Compose for production (app + worker + postgres)
- [x] Create health check endpoint
- [ ] Configure HTTPS (Let's Encrypt)
- [ ] Set up DNS for copi.sulab.org
- [ ] Deploy to EC2 instance
- [ ] Configure environment variables
- [ ] Set up CloudWatch logging
- [ ] Test full flow end-to-end on deployed instance

## Notes

- Phases can overlap. Phase 1-2 are prerequisites for everything else.
- Phase 3 and 4 can be developed in parallel.
- Phase 5 depends on Phase 3 (profiles) and Phase 4 (match pools).
- Phase 6 depends on Phase 5 (proposals to display).
- Phase 7 can be partially developed in parallel with Phase 6.
- PubMed client (`pubmed.ts`) does not send `tool` or `email` parameters on E-utilities requests, unlike the ID converter and PMC clients. Should be harmonized per NCBI API guidelines.
- ~~PubMed client (`pubmed.ts`) has a pre-existing TypeScript strict error on line 184~~ — Fixed with type narrowing check for `citation.PMID`.
- Pipeline orchestration (`profile-pipeline.ts`) adds inter-call NCBI rate limiting delays (350ms without API key, 110ms with key) between distinct API calls. Individual clients' internal batch processing still lacks inter-batch delays for researchers with 400+ publications; adding HTTP-level retry/backoff for 429 errors remains a future enhancement.
- Pipeline handles zero-publication researchers: synthesis still runs with grants + user-submitted texts.
- Pipeline stores DOI-only ORCID works that can't resolve to PMIDs as minimal Publication records (empty abstract, middle author position).
- Profile synthesis edge cases (large input contexts, empty data, deduplication casing) are not fully addressed yet — monitor during real-world usage.
- Array deduplication in output parsing is case-insensitive but preserves original case of first occurrence. If LLM outputs near-duplicates with different casing, only one is kept silently.
- Retry prompt includes current error counts but message text may appear identical on repeated failures. Consider logging counts or adding retry attempt number to distinguish iterations.
- User-submitted text management: the spec requires re-synthesis when texts are added/modified. This trigger should be implemented as part of the "Implement profile refresh (manual trigger)" task. Currently, saving texts only updates the JSONB field; the user must manually refresh their profile for changes to take effect in synthesis.
- ~~Swipe queue page currently uses Previous/Next navigation buttons as temporary placeholders for browsing proposals.~~ Replaced by Interested/Archive swipe action buttons with match detection, visibility transitions, and analytics tracking (viewedDetail, timeSpentMs).
- Monthly refresh currently runs per-user via `monthly_refresh` queue jobs. The recurring scheduler that enqueues these jobs for all users on a configurable cadence is still pending infrastructure wiring.
- ~~Route files exported non-HTTP constants (`SURVEY_INTERVAL` in swipe route, `VALID_FAILURE_MODES` in survey route) which are invalid in Next.js App Router and caused `next build` to fail~~ — Fixed by removing `export` keyword (constants are only used within their route files).
- ~~`match-pool/page.tsx` used `useSearchParams()` without a Suspense boundary, causing prerender failure during `next build` with `output: "standalone"`~~ — Fixed by wrapping in Suspense.
- ~~`unsubscribe-token.ts` had a TypeScript strict-mode error (array index access returning `string | undefined` under `noUncheckedIndexedAccess`) that only manifested during standalone builds~~ — Fixed with non-null assertions after length guard.
- ~~`proposals-digest.ts` `selectTopProposal()` had a similar `noUncheckedIndexedAccess` issue with `sort(...)[0]` returning `T | undefined`~~ — Fixed with non-null assertion (callers guarantee non-empty array).
