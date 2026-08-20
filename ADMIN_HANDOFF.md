# Ricky Bot — Server Administrator Handoff

This bot is a private BCSO Personnel Administration Bureau (PAB) workflow system for the FiveM roleplay server. It standardizes records and controlled role changes; Internal Affairs matters, conduct complaints, investigations, findings, and discipline are outside its scope.

**Release:** Ricky Bot v1.1.0. This release adds silent-departure monitoring without changing existing command syntax or approval guardrails.

## What the bot will and will not do

It can create approved-format records, use real Discord member/role mentions, manage only explicitly allow-listed qualification roles, and process a rank promotion only after Command approval. It logs a durable local receipt for every successful bot-posted record.

All date-bearing forms use `MM/DD/YYYY`; promotion, role-award/removal, personnel-status, and training commands offer a **Today** prefill or manual entry; inactivity review uses `MM/DD/YYYY - MM/DD/YYYY`. The training time field uses `h:mm AM/PM - h:mm AM/PM` in the configured timezone label (for example, `4:00 PM - 5:00 PM MST`). Invalid dates or times are rejected before a preview is created, and training duration is derived from the validated range.

It has no Internal Affairs case workflow, complaint intake, evidence collection, investigation, finding, sanction, disciplinary review, or staff-direct-message feature. Its separate inactivity-review workflow is a neutral PAB staff-attention record only; it creates no finding and makes no role, access, or disciplinary change. Manual leave, return, transfer, and separation functions create records only; they do not change roles or access. In addition, Ricky listens for Discord member removals so a member who leaves without saying anything is still logged for human follow-up. That event is deliberately unable to determine whether the removal was a voluntary leave, kick, or ban, and it does not impose discipline or change roles.

## Required Discord configuration

Use [DEMO_SERVER_CLONE_BLUEPRINT.md](DEMO_SERVER_CLONE_BLUEPRINT.md) when preparing a visual clone server for PAB demos.

### Application permissions

In the Discord Developer Portal, use Guild Install only with the `bot` and `applications.commands` scopes. Grant only:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Attach Files
- Manage Roles
- Use Application Commands

Enable **Server Members Intent**. Do not grant Administrator.

### Role hierarchy

Create or use these roles:

- `PAB_ROLE_ID`: staff permitted to submit and approve ordinary PAB workflows.
- `COMMAND_ROLE_ID`: staff permitted to approve promotions.

PAB and Command must be normal **mentionable** roles (or Ricky Bot must be granted Mention Everyone) so restricted approval role pings actually notify staff. `/pab-health` reports a non-mentionable, managed, or elevated approval role.

Place the **actual role assigned to Ricky Bot**—the role shown by `/pab-health` as Ricky Bot's highest assigned role—above every rank role and qualification/unit role listed in `RANK_ROLE_IDS` or `AWARDABLE_ROLE_IDS`. In the demo this is normally `BCSO Personnel Bot`; a separate `Ricky Controller` role has no effect unless it is assigned to the bot. Keep the bot role below the server owner; Discord never allows a bot to manage the owner. If PAB members can be promotion or qualification targets, place the actual Ricky Bot role above PAB as well (and above any other highest role those targets may have). This lets Ricky change only the configured rank/award roles; PAB and Command remain protected because they are never included in the role allow-lists. If server policy does not permit Ricky above PAB, those targets require a human-admin role change. Never include administrator, moderation, PAB, Command, or rank roles in `AWARDABLE_ROLE_IDS`.

If Discord marks the bot integration role as managed and it cannot be moved, create a separate non-managed controller role, assign it to the bot, and place that controller role above the rank and qualification roles it must manage.

### Channels and permissions

Create a private PAB records category or map these variables to approved existing channels. The bot needs View Channel, Send Messages, and Embed Links in each configured destination.

| Environment variable | Recommended channel | Audience |
| --- | --- | --- |
| `TRAINING_RECORDS_CHANNEL_ID` | `#training-records` | Read-only to ordinary members |
| `PERSONNEL_RECORDS_CHANNEL_ID` | `#personnel-records` | Read-only to ordinary members |
| `PROMOTIONS_ANNOUNCEMENTS_CHANNEL_ID` | `#promotion-announcements` | Department-visible |
| `AUDIT_LOG_CHANNEL_ID` | `#pab-audit-log` | PAB/Command only |
| `DEPARTURE_LOG_CHANNEL_ID` | `#pab-departures` (optional) | PAB/Command only; falls back to `AUDIT_LOG_CHANNEL_ID` |
| `PAB_APPROVALS_CHANNEL_ID` | `#pab-approvals` | PAB/Command only |
| `QUALIFICATIONS_RECORDS_CHANNEL_ID` | `#qualification-records` | Read-only to ordinary members |
| `PAB_ANNOUNCEMENTS_CHANNEL_ID` | `#pab-announcements` | Department-visible |
| `INACTIVITY_REVIEW_CHANNEL_ID` | `#pab-inactivity-review` | PAB/Command only; neutral staff-attention review |

The normal text channels are the safe baseline and remain required fallbacks. For Phase 2, an administrator may create two Forum channels and set `TRAINING_RECORDS_FORUM_CHANNEL_ID` and `PERSONNEL_JACKETS_FORUM_CHANNEL_ID`. Ricky then creates one append-only thread per trainee/member only after approval; it never places previews or approval buttons in those threads. The Forum channels must grant Ricky View Channel, Send Messages, Embed Links, Read Message History, and Create Public Threads, while ordinary members/PAB/Command should have view-only access if the record thread is intended to be bot-only. Run `/pab-health` after adding the IDs.

## Configuration

1. Enable Discord Developer Mode.
2. Copy the server, channel, and role IDs.
3. Copy `.env.example` to `.env` and fill it out on the bot host.
4. Protect `.env` and `data/` so only the bot host administrator can read them. Never send the bot token in Discord.
5. Run `npm run preflight:deploy`. It reports missing or malformed IDs without exposing secrets and checks the cutover host for duplicate Ricky Bot containers. Use `npm run preflight:demo` for the TEST ONLY configuration.

`RANK_ROLE_IDS` is a JSON object. It must contain the complete BCSO matrix that Ricky Bot manages during promotion, including DST / Deputy Sheriff Trainee:

The sandbox already contains the copied role-name matrix, including DST and the visual separator roles. The verified live color palette is tracked in `scripts/role-style-manifest.json`; `npm run role-audit:demo` reports gray or mismatched sandbox roles without changing them. Apply any Discord color/order migration only after a human reviews that report.

```env
RANK_ROLE_IDS={"DST":"123456789012345678","Deputy":"234567890123456789","Senior Deputy":"345678901234567890","Corporal":"456789012345678901","Sergeant":"567890123456789012","Staff Sergeant":"678901234567890123","2nd Lieutenant":"789012345678901234","1st Lieutenant":"890123456789012345","Captain":"901234567890123456","Major":"012345678901234567","Commander":"123456789012345679","Division Chief":"234567890123456790","Chief Deputy":"345678901234567891","Assistant Sheriff":"456789012345678902","UnderSheriff":"567890123456789013","Sheriff":"678901234567890124"}
```

`AWARDABLE_ROLE_IDS` is a comma-separated allow-list of non-rank unit/certification roles only.

## Install and release sequence

1. Install the bot in a private BCSO sandbox server first.
2. Set up test channels and harmless test roles.
3. Run `npm ci` and `npm run preflight:deploy` from the bot host. The deploy preflight is a hard no-go gate; it checks credentials without displaying them, validates all IDs/maps, and checks for duplicate local/optional remote containers. Use `npm run preflight:demo` for the sandbox.
4. Start the bot with `npm start` (or `docker compose up -d --build`). Ricky Bot now performs a live startup readiness gate and exits without serving commands if the guild, channels, permissions, or manageable roles are incomplete.
5. In Discord, run `/setup-status` and `/pab-health` as a server administrator. Resolve every failed channel or hierarchy check. Do not treat a green command response as a substitute for the startup gate or the single-instance cutover check.
6. Run one test of each role-changing workflow using test roles: promotion, award-role, and remove-role.
7. Confirm `/department-record`, `/correct-record`, training, and `/export-audit` produce the desired artifacts.
8. Only then repeat the configuration in the live BCSO server and register guild commands there.

Registering commands changes the live server's command list; do it during an agreed maintenance window.

See [RELEASE_READINESS.md](RELEASE_READINESS.md) for the full preflight, single-instance, startup-gate, and no-go checklist.

## Operating commands

Server administrators:

- `/setup-status` — static environment configuration status.
- `/pab-health` — read-only live permission and role-hierarchy check.
- `/export-audit` — downloads the private local receipt ledger for authorized backup/review.

PAB/Command:

- `/pab-dashboard` — queue and recent activity.
- `/find-record` — search the bot's local receipts by member or PAB record ID.
- `/personnel-history` — private indexed personnel-jacket lookup with direct Discord record links.
- `/member-profile` — current Discord role snapshot only; no personnel jacket, complaint history, IA record, or prior bot-record history.
- `/inactivity-review` — private neutral staff-attention review; it cannot change roles, access, or discipline a member.
- `ACTIVITY_CHANNEL_IDS` — approved Discord channels whose human message timestamps may supply the last-known-activity field; message content is never stored.
- `DEPARTURE_LOG_CHANNEL_ID` — optional staff-only destination for automatic member-departure notices. If blank, Ricky uses `AUDIT_LOG_CHANNEL_ID`, then `PAB_APPROVALS_CHANNEL_ID`.

Technical errors are written as structured JSON to Ricky's process error stream. Each entry includes the timestamp, failure scope, interaction ID, guild/user identifiers, command or custom ID, and stack when available; form contents and tokens are not logged. Use `docker compose logs -f --tail=100` or the configured service manager's log viewer. The Discord PAB audit channel is a personnel-action ledger, not a technical error sink.

## Data retention and backup

Discord channels are the published record. `data/pab.sqlite` is a private local operational ledger containing pending approvals and searchable metadata/record payloads. Back it up under the server's approved personnel-record retention process. The bot keeps unapproved previews for `PENDING_ACTION_TTL_MINUTES` (24 hours by default; allowed range 1 hour–7 days), renders an absolute expiry timestamp plus Discord's live relative countdown, sends a role-ping reminder during the configured `PENDING_REMINDER_MINUTES` window (one hour by default), and offers the submitting PAB member a **Renew** button. Every request is posted to private `#pab-approvals` with a PAB role ping. Promotions have two gates: PAB reviews and forwards the request, then Ricky Bot updates the same request and pings Command for the final role-changing approval. Expired actions fail closed; renewal creates a fresh expiration window, while final approval still re-checks current Discord permissions and roles. Expired rows are retained briefly for safe renewal and then purged.

Optional self-service and comparison features are controlled separately: `/my-birthday` stores only an opt-in month/day, `/remove-birthday` deletes it, and `/roster-sync` performs a read-only comparison against a configured Google Sheet. `/promotion-check` can additionally read a separate promotion-evaluation sheet and report rank/evidence alignment in the PAB preview. Google Sheets is staged behind `GOOGLE_SHEETS_ENABLED=false` and `GOOGLE_PROMOTION_TESTS_ENABLED=false` until a server owner explicitly activates each source. Ricky Bot never applies spreadsheet-driven role changes or makes an IA/discipline decision; PAB and Command remain the approvers.

Ricky RMS is the Phase 2 system-of-record path. It stores structured member profiles, typed records, approval states, imports, and audit events in `data/rms.sqlite`, and serves the protected PAB dashboard through the optional `ricky-rms` Compose profile. It is staged behind `RMS_ENABLED=false` for the Discord process until the PiCam OAuth redirect, session secret, backup path, and reverse-proxy route have been configured. Follow [`RMS_PICAM_DEPLOYMENT.md`](RMS_PICAM_DEPLOYMENT.md) and validate the migration in the sandbox before opening it to staff.

Do not place the database in a public repository, shared public drive, or staff-accessible Discord attachment channel. `/export-audit` is restricted to Discord server administrators and should be handled as PAB personnel data.

## Incident procedure

If a bad record is posted, use `/correct-record` with the original Discord message link. Do not delete the original record; the correction creates an immutable linked audit trail.

If Discord shows **Something went wrong** while submitting a mobile form, retry after checking the process log. Ricky acknowledges modal submissions immediately and should return a specific validation or permission message; a remaining generic banner indicates a Discord/network failure or a stopped bot process.

If a role action is wrong, make the correct human-authorized role change, create the appropriate correction/status record, then record the incident in the private PAB audit process. Do not rely on bot logs alone for an authorization decision.
