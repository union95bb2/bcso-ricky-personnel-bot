# Ricky Bot code index

This file is a persistent replacement for a temporary source index. It is safe to upload with the public source package; it contains no credentials or personnel data.

## Runtime path

- `src/index.js` — Discord client, command routing, modals, approval buttons, record posting, health checks, activity tracking, and shutdown/error handling.
- `src/commands.js` — guild slash-command definitions. Run `npm run register` after changing this file.
- `src/cogs/admin-routing.js` — first cog-like feature boundary: owns the channel-routing command definitions, validation, previews, approval, and persistence. It is loaded by the existing JavaScript runtime without changing the bot language.
- `src/config.js` — protected environment configuration plus runtime override loading and persistence.
- `src/runtime-config.js` — allow-listed channel settings, Discord-ID validation, and atomic `data/runtime-config.json` read/write helpers.
- `src/promotion-cases.js` — pure promotion-case check state machine for time-in-rank, hours, PSD review, completion, and reopen behavior.
- `src/workflow-spec.js` — command coverage, admin/PAB/self-service classification, workflow requirements, and destination checks.
- `src/pending-actions.js` — durable approval previews, expiry countdowns, renewals, and fail-closed claims.
- `src/permissions.js` — channel/member/role hierarchy checks used before writes.
- `src/record-destinations.js` — text-channel fallback and optional Forum/member-thread routing.
- `src/store.js` — private SQLite receipt/activity ledger (`data/pab.sqlite`).
- `src/store.js` also persists promotion cases and their append-only event history in `promotion_cases` and `promotion_case_events`.
- `src/rms/` — optional Phase 2 RMS SQLite store and dashboard integration.

## Administrator routing controls

`/config-channel` changes one allow-listed channel destination after Discord validates guild, channel type, and bot permissions. `/config-activity` adds or removes an approved activity-source channel. Both are server-administrator-only, use a confirmation button with a visible expiry countdown, append a configuration audit event, and write only to `data/runtime-config.json`. Tokens, role IDs, rank maps, and award allow-lists remain protected environment configuration. The feature is implemented as a JavaScript cog-like module so future features can be added or disabled as independent units; a Python rewrite is not required.

## Tests and operations

- `test/commands.test.js` — slash-command and workflow coverage, including routing command choices.
- `test/runtime-config.test.js` — persistence round-trip for runtime overrides.
- `test/` — formatting, permissions, pending-action, rank-matrix, RMS, and integration regression tests.
- `scripts/` — preflight, registration, deployment, role-style audit, and RMS utilities.
- `README.md` — operator overview and setup.
- `ADMIN_HANDOFF.md` — server-owner installation, permission matrix, backups, and incident procedure.
- `.env.example`, `.env.sandbox.example`, `.env.demo.example` — non-secret configuration templates.

## Local-only paths (do not upload)

`.env`, `data/`, `node_modules/`, `.git/`, `tmp/`, and generated output contain credentials, private records, dependencies, or deployment artifacts. The source upload package excludes them.
