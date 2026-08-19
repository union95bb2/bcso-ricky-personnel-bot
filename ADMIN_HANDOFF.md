# Ricky BCSO Personnel Bot — Server Administrator Handoff

This bot is a private BCSO Personnel Administration Bureau (PAB) workflow system for the FiveM roleplay server. It standardizes records and controlled role changes; Internal Affairs matters, conduct complaints, investigations, findings, and discipline are outside its scope.

## What the bot will and will not do

It can create approved-format records, use real Discord member/role mentions, manage only explicitly allow-listed qualification roles, and process a rank promotion only after Command approval. It logs a durable local receipt for every successful bot-posted record.

All date-bearing forms use `MM/DD/YYYY`; promotion, role-award/removal, personnel-status, and training commands offer a **Today** prefill or manual entry; inactivity review uses `MM/DD/YYYY - MM/DD/YYYY`. The training time field uses `h:mm AM/PM - h:mm AM/PM` in the configured timezone label (for example, `4:00 PM - 5:00 PM MST`). Invalid dates or times are rejected before a preview is created, and training duration is derived from the validated range.

It has no Internal Affairs case workflow, complaint intake, evidence collection, investigation, finding, sanction, disciplinary review, or staff-direct-message feature. Its separate inactivity-review workflow is a neutral PAB staff-attention record only; it creates no finding and makes no role, access, or disciplinary change. Leave, return, transfer, and separation functions create records only; they do not change roles or access.

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

Place the **actual role assigned to Ricky**—the role shown by `/pab-health` as Ricky's highest assigned role—above every rank role and qualification/unit role listed in `RANK_ROLE_IDS` or `AWARDABLE_ROLE_IDS`. In the demo this is normally `BCSO Personnel Bot`; a separate `Ricky Controller` role has no effect unless it is assigned to the bot. Keep the bot role below the server owner; Discord never allows a bot to manage the owner. The bot does not need to sit above PAB or Command roles. Never include administrator, moderation, PAB, Command, or rank roles in `AWARDABLE_ROLE_IDS`.

If Discord marks the bot integration role as managed and it cannot be moved, create a separate non-managed controller role, assign it to the bot, and place that controller role above the rank and qualification roles it must manage.

### Channels and permissions

Create a private PAB records category or map these variables to approved existing channels. The bot needs View Channel, Send Messages, and Embed Links in each configured destination.

| Environment variable | Recommended channel | Audience |
| --- | --- | --- |
| `TRAINING_RECORDS_CHANNEL_ID` | `#training-records` | Read-only to ordinary members |
| `PERSONNEL_RECORDS_CHANNEL_ID` | `#personnel-records` | Read-only to ordinary members |
| `PROMOTIONS_ANNOUNCEMENTS_CHANNEL_ID` | `#promotion-announcements` | Department-visible |
| `AUDIT_LOG_CHANNEL_ID` | `#pab-audit-log` | PAB/Command only |
| `PAB_APPROVALS_CHANNEL_ID` | `#pab-approvals` | PAB/Command only |
| `QUALIFICATIONS_RECORDS_CHANNEL_ID` | `#qualification-records` | Read-only to ordinary members |
| `PAB_ANNOUNCEMENTS_CHANNEL_ID` | `#pab-announcements` | Department-visible |
| `INACTIVITY_REVIEW_CHANNEL_ID` | `#pab-inactivity-review` | PAB/Command only; neutral staff-attention review |

Use normal text channels for first deployment. Forum/thread routing can be introduced after the primary workflow is proven in a sandbox.

## Configuration

1. Enable Discord Developer Mode.
2. Copy the server, channel, and role IDs.
3. Copy `.env.example` to `.env` and fill it out on the bot host.
4. Protect `.env` and `data/` so only the bot host administrator can read them. Never send the bot token in Discord.
5. Run `npm run preflight:deploy`. It reports missing or malformed IDs without exposing secrets and checks the cutover host for duplicate Ricky containers. Use `npm run preflight:demo` for the TEST ONLY configuration.

`RANK_ROLE_IDS` is a JSON object. It must contain every rank that the bot is allowed to remove during promotion:

```env
RANK_ROLE_IDS={"Deputy":"123456789012345678","Senior Deputy":"234567890123456789","Corporal":"345678901234567890"}
```

`AWARDABLE_ROLE_IDS` is a comma-separated allow-list of non-rank unit/certification roles only.

## Install and release sequence

1. Install the bot in a private BCSO sandbox server first.
2. Set up test channels and harmless test roles.
3. Run `npm ci` and `npm run preflight:deploy` from the bot host. The deploy preflight is a hard no-go gate; it checks credentials without displaying them, validates all IDs/maps, and checks for duplicate local/optional remote containers. Use `npm run preflight:demo` for the sandbox.
4. Start the bot with `npm start` (or `docker compose up -d --build`). Ricky now performs a live startup readiness gate and exits without serving commands if the guild, channels, permissions, or manageable roles are incomplete.
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
- `/member-profile` — current Discord role snapshot only; no personnel jacket, complaint history, IA record, or prior bot-record history.
- `/inactivity-review` — private neutral staff-attention review; it cannot change roles, access, or discipline a member.
- `ACTIVITY_CHANNEL_IDS` — approved Discord channels whose human message timestamps may supply the last-known-activity field; message content is never stored.

## Data retention and backup

Discord channels are the published record. `data/pab.sqlite` is a private local operational ledger containing pending approvals and searchable metadata/record payloads. Back it up under the server's approved personnel-record retention process. The bot keeps unapproved previews for 15 minutes and purges them when it starts or accesses its queue.

Do not place the database in a public repository, shared public drive, or staff-accessible Discord attachment channel. `/export-audit` is restricted to Discord server administrators and should be handled as PAB personnel data.

## Incident procedure

If a bad record is posted, use `/correct-record` with the original Discord message link. Do not delete the original record; the correction creates an immutable linked audit trail.

If a role action is wrong, make the correct human-authorized role change, create the appropriate correction/status record, then record the incident in the private PAB audit process. Do not rely on bot logs alone for an authorization decision.
