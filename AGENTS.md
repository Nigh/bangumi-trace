# AGENTS.md

## Project structure

- `src/` contains the Astro/Svelte PWA.
- `worker/` contains the Cloudflare Worker that owns GitHub OAuth, data storage, and Bangumi API access.
- Personal viewing data belongs only in each user's private `bangumi-trace-data` repository. Never commit real account data, tokens, repository identifiers, or migration exports here.

## Development

Use the existing dependencies and keep changes small. Do not add abstractions or packages when the platform or an existing helper already covers the requirement.

```sh
npm ci
npm run check
npm test
npm run build
cd worker
npm ci
npm run check
npm test
```

The persisted JSON schema is deliberately versioned. Frontend types and Worker validation must change together, and watch events must reference an existing show and volume.

## Git workflow

- Work on a topic branch and merge through a pull request.
- Commit the smallest independently testable change.
- Do not commit `.env`, `.dev.vars`, local handoff files, `data/`, generated output, or personal exports.
