@AGENTS.md

# TREND MACHINE — working notes

- Read `README.md` first; architecture, conventions and runbooks live there.
- Rules that must never be broken: no faked generations, metrics, trends or integrations. Truthful failure beats a deceptive demo.
- Provider/vendor code lives only in `src/server/providers/*`; everything else talks to the `GenerationProvider` interface.
- Schema changes = new file in `db/migrations/` (never edit an applied migration).
- Templates are data: edit `content/templates/*.json`, then `npm run db:seed` (creates a new version when content changes).
- Never auto-resubmit a provider job whose submission outcome is ambiguous (`ProviderError.accepted === "UNKNOWN"`).
- Before pushing: `npm run verify` (format, lint, typecheck, tests, build). E2E: `npm run test:e2e` (needs Postgres, see README).
