# Ricky Bot

An internal Discord bot for the Blaine County Sheriff's Office FiveM roleplay server. It produces consistent training and personnel records, safely pings the relevant members, updates rank roles only after Command approval, and logs every completed action in Discord.

Canonical source: [public GitHub repository](https://github.com/union95bb2/bcso-ricky-personnel-bot). Keep deployment changes and reviewed fixes in `main`; never commit `.env` or the local SQLite data directory.

The read-only [real-server bot function inventory](REAL_SERVER_BOT_FUNCTION_INVENTORY.md) records the live server's visible bot surfaces and the exact sandbox checks used to compare Ricky Bot without copying third-party credentials or internals. The [PAB workflow audit](REAL_SERVER_PAB_WORKFLOW_AUDIT.md) documents the visible request-channel → PAB reformat → correct ping/CC → reviewed record process.

## What it does

- `/training-log trainer:@member trainee:@member division:SAR date:Today timezone:MST start-time:4:00 PM end-time:5:00 PM` opens a guided form with required division/program, **Today** (or manual date entry), and timezone choices. Optional hourly start/end dropdowns prefill the time field; leave both blank for a non-hour time and use the validated form. Ricky Bot derives session duration, carries the selected timezone into the form and posted record, and staff never type a timezone label.
- The submitting PAB member gets a private preview and must approve it before it posts to the training-records channel. Training times are displayed with the selected timezone label (for example, `4:00 PM MST – 5:00 PM MST`).
- Every date field uses `MM/DD/YYYY`; inactivity review periods use `MM/DD/YYYY - MM/DD/YYYY`. Training times are entered as a range such as `4 PM - 5 PM` or `4:00 PM - 5:00 PM MST` and are normalized to `h:mm AM/PM` in the selected timezone. The bot accepts hyphen or en-dash separators, normalizes minutes and AM/PM casing, and rejects invalid entries before creating a preview.
- `/promotion member:@member date:Today` opens a guided promotion form with the shared date selector. `/award-role`, `/remove-role`, and `/personnel-status` use the same date control.
- Only Command can approve the promotion preview. Approval removes any configured prior rank role, adds the configured new rank role, posts the personnel record, announces it, and writes an audit entry.
- `/award-role member:@member role:@role` records and applies an approved qualification or unit role. The bot will reject every role except those explicitly listed in `AWARDABLE_ROLE_IDS`.
- `/remove-role member:@member role:@role` uses the same allow-list and preview to remove an approved qualification or unit role. It cannot remove ranks, PAB, moderation, or elevated roles.

If `/award-role` or `/remove-role` says a role is not eligible, the selected role is not in `AWARDABLE_ROLE_IDS` (or is a rank/managed/elevated role). In the demo configuration, `Test FTO` is the harmless allow-listed role. A server administrator can add another non-rank qualification/unit role ID to the protected setting, restart Ricky Bot, and run `/pab-health`; never put PAB, Command, rank, moderation, or Administrator roles in that list.
- `/department-record member:@member callsign:C-### source-link:<optional>` is the mobile-first PAB workflow. It selects members and roles in Discord, previews the captured PAB-branded department-record format, routes it to the personnel-record destination, and gives it an audit ID. PAB still enters the factual information from the division record-request channel; Ricky Bot does not scrape or copy source-message content. When supplied, the source link is preserved in the final record for traceability.
- `/correct-record message-link:` creates a new, immutable correction in the original record's channel. It never edits or deletes the original.
- `/promotion-check member:@member` captures the human eligibility review in the private PAB queue; it cannot promote anyone.
- `/personnel-status member:@member status:` records an approved leave, return to duty, transfer, or separation. It is record-only—access and role changes remain a separate Command decision.
- `/inactivity-review member:@member` creates a neutral, private PAB activity review with a review period, last known activity, factual summary, and follow-up. It never changes roles or access, and is not an IA or disciplinary workflow.
- Ricky Bot can track human message timestamps in explicitly approved `ACTIVITY_CHANNEL_IDS` channels without storing message content. In `/inactivity-review`, leave the last-activity field blank to use the latest tracked event through the review period; PAB can enter a verified override when the ledger has no event.
- `/member-profile member:@member` gives PAB a private live snapshot of the member's current Discord roles. It does not show a personnel jacket, complaint history, IA record, or prior bot records.
- `/pab-announcement` drafts, previews, and posts a PAB announcement. It can notify one safe, non-administrator role.
- `/pab-dashboard` shows PAB a private queue, recent activity, and operating snapshot.
- `/find-record` searches durable receipts by member or PAB record ID, while `/export-audit` gives a server administrator a private backup export.
- `/setup-status` and `/pab-health` give server administrators a safe way to validate environment values, live channel access, and role hierarchy.
- Ricky Bot preflights each destination channel before opening a workflow and reports the exact missing channel permission instead of waiting for a generic Discord failure. `/pab-health` also checks View Channel, Send Messages, Embed Links, Read Message History, Attach Files, Manage Roles, role hierarchy, managed roles, and Administrator-role guardrails.
- Technical failures are emitted as structured JSON to the process error stream with a timestamp, scope, interaction ID, command/custom ID, Discord error code, and stack trace; submitted form values are never logged. Modal submissions are acknowledged before slow Discord fetches so mobile users receive Ricky's actual validation/error message instead of Discord's generic “Something went wrong” banner. Use `docker compose logs -f --tail=100` (or the host's service-log command) for diagnostics; the PAB audit channel remains reserved for personnel-action receipts.
- The bot uses true Discord mentions (`<@user-id>`), so notifications go to the correct person even when their name changes.

Training completion deliberately **does not** automatically promote anyone. The record can recommend a promotion, but the separate Command-approved `/promotion` action is the control point.

Department records document selected roles but do not change them. Use `/award-role` or the Command-approved `/promotion` workflow for controlled role changes. Internal Affairs matters, conduct complaints, investigations, findings, and discipline are outside this bot's scope.

## Discord layout to create

Create a `PAB RECORDS` category with these channels:

| Channel | Normal members | PAB | Command | Bot |
| --- | --- | --- | --- | --- |
| `#training-records` | View only | View/send | View/send | Send/embed |
| `#personnel-records` | View only | View/send | View/send | Send/embed |
| `#pab-approvals` | No access | View/send | View/send | Send/embed |
| `#pab-audit-log` | No access | View only | View only | Send/embed |
| `#qualification-records` | View only | View/send | View/send | Send/embed |
| `#promotion-announcements` | View only | View/send | View/send | Send/embed |
| `#pab-announcements` | View only | View/send | View/send | Send/embed |
| `#pab-inactivity-review` | No access | View/send | View/send | Send/embed |

Use forum channels if you want each record to become a separate discussion thread. Version 1 posts to normal text channels, which is simpler and works in every server.

## Setup (first time)

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create **Ricky Bot**, then create a bot user.
2. Under **Installation**, add the `bot` and `applications.commands` scopes. Give it only: View Channels, Send Messages, Embed Links, Read Message History, Attach Files, Manage Roles, and Use Application Commands. Do not grant Administrator.
3. Turn on the **Server Members Intent** under Bot → Privileged Gateway Intents. Ricky Bot also subscribes to guild message events for the approved activity-source channels; it does not require Message Content Intent because it stores timestamps and IDs, not message text.
4. Invite the bot to the BCSO server. In the server role list, move the **actual role assigned to Ricky Bot**—the role named in `/pab-health` as Ricky Bot's highest assigned role—above every rank or qualification role it must change. In the demo this is normally `BCSO Personnel Bot`; `Ricky Controller` only matters if it is actually assigned to the bot. Keep the bot role below the server owner (bots can never manage the owner) and do not test by assigning the target every copied role. Discord will otherwise reject promotion changes.
   Make the PAB and Command roles **mentionable** in Server Settings → Roles (or grant Ricky Bot the broader Mention Everyone permission). Ricky Bot uses restricted role mentions for approval pings; `/pab-health` flags non-mentionable or elevated approval roles.
5. Enable Developer Mode in Discord: User Settings → Advanced → Developer Mode. Right-click each required role/channel/server and choose **Copy ID**.
6. Copy `.env.example` to `.env`, then fill in the IDs and the rank-role JSON. Keep the bot token only in `.env`; never paste it into Discord or commit it.
7. Run `npm ci`, `npm run preflight:deploy`, `npm run register`, then `npm start`. For the TEST ONLY guild, use `npm run preflight:demo`, `npm run register:demo`, and `npm run start:demo`; those scripts preserve the protected token/client ID while overlaying only the demo guild IDs.

Guild commands normally appear in seconds after `npm run register`. Re-run that command after changing the slash-command definitions. Ricky Bot's startup gate verifies the complete configuration and exact guild command set before it comes online; `/setup-status` and `/pab-health` are read-only diagnostics once the bot is running.

For the included `BCSO PAB Bot Sandbox`, `.env.sandbox.example` already contains that sandbox's server, channel, PAB/Command role, and harmless test-role IDs. It deliberately does **not** contain the bot token or application client ID. Copy it only to the protected sandbox host configuration, fill those two values from the Developer Portal, then register commands against the sandbox before any live-server deployment.

For the presentation environment, `.env.demo.example` maps the separate `BCSO Bot Demo | TEST ONLY` server. It contains only the demo guild, role, and channel IDs, with blank credentials. This server is intentionally separate from the real BCSO server and contains no copied members, records, tickets, or production configuration.

When the protected `.env` contains Ricky Bot's token and client ID, start that presentation environment with `npm run start:demo`. This overlays the public demo IDs without exposing or replacing the protected credentials; do not source the example file directly from a shell because JSON role maps can lose their quotes.

## Required configuration

`RANK_ROLE_IDS` is the guardrail for role updates. Ricky Bot now validates the complete BCSO rank matrix, including `DST` (Deputy Sheriff Trainee), before startup:

```env
RANK_ROLE_IDS={"DST":"123456789012345678","Deputy":"234567890123456789","Senior Deputy":"345678901234567890","Corporal":"456789012345678901","Sergeant":"567890123456789012","Staff Sergeant":"678901234567890123","2nd Lieutenant":"789012345678901234","1st Lieutenant":"890123456789012345","Captain":"901234567890123456","Major":"012345678901234567","Commander":"123456789012345679","Division Chief":"234567890123456790","Chief Deputy":"345678901234567891","Assistant Sheriff":"456789012345678902","UnderSheriff":"567890123456789013","Sheriff":"678901234567890124"}
```

The bot removes only roles listed in this map. It will leave qualifications, units, PAB, FTO, and other non-rank roles alone.

Configure approved non-rank awards separately. This is a hard allow-list; do not put rank, staff, moderator, or high-permission role IDs in it.

```env
AWARDABLE_ROLE_IDS="567890123456789012,678901234567890123"
```

## Daily workflow

1. PAB runs `/training-log`, selects trainer and trainee, completes the form, reviews the private preview, and clicks **Approve & post**.
2. PAB runs `/promotion`, chooses the member, and completes the form. The bot sends the request to private `#pab-approvals` and pings PAB.
3. A PAB member clicks **PAB review & forward**. Ricky Bot updates the request and pings Command.
4. A Command member clicks **Command approve & apply**. Only then does the bot change rank roles and send announcements.
5. PAB runs `/award-role` or `/remove-role` for an allow-listed certification or unit role, reviews the private preview, and approves it.
6. PAB creates a `/department-record` for mobile-friendly branded records, and uses `/correct-record` to append—not overwrite—any correction.
7. PAB uses `/promotion-check` before a promotion request, `/personnel-status` to document approved leave, return, transfer, or separation records, and `/inactivity-review` for private staff-attention follow-up. None of these actions changes roles or access.
8. PAB uses `/pab-announcement` for reviewed notices and `/member-profile` for a current-role snapshot.
9. If anything is wrong, click Cancel and re-run the command. Nothing changes before approval.

## Safeguards built in

- Every posting and role-change workflow presents a private preview first.
- The bot selects actual Discord members and roles; staff never type `@` mentions by hand.
- Rank changes use two human gates: a PAB member reviews and forwards the request, then a Command member is pinged and must approve/apply it. PAB may only award or remove roles in the explicit qualification/unit allow-list.
- Internal Affairs matters, conduct complaints, investigations, findings, and discipline are not part of this bot.
- Inactivity review is a neutral PAB staff-attention record only; it does not determine misconduct, trigger discipline, or automatically remove anyone.
- Corrections preserve the original message and link the correction to it.
- Preview approvals survive a bot restart. They expire after `PENDING_ACTION_TTL_MINUTES` (24 hours by default; configurable from 1 hour to 7 days), show both an absolute Discord timestamp and live relative countdown, receive a private PAB reminder one hour before expiry, and expose a creator-authorized **Renew** control. Every new approval request pings the PAB role in private `#pab-approvals`; after PAB forwards a promotion, Ricky Bot updates the request and pings Command for the final role-changing approval. Expired actions fail closed and require fresh validation before approval.
- `/my-birthday` is opt-in and stores month/day only; `/remove-birthday` deletes it. With `BIRTHDAY_CHANNEL_ID`, Ricky Bot posts one annual birthday notice and deduplicates it.
- With `SERVICE_MILESTONES_CHANNEL_ID`, Ricky Bot can post one-month, three-month, six-month, and yearly notices from the Discord join date, plus the same milestones from Ricky Bot's own approved promotion receipts for time in rank. These are informational and never change rank or access.
- `/roster-sync` is an administrator-only, read-only comparison against a configured Google Sheet. It is staged behind `GOOGLE_SHEETS_ENABLED=false` until a server owner explicitly activates it. It reports missing Discord IDs and rank mismatches; it never applies spreadsheet-driven role changes.
- See [`GOOGLE_SHEETS_ROSTER.md`](GOOGLE_SHEETS_ROSTER.md) for the exact header row, service-account sharing steps, and protected environment variables.
- Activity tracking stores only member ID, timestamp, source channel, and source event ID. It is limited to the configured `ACTIVITY_CHANNEL_IDS` allow-list and begins when Ricky Bot is installed; it is not a historical personnel or IA record.
- Completed records remain in Discord and also receive a private searchable SQLite receipt for PAB operations, search, and backup.

## Production handoff

Read [ADMIN_HANDOFF.md](ADMIN_HANDOFF.md) before installing the bot in a BCSO server. It includes the exact role/channel model, least-privilege permissions, sandbox test plan, backup boundary, deployment order, and incident procedure.

For an always-on host, the included `Dockerfile` and `compose.yaml` run the bot with automatic restart and a persistent `data/` directory:

```sh
docker compose up -d --build
```

On a Linux Docker host, prepare the private bind-mount directory first:

```sh
mkdir -p data
sudo chown 10001:10001 data
chmod 700 data
```

Do not use the Docker command until the server administrator has completed `.env`, reviewed the permissions, and approved the installation.

Run only one active Ricky Bot process per Discord token and configured guild. A token can be invited to multiple sandboxes, but a stale container can still receive globally registered interactions. The bot now ignores interactions whose guild ID does not match its configured `DISCORD_GUILD_ID`; still stop old containers before cutover and confirm `/setup-status` plus `/pab-health` in the target guild. See [`COMMAND_TEST_REPORT.md`](COMMAND_TEST_REPORT.md) for the controlled Discord command test and screenshot evidence.

The release gate is documented in [`RELEASE_READINESS.md`](RELEASE_READINESS.md). It covers candidate configuration, duplicate-instance checks, the live startup readiness gate, Discord verification, and explicit no-go conditions.

## Before going live

- Test first in a private BCSO test server with test roles and test channels.
- Ensure every current rank role is in `RANK_ROLE_IDS`; otherwise the bot intentionally will not remove it.
- Confirm that PAB and Command role IDs are correct.
- Keep Ricky Bot's actual highest assigned role (shown by `/pab-health`) above every configured `RANK_ROLE_IDS` and `AWARDABLE_ROLE_IDS` role, and above PAB if PAB members may be promotion/qualification targets. Discord cannot change roles on a member whose highest role is at or above the bot. Moving an unassigned controller role does not change the bot's hierarchy; PAB, Command, Administrator, and moderation roles still remain protected by the bot's allow-lists.
- Keep `#pab-audit-log` private.
- Back up important personnel records according to the BCSO server's own rules.

## Still needed before live deployment

The bot does not start partially configured. Before live use, complete the protected `.env`, register the exact guild command set, place the bot role above roles it may manage, run `/pab-health`, and complete the sandbox test plan. Google Sheets is an optional read-only roster comparison; the bot never treats a spreadsheet as permission to change Discord roles.
