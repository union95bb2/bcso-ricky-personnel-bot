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

The demo includes a non-managed `Ricky Controller` role for a clean hierarchy if the server owner assigns it to Ricky Bot. The role that is actually assigned to Ricky Bot is what matters: `/pab-health` reports Ricky Bot's highest assigned role. A server owner must move that actual role above `Deputy`, `Corporal`, and `Test FTO` before testing promotion, award-role, or remove-role. In the current screenshot the highest assigned role is `BCSO Personnel Bot`, so moving an unassigned `Ricky Controller` role would not fix the error. Discord will not let Ricky Bot manage a role that is at or above its highest role; run `/pab-health` after reordering to verify the result.

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

- Preserve the full BCSO rank matrix in the sandbox: `DST` / `Deputy Sheriff Trainee`, `Deputy`, `Senior Deputy`, `Corporal`, `Sergeant`, `Staff Sergeant`, `Lieutenant`, `Captain`, `Major`, `Commander`, `Division Chief`, `Chief Deputy`, `Assistant Sheriff`, `UnderSheriff`, and `Sheriff`. Promotions add the next rank role and retain prior rank roles as history.
- Use the existing organizational roles for workflow routing: `Personnel Administration Bureau` (`1539435205901942836`) is the PAB route and `BCSO | Command Staff` (`1539435146107813909`) is the Command approval route. These are the roles Ricky should ping. The duplicate short `PAB` and `Command` roles were removed after their assignments and channel overrides were migrated to these full-name roles.
- Keep the bot's actual assigned highest role above `Deputy`, `Corporal`, and any role it may manage in hierarchy checks. Confirm the name in `/pab-health` rather than assuming it is `Ricky Controller`.
- In the current demo, `Test FTO` (`1539385272255520900`) is the only role in `AWARDABLE_ROLE_IDS`. Selecting either existing authorization role, Deputy, Corporal, or the bot/integration role is intentionally rejected.

## 4) BCSO bot presence and branding in the server

- Add Ricky Bot as the bot profile name in Discord Developers.
- Set bot profile icon to official BCSO badge.
- Keep the test server marked clearly as TEST ONLY in channel names and guild description.

## 5) In-scope vs out-of-scope

In scope
- Visual clone
- Permission layout checks
- Demo role hierarchy with Ricky Bot workflow
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
