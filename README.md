# Ricky BCSO Personnel Bot

An internal Discord bot for the Blaine County Sheriff's Office FiveM roleplay server. It produces consistent training and personnel records, safely pings the relevant members, updates rank roles only after Command approval, and logs every completed action in Discord.

Canonical source: [private GitHub repository](https://github.com/union95bb2/bcso-ricky-personnel-bot). Keep deployment changes and reviewed fixes in `main`; never commit `.env` or the local SQLite data directory.

The read-only [real-server bot function inventory](REAL_SERVER_BOT_FUNCTION_INVENTORY.md) records the live server's visible bot surfaces and the exact sandbox checks used to compare Ricky without copying third-party credentials or internals.

## What it does

- `/training-log trainer:@member trainee:@member date:Today` opens a guided form with an optional one-click **Today** date prefill and generates a polished training embed.
- The submitting PAB member gets a private preview and must approve it before it posts to the training-records channel. Training times are displayed with the configured timezone label (for example, `4:00 PM MST – 5:00 PM MST`).
- Every date field uses `MM/DD/YYYY`; inactivity review periods use `MM/DD/YYYY - MM/DD/YYYY`. Training times use `h:mm AM/PM` in the configured timezone (for example, `4:00 PM - 5:00 PM MST`). The bot normalizes padded dates and AM/PM casing and rejects invalid entries before creating a preview.
- `/promotion member:@member` opens a guided promotion form.
- Only Command can approve the promotion preview. Approval removes any configured prior rank role, adds the configured new rank role, posts the personnel record, announces it, and writes an audit entry.
- `/award-role member:@member role:@role` records and applies an approved qualification or unit role. The bot will reject every role except those explicitly listed in `AWARDABLE_ROLE_IDS`.
- `/remove-role member:@member role:@role` uses the same allow-list and preview to remove an approved qualification or unit role. It cannot remove ranks, PAB, moderation, or elevated roles.
- `/department-record member:@member callsign:C-###` is the mobile-first PAB workflow. It selects members and roles in Discord, previews the captured PAB-branded department-record format, routes it to the personnel-record destination, and gives it an audit ID.
- `/correct-record message-link:` creates a new, immutable correction in the original record's channel. It never edits or deletes the original.
- `/promotion-check member:@member` captures the human eligibility review in the private PAB queue; it cannot promote anyone.
- `/personnel-status member:@member status:` records an approved leave, return to duty, transfer, or separation. It is record-only—access and role changes remain a separate Command decision.
- `/inactivity-review member:@member` creates a neutral, private PAB activity review with a review period, last known activity, factual summary, and follow-up. It never changes roles or access, and is not an IA or disciplinary workflow.
- `/member-profile member:@member` gives PAB a private live snapshot of the member's current Discord roles. It does not show a personnel jacket, complaint history, IA record, or prior bot records.
- `/pab-announcement` drafts, previews, and posts a PAB announcement. It can notify one safe, non-administrator role.
- `/pab-dashboard` shows PAB a private queue, recent activity, and operating snapshot.
- `/find-record` searches durable receipts by member or PAB record ID, while `/export-audit` gives a server administrator a private backup export.
- `/setup-status` and `/pab-health` give server administrators a safe way to validate environment values, live channel access, and role hierarchy.
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

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create **Ricky**, then create a bot user.
2. Under **Installation**, add the `bot` and `applications.commands` scopes. Give it only: View Channels, Send Messages, Embed Links, Read Message History, Manage Roles, and Use Application Commands. Do not grant Administrator.
3. Turn on the **Server Members Intent** under Bot → Privileged Gateway Intents.
4. Invite the bot to the BCSO server. In the server role list, drag the bot role **above every rank role it must change**. Discord will otherwise reject promotion changes.
5. Enable Developer Mode in Discord: User Settings → Advanced → Developer Mode. Right-click each required role/channel/server and choose **Copy ID**.
6. Copy `.env.example` to `.env`, then fill in the IDs and the rank-role JSON. Keep the bot token only in `.env`; never paste it into Discord or commit it.
7. Run `npm ci`, `npm run preflight`, `npm run register`, then `npm start`.

Guild commands normally appear in seconds after `npm run register`. Re-run that command after changing the slash-command definitions. `/setup-status` can run with only the core bot credentials; all workflow commands remain blocked until their specific safe configuration is present.

For the included `BCSO PAB Bot Sandbox`, `.env.sandbox.example` already contains that sandbox's server, channel, PAB/Command role, and harmless test-role IDs. It deliberately does **not** contain the bot token or application client ID. Copy it only to the protected sandbox host configuration, fill those two values from the Developer Portal, then register commands against the sandbox before any live-server deployment.

For the presentation environment, `.env.demo.example` maps the separate `BCSO Bot Demo | TEST ONLY` server. It contains only the demo guild, role, and channel IDs, with blank credentials. This server is intentionally separate from the real BCSO server and contains no copied members, records, tickets, or production configuration.

## Required configuration

`RANK_ROLE_IDS` is the guardrail for role updates. Use exact rank names as you want PAB to type in the promotion form:

```env
RANK_ROLE_IDS={"DST":"123456789012345678","Deputy":"234567890123456789","Senior Deputy":"345678901234567890","Corporal":"456789012345678901"}
```

The bot removes only roles listed in this map. It will leave qualifications, units, PAB, FTO, and other non-rank roles alone.

Configure approved non-rank awards separately. This is a hard allow-list; do not put rank, staff, moderator, or high-permission role IDs in it.

```env
AWARDABLE_ROLE_IDS="567890123456789012,678901234567890123"
```

## Daily workflow

1. PAB runs `/training-log`, selects trainer and trainee, completes the form, reviews the private preview, and clicks **Approve & post**.
2. PAB runs `/promotion`, chooses the member, and completes the form. The bot sends the request to private `#pab-approvals`.
3. A Command member clicks **Command approve & apply** there. Only then does the bot change rank roles and send announcements.
4. PAB runs `/award-role` or `/remove-role` for an allow-listed certification or unit role, reviews the private preview, and approves it.
5. PAB creates a `/department-record` for mobile-friendly branded records, and uses `/correct-record` to append—not overwrite—any correction.
6. PAB uses `/promotion-check` before a promotion request, `/personnel-status` to document approved leave, return, transfer, or separation records, and `/inactivity-review` for private staff-attention follow-up. None of these actions changes roles or access.
7. PAB uses `/pab-announcement` for reviewed notices and `/member-profile` for a current-role snapshot.
8. If anything is wrong, click Cancel and re-run the command. Nothing changes before approval.

## Safeguards built in

- Every posting and role-change workflow presents a private preview first.
- The bot selects actual Discord members and roles; staff never type `@` mentions by hand.
- Rank changes require Command approval. PAB may only award or remove roles in the explicit qualification/unit allow-list.
- Internal Affairs matters, conduct complaints, investigations, findings, and discipline are not part of this bot.
- Inactivity review is a neutral PAB staff-attention record only; it does not determine misconduct, trigger discipline, or automatically remove anyone.
- Corrections preserve the original message and link the correction to it.
- Preview approvals survive a bot restart, expire after 15 minutes, and are then safely purged.
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

## Before going live

- Test first in a private BCSO test server with test roles and test channels.
- Ensure every current rank role is in `RANK_ROLE_IDS`; otherwise the bot intentionally will not remove it.
- Confirm that PAB and Command role IDs are correct.
- Keep `#pab-audit-log` private.
- Back up important personnel records according to the BCSO server's own rules.

## Still needed before live deployment

The bot can start with its core credentials and lets a server administrator run `/setup-status`, but it deliberately blocks each PAB workflow until its required role/channel IDs and allow-lists are valid. Before live use, place the bot role above roles it may manage, run `/pab-health`, complete the sandbox test plan, and register the commands. A roster integration is deliberately not included: it needs the roster owner's chosen system and write permissions before the bot should read or change external personnel data.
