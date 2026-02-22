# CoPI — Collaborative PI Matching

CoPI proposes specific, synergistic research collaborations between academic researchers. It builds researcher profiles from publications and grants, uses LLM-powered matching to generate collaboration proposals with concrete first experiments, and connects interested parties via a swipe interface.

**Website:** [copi.science](https://copi.science)

## How It Works

1. **Sign in with ORCID** — your publications and grants are pulled automatically
2. **Review your profile** — edit if needed, add current interests or grant aims
3. **Build your match pool** — select colleagues, departments, or institutions
4. **Swipe on proposals** — the matching engine suggests specific collaborations
5. **Get notified on mutual interest** — when both parties are interested, you're connected

## Development

See [AGENT.md](./AGENT.md) for setup and development instructions.

## Specifications

All application specs are in the `specs/` directory:
- [Data Model](./specs/data-model.md)
- [Auth & User Management](./specs/auth-and-user-management.md)
- [Profile Ingestion](./specs/profile-ingestion.md)
- [Matching Engine](./specs/matching-engine.md)
- [Swipe Interface](./specs/swipe-interface.md)
- [Notifications](./specs/notifications.md)
- [Tech Stack](./specs/tech-stack.md)
