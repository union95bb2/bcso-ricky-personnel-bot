# BCSO Demo Server Clone Blueprint

This file is the exact non-production clone plan for `BCSO Bot Demo | TEST ONLY`. It is the operating checklist to keep the server structure visually familiar while avoiding any real BCSO data.

Current server name: **BCSO Bot Demo | TEST ONLY**
Guild ID: `1539383172536467516`

## 1) Core structure already created

Use this baseline first and never remove these IDs in case we need to return to the exact state.

### Categories and channels
- PUBLIC AFFAIRS | INFORMATION
  - `#welcome`
  - `#guidelines`
  - `#ncrp-quick-links`
  - `#penal-code`
  - `#reaction-roles`
  - `#bcso-tickets`
- BCSO | GENERAL
  - `#dept-announcements`
  - `#dept-changelog`
  - `#go-on-duty`
  - `#roll-call`
  - `#bcso-general`
  - `#reports`
  - `#bot-command`
- BCSO | OTHER INFORMATION
  - `#bcso-information`
  - `#department-records`
  - `#deputy-commendation`
  - `#active-warrants`
  - `#bolos`
  - `#clock-correction`
- BCSO | STAFF
  - `#roster-work`
  - `#department-suggestions`
- PERSONAL ADMINISTRATION BUREAU
  - `#pab-announcements`
  - `#application-responses`
  - `#pab-general`
  - `#pab-templates`
  - `#deputy-inactivity`
  - `#fto-record-request`
- POST ACADEMY | TRAINING
  - `#fto-announcements`
  - `#fto-documents`
  - `#request-training`
  - `#fto-general`
  - `#fto-formats`
  - `#evaluation-responses`
  - `#fto-training-records`
- PAB BOT WORKFLOWS | TEST ONLY (private)
  - `#training-records`
  - `#personnel-records`
  - `#pab-approvals`
  - `#pab-audit-log`
  - `#qualification-records`
  - `#pab-inactivity-review`
  - `#promotion-announcements`
  - `#pab-announcements`

The demo also has a non-managed `Ricky Controller` role assigned to the bot. A server owner must place `Ricky Controller` above the managed `BCSO Personnel Bot` role and above `Deputy`, `Corporal`, and `Test FTO` before testing promotion, award-role, or remove-role. Discord will not let Ricky manage a role that is at or above its highest role; run `/pab-health` after reordering to verify the result.

## 2) High-impact visual parity additions (completed)

These were added to the demo guild through the owner’s logged-in Discord session and verified through the Discord API on 2026-08-18. The clone is structure/workflow parity only; no live member data, message history, tickets, or IA records were copied.

- BCSO MEETINGS
  - `#meeting-announcements`
  - `#meeting-room` (voice)
- OFFICES
  - `#waiting-for-supervisor`
  - `#waiting-for-command`
- OFFICE SHERIFF
  - `#department-suggestions` (placeholder or re-link target)
- SPECIALIZED DIVISIONS | TEST ONLY
  - `#specialized`
  - `#sar`
  - `#detective`
  - `#traffic`
  - `#doc`

These names are based on the visible live BCSO layout and remain TEST ONLY placeholders. `#department-suggestions` intentionally exists both in `BCSO | STAFF` (the original core mapping) and under `OFFICE SHERIFF` (the parity placeholder/re-link target).

## 3) Role map to mirror permissions behavior

- Create these in addition to the existing test structure:
  - `PAB`
  - `Command`
  - `Deputy`
  - `Corporal`
  - `Test FTO`
- Keep the bot role above `Deputy`, `Corporal`, and any role it may manage in hierarchy checks.
- In the current demo, `Test FTO` (`1539385272255520900`) is the only role in `AWARDABLE_ROLE_IDS`. Selecting PAB, Command, Deputy, Corporal, or the bot/integration role is intentionally rejected.

## 4) BCSO bot presence and branding in the server

- Add Ricky as the bot profile name in Discord Developers.
- Set bot profile icon to official BCSO badge.
- Keep the test server marked clearly as TEST ONLY in channel names and guild description.

## 5) In-scope vs out-of-scope

In scope
- Visual clone
- Permission layout checks
- Demo role hierarchy with Ricky workflow
- Safe command execution and preview-based posting

Out of scope
- live BCSO member migration
- complaints, IA files, disciplinary evidence
- live message history or ticket migration

## 6) Runtime test path

1. Invite test members and verify role mention behavior.
2. Run `/setup-status` and `/pab-health` as a server admin.
3. Run `/training-log`, `/department-record`, `/promotion-check`, `/inactivity-review` from PAB.
4. Run `/promotion` flow to validate approval path (Command role).
5. Run `/correct-record` on one test message.
6. Export test ledger.
