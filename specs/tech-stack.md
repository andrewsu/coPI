# Tech Stack and Infrastructure Specification

## Overview

CoPI is a Next.js web application deployed on AWS. PostgreSQL database, async job queue, ORCID OAuth authentication, Claude Opus for LLM operations.

## Frontend

- **Framework:** Next.js with TypeScript
- **Styling:** Tailwind CSS
- **Swipe UI:** React swipe gesture library (react-tinder-card or similar)
- **Key pages:**
  - Login (ORCID OAuth redirect)
  - Onboarding (profile review, match pool setup)
  - Swipe queue (main interface)
  - Archive tab
  - Matches tab
  - Profile view/edit
  - Match pool management
  - Settings

## Backend

- **API:** Next.js API routes for request-response operations
- **ORM:** Prisma with PostgreSQL
- **Auth:** ORCID OAuth 2.0 (next-auth or custom implementation)
- **Worker:** Separate process for long-running jobs (profile generation, matching engine, email sending)

## Database

- **PostgreSQL** on AWS RDS
- **ORM:** Prisma — declarative schema, type-safe queries, migration management
- Array fields (techniques, disease_areas, etc.) stored as Postgres array columns
- JSONB for user_submitted_texts and pending_profile
- Smallest RDS instance sufficient for pilot

## Job Queue

- **AWS SQS** for async job processing
- **Job types:**
  - `generate_profile` — run profile ingestion pipeline for a user
  - `run_matching` — evaluate a specific pair (researcher_a_id, researcher_b_id)
  - `send_email` — send a notification email
  - `monthly_refresh` — check for new publications for a user
  - `expand_match_pool` — add new user to existing affiliation/all-users selections
- **Worker process** polls SQS and executes jobs
- At pilot scale (20 users), jobs complete in seconds to minutes

## LLM

- **Provider:** Anthropic Claude API
- **Model:** Claude Opus for both profile synthesis and matching engine
- **Prompts:** Stored as text files in the repo (`prompts/profile-synthesis.md`, `prompts/matching-engine.md`) for easy editing without code changes
- **API key:** Stored as environment variable

## External APIs

| API | Purpose | Auth |
|---|---|---|
| ORCID OAuth | User authentication | OAuth 2.0 client credentials |
| ORCID Public API | Profile, grants, works | No auth needed for public data |
| PubMed E-utilities | Abstracts, article metadata | API key recommended (10 req/sec vs 3 req/sec) |
| PMC E-utilities | Full-text methods sections | Same API key as PubMed |
| NCBI ID Converter | PMID ↔ PMCID conversion | No auth |
| Claude API | Profile synthesis, matching engine | API key |
| AWS SES | Transactional email | AWS credentials |

## Email

- **AWS SES** for transactional email
- HTML emails with inline styles
- Sender: notifications@copi.science
- Reply-to: noreply@copi.science
- Unsubscribe link in every email

## Hosting and Deployment

### Pilot (Recommended)

Single EC2 instance running everything via Docker Compose:

```
docker-compose.yml:
  - app (Next.js)
  - worker (job processor)
  - postgres (database)
```

- Instance type: t3.small or t3.medium (sufficient for 20 users)
- One box, SSH in when something breaks
- Simple to reason about, simple to redeploy
- Cost: ~$15-30/month

### Scaling Path

When ready to scale beyond pilot:
- Move Postgres to AWS RDS
- Move app to AWS ECS (Fargate) — serverless containers
- Worker process as separate ECS service
- SQS remains the job queue
- Add CloudFront for static assets if needed

## DNS and Domain

- Primary domain: copi.science
- For pilot: copi.sulab.org (CNAME to EC2 instance)
- HTTPS via Let's Encrypt (certbot) or AWS Certificate Manager

## Environment Variables

```
# ORCID OAuth
ORCID_CLIENT_ID=
ORCID_CLIENT_SECRET=
ORCID_REDIRECT_URI=

# Database
DATABASE_URL=postgresql://...

# Claude API
ANTHROPIC_API_KEY=

# AWS
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
SES_FROM_EMAIL=notifications@copi.science

# NCBI
NCBI_API_KEY=

# App
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

For pilot: environment variables on the EC2 instance or in a `.env` file.
For production: AWS Secrets Manager.

## Monitoring

### Pilot
- CloudWatch logs for app and worker
- Basic health check endpoint (`/api/health`)
- Manual monitoring

### Later
- Sentry for error tracking
- CloudWatch alarms for worker failures
- Uptime monitoring (e.g., UptimeRobot)

## Development Workflow

- GitHub repo
- Main branch is deployable
- Docker Compose for local development (mirrors production)
- Prisma migrations for schema changes
- Prompts stored as markdown files, editable without code changes
