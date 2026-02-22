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
│   ├── components/     # React components
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
- NCBI API key (for PubMed, optional but recommended)

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

## Key Design Decisions

1. **ORCID OAuth is the only auth method.** No email/password.
2. **User-submitted texts are NEVER shown to other users.** They inform profile synthesis and matching only.
3. **Direct profile editing is allowed.** Monthly refresh generates candidate profiles; user approves before overwrite.
4. **Match pool cap is 200 users per cycle.** Individual selections always prioritized.
5. **Matching engine uses Claude Opus.** Prompts are in `prompts/` directory.
6. **Proposals can be multiple per pair** but max 3 per LLM call.
7. **No bias signals in swipe UI.** Users don't see if the other party swiped.

## Specifications

All specs are in the `specs/` directory. READ THEM before making changes:
- `specs/data-model.md` — Database entities and relationships
- `specs/auth-and-user-management.md` — Auth, signup, profile management, match pools
- `specs/profile-ingestion.md` — Publication fetching and profile synthesis pipeline
- `specs/matching-engine.md` — Collaboration proposal generation
- `specs/swipe-interface.md` — Swipe UI, matching flow, archive, surveys
- `specs/notifications.md` — Email notifications
- `specs/tech-stack.md` — Infrastructure and deployment
