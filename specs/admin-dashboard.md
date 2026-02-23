# Admin Dashboard Specification

## Overview

A read-only admin dashboard for monitoring platform activity and inspecting data. Accessible only to designated admin users via a web UI at `/admin`. This is a pilot-scale tool — it prioritizes visibility into what's happening over bulk management operations.

## Access Control

### Admin Role

Add an `isAdmin` boolean field to the User model (default: `false`). Set via direct database update or a CLI command — there is no self-service way to become an admin.

### Route Protection

- All `/admin/*` routes require an authenticated session where the user has `isAdmin = true`
- Non-admin users who navigate to `/admin` see a 403 page
- The admin dashboard link is only visible in the nav/header for admin users

## Dashboard Pages

### 1. Users Overview (`/admin/users`)

The default admin landing page. A table of all users, sortable and filterable.

**Table Columns:**
- Name
- Institution
- Department
- ORCID (linked to orcid.org)
- Profile status: `no_profile` | `generating` | `complete` | `pending_update`
- Publication count
- Match pool size (number of entries)
- Proposals generated (count of proposals where this user is researcher A or B)
- Joined date (`createdAt`)
- Claimed (`claimedAt` — null for unclaimed seeded profiles)

**Filters:**
- Profile status
- Institution
- Claimed vs. unclaimed (seeded)

**Row click** → navigates to user detail page.

### 2. User Detail (`/admin/users/[id]`)

Full view of a single user's data.

**Sections:**

**Profile:**
- All ResearcherProfile fields: research summary, techniques, experimental models, disease areas, key targets, keywords
- Grant titles
- Profile version and generation timestamp
- Pending profile (if any)

**Publications:**
- List of all publications with title, journal, year, author position, PMID/DOI links
- Whether methods text was extracted

**Match Pool:**
- Their match pool entries (who they selected)
- Their affiliation selections
- Who has selected them (reverse lookup)

**Proposals:**
- All proposals involving this user (as researcher A or B)
- Show: other researcher name, proposal title, confidence tier, visibility for this user, swipe status
- Link to proposal detail

### 3. Proposals Overview (`/admin/proposals`)

A table of all collaboration proposals.

**Table Columns:**
- Researcher A name
- Researcher B name
- Title
- Collaboration type
- Confidence tier
- Visibility A / Visibility B
- Swipe A / Swipe B (interested, archive, or not yet swiped)
- Matched (yes/no)
- Created date

**Filters:**
- Confidence tier
- Match status (matched / unmatched)
- Swipe status (both swiped, one swiped, neither swiped)
- Visibility state

**Row click** → navigates to proposal detail page.

### 4. Proposal Detail (`/admin/proposals/[id]`)

Full read-only view of a single proposal — all fields:

- Title, collaboration type, scientific question
- One-line summaries (A and B versions)
- Detailed rationale
- Lab A/B contributions and benefits
- Proposed first experiment
- Anchoring publications (linked)
- Confidence tier
- LLM reasoning
- LLM model used
- Visibility states (A and B)
- Swipe records (who swiped what, when, viewed detail, time spent)
- Match record (if matched)
- Profile versions at generation time

### 5. Matching Stats (`/admin/stats`)

Aggregate statistics on the matching pipeline.

**Summary Cards:**
- Total users (claimed vs. seeded)
- Total proposals generated
- Total matches (mutual interest)
- Overall proposal generation rate (pairs with proposals / pairs evaluated)

**Matching Results Table:**
- All `MatchingResult` records: researcher A, researcher B, outcome, profile versions, evaluated date
- Filters: outcome (proposals_generated / no_proposal)
- Sortable by date

**Funnel Visualization (simple text/numbers, not a chart):**
- Eligible pairs evaluated → proposals generated → at least one "interested" swipe → mutual matches
- Show counts and conversion rates at each stage

## Design Principles

- **Read-only.** No edit/delete/trigger actions in v1. Admin actions stay in the CLI.
- **Server-rendered.** Use Next.js server components — no client-side data fetching needed.
- **Minimal styling.** Use the existing Tailwind setup. Tables with basic styling. No charts library — just numbers and text.
- **No pagination in v1.** For pilot scale (tens to low hundreds of users), load all data. Add pagination later if needed.

## API Routes

All admin API routes live under `/api/admin/*` and check `isAdmin` on the session.

| Route | Purpose |
|---|---|
| `GET /api/admin/users` | List all users with profile status and counts |
| `GET /api/admin/users/[id]` | Full user detail with profile, publications, match pool, proposals |
| `GET /api/admin/proposals` | List all proposals with swipe/match status |
| `GET /api/admin/proposals/[id]` | Full proposal detail with swipes, match, LLM reasoning |
| `GET /api/admin/stats` | Aggregate matching stats and funnel data |

## Data Model Changes

Add to the User model:

```
isAdmin  Boolean @default(false) @map("is_admin")
```

## CLI Addition

Add a command to grant/revoke admin access:

```bash
npm run admin:grant -- <ORCID>
npm run admin:revoke -- <ORCID>
```

## Out of Scope (v1)

- Edit or delete users/proposals from the admin UI
- Trigger profile regeneration or matching from the admin UI
- Job queue monitoring
- Email delivery history
- Real-time updates or websockets
- Charts or graphs (just numbers and tables)
- Export to CSV
