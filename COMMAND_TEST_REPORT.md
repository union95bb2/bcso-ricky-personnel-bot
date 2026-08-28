# Ricky command-matrix test report

Test environment: `BCSO Bot Demo | TEST ONLY` (`1539383172536467516`), 2026-08-18, through the logged-in Discord client. The test used one controlled local Ricky process after an older `bcso-personnel-bot` container on `picam` was stopped. The old container was not deleted and its data volume was left intact.

## Current sandbox follow-up — 2026-08-20

The TEST ONLY guild currently has the complete 20-command guild registration and Ricky's actual assigned `BCSO Personnel Bot` role remains above the configured demo rank and qualification roles. The live audit found two Discord-side items that must be corrected before calling the sandbox healthy:

- Grant Ricky Bot `Attach Files` in the bot role/integration permissions. The current bot role has the other required baseline permissions but not `Attach Files`.
- Make the `PAB` and `Command` roles mentionable, or grant Ricky Bot `Mention Everyone` if that is the server's approved least-privilege choice. Restricted approval pings are intentionally blocked when those roles are non-mentionable.

The sandbox bot container was stopped during this follow-up, so Discord showed **The application did not respond** for `/pab-health`. The source now defers the health interaction before its multi-channel and role checks, then edits the deferred reply; restart the sandbox instance with the reviewed source before repeating the live command matrix. The separate documented sandbox guild is not currently reachable by this bot; the verified target for this run is the `BCSO Bot Demo | TEST ONLY` guild.

## Result

The original production workflow commands were exercised through their real Discord surface. The current source and TEST ONLY guild register 24 commands; the optional birthday and Google-roster surfaces remain covered by automated tests and require optional configuration for a live Discord pass. Form commands were taken from command picker → member/role selector → guided form → preview/approval → destination record. Role-changing tests used the clean sandbox member `Rickya128`; the member was restored to Deputy after the promotion test.

| Command | Result | What was verified |
| --- | --- | --- |
| `/setup-status` | PASS | Every required ID, activity source, rank map, and awardable-role map reported ready. |
| `/pab-health` | PASS | Channel reachability, send/embed/history permissions, Manage Roles, Attach Files, and role hierarchy all green. |
| `/pab-dashboard` | PASS | Queue, completed-record count, recent activity, and quick-workflow links rendered. |
| `/export-audit` | PASS | Private JSON ledger export attached without exposing token values. |
| `/member-profile` | PASS | Current Discord roles only; no personnel-jacket, IA, or disciplinary history. |
| `/training-log` | PASS | Division/date/time-zone selectors, duration derivation, member pings, approval, and `#training-records` posting. |
| `/department-record` | PASS | PAB department format, source link handling, callsign, CC, approval, and `#personnel-records` posting. |
| `/promotion-check` | PASS | Human PAB checklist, explicit “not promotion approval” language, and `#pab-approvals` routing. |
| `/personnel-status` | PASS | Today date prefill, status form, human approval, and no-role-change `#personnel-records` posting. |
| `/inactivity-review` | PASS | No tracked activity correctly required a PAB-verified manual date; private review posted with explicit no-discipline/no-role-change guardrail. |
| `/pab-announcement` | PASS | Reviewed announcement preview and `#pab-announcements` posting. |
| `/award-role` | PASS | Allow-listed `Test FTO` role added only after approval and qualification receipt posted. |
| `/remove-role` | PASS | The same role was removed only after approval and the removal receipt posted. |
| `/correct-record` | PASS | Original message link validated; correction posted while preserving the original record. |
| `/find-record` | PASS | PAB record ID search returned the receipt and open-record link. |
| `/promotion` | PASS | Deputy → Corporal Command approval changed roles and posted both personnel record and announcement; a second approved Corporal → Deputy action restored the sandbox baseline. |
| `/demotion` | REGISTERED / AUTOMATED PASS | Separate guided lower-rank selector and PAB → Command approval path is registered in the sandbox. Final approval removes configured rank role(s), adds the selected lower rank, posts/announces the demotion, and audits it; a controlled live role mutation remains a deliberate operator test. |

## Guardrail checks observed

- Awarding a role to a member whose highest role was above Ricky was refused with a clear hierarchy message; the test then used the clean sandbox member.
- Inactivity review did not infer or apply discipline. It required a verified date when no source activity existed and posted a private review only.
- Personnel status explicitly stated that it does not change roles or access.
- No IA complaints, personnel-jacket history, auto-discipline, auto-removal, or subjective promotion decision was performed.
- Discord member and role selectors produced real mentions rather than free-form text.

## Evidence

The complete browser screenshot set is in [`artifacts/command-tests/`](artifacts/command-tests/). The numbered files include modal, filled-form, preview, approval, and destination states for the workflows above.

## Code and deployment checks

- `npm test`: **38 passed**.
- `git diff --check`: passed.
- `npm run preflight`: intentionally reports missing live `.env` IDs; the protected `.env` is not the demo configuration. Demo readiness was verified through `/setup-status` and `/pab-health`.
- A guild-bound interaction guard was added so an old deployment configured for another guild ignores this guild’s interactions instead of racing the active instance.

## Post-matrix production-readiness hardening

After the Discord matrix, the release gates were tightened so these conditions fail before production use rather than during command testing:

- `npm run preflight:demo`: **passed** against the protected token/client credentials plus the committed TEST ONLY configuration.
- `DEPLOY_CONFIG_ENV_FILE=.env.demo.example npm run preflight:deploy`: **passed**; the deploy gate validated the complete candidate configuration without printing credentials.
- `npm run start:demo`: **passed** the live startup readiness gate after checking the configured guild, all destination/activity channels, required bot permissions, configured roles, and role hierarchy.
- Startup also verified the exact 19-command guild registration, rejecting missing or stale command definitions.
- A second simultaneous `npm run start:demo`: **refused before Discord login** by the same-volume process lock.
- `npm test`: **38 passed** after adding renewal, birthday, roster-comparison, and complete-rank-matrix regression tests.

## New feature validation — 2026-08-19

- Approval TTL is configurable and bounded to 1 hour–7 days (7 days by default). Pending actions receive one deduplicated reminder in the configured reminder window (one day by default); creator-authorized **Renew** resets the window, and final approval still re-checks live Discord state.
- `/my-birthday` stores only opted-in month/day data. `/remove-birthday` clears it. Annual delivery markers prevent duplicate birthday announcements.
- `SERVICE_MILESTONES_CHANNEL_ID` enables informational one-month, three-month, six-month, and yearly join-date notices; no role or access mutation is attached.
- `/roster-sync` uses a read-only Google Sheets service-account scope and reports sheet IDs missing from Discord, rank mismatches, and Discord members absent from the sheet. It has no role-write path.

The deployment and cutover procedure is now in [`RELEASE_READINESS.md`](RELEASE_READINESS.md). The stale Pi container was stopped before the matrix and its data volume was preserved; no token or third-party bot code was copied.

## Stress pass — 2026-08-18

The running TEST ONLY instance was exercised again after the release-gate changes:

- Five repeated `/pab-health` calls: **5/5 green**, with all channels, permissions, and manageable roles reachable.
- Three repeated `/setup-status` calls: **3/3 ready**, with no token or client credential displayed.
- Three invalid `/find-record` calls with neither search option: **3/3 safely rejected** with the expected validation response.
- One department-record preview was approved twice concurrently: **one** personnel record was published; the preview was consumed and no duplicate role/access mutation occurred. Evidence: [`stress-single-post-destination.png`](artifacts/command-tests/stress-single-post-destination.png).
- An award-role request targeting the server owner: **refused** with Discord's owner-management guardrail; no preview or role mutation was created. Evidence: [`stress-hierarchy-refusal.png`](artifacts/command-tests/stress-hierarchy-refusal.png).
- A training form with invalid date `02/30/2026`: **rejected before preview creation** with the shared `MM/DD/YYYY` validation response. Evidence: [`stress-invalid-training-date.png`](artifacts/command-tests/stress-invalid-training-date.png).
- Store stress script: 100 simultaneous attempts to claim one approval produced exactly 1 winner and 99 single-use refusals; 200 activity events with 10 duplicate IDs accepted exactly 10 unique events.
- A second `npm run start:demo` while Ricky was running: **refused before Discord login** by the process lock.
- Protected live preflight with incomplete `.env`: **failed closed** and listed the missing IDs/maps without exposing credentials.

## Fresh live rerun — 2026-08-19

The complete command matrix was rerun in `BCSO Bot Demo | TEST ONLY` (`1539383172536467516`) through the logged-in Discord client. The real BCSO guild was not opened or modified. `C-110 | CPL. W. Dorfman | BCSO` was the operator/trainer and `Rickya128` was the controlled sandbox member.

| Command | Result | Live result |
| --- | --- | --- |
| `/setup-status` | PASS | All required IDs, allow-lists, activity sources, rank map, and awardable-role map configured. |
| `/pab-health` | PASS | Permissions, channels, and role hierarchy green; final check showed no pending previews. |
| `/pab-dashboard` | PASS | Control panel rendered queue, completed records, recent activity, and quick workflow links. |
| `/export-audit` | PASS | Private local-ledger JSON export returned without token values. |
| `/member-profile` | PASS | Live role snapshot showed `@Deputy` only after cleanup; no IA/personnel-jacket history. |
| `/training-log` | PASS | Today prefill, division selector, MST time zone, duration, pings, preview, approval, and posted record verified. |
| `/department-record` | PASS | Callsign `C-999`, PAB record `PAB-851A50EA`, CC, preview, approval, and destination post verified. |
| `/promotion-check` | PASS | Private human-review queue post explicitly stated that no role changed. |
| `/personnel-status` | PASS | Today date prefill and `Leave of absence` record posted with explicit no-role/access-change language. |
| `/inactivity-review` | PASS | Leaving last-known-activity blank caused the bot to compute `08/18/2026` from Discord activity; private review stated no discipline or role action. |
| `/pab-announcement` | PASS | Reviewed announcement posted through the no-notification-role path. |
| `/award-role` | PASS | `@Test FTO` was added to `Rickya128` only after approval; receipt posted. |
| `/remove-role` | PASS | The temporary `@Test FTO` role was removed only after approval; receipt posted. |
| `/promotion` | PASS | Deputy → Corporal request routed to private PAB approvals and explicitly made no role change. |
| `/demotion` | REGISTERED / AUTOMATED PASS | Sandbox guild command registered; source tests cover canonical lower-rank choices, upward/lateral rejection, and rank-role replacement. |
| `/find-record` | PASS | `PAB-851A50EA` search returned the record and open-record link. |
| `/correct-record` | PASS | Valid message link produced a preview; approval posted a correction while preserving the original. |

The temporary award-role mutation was cleaned up and a final member-profile check confirmed `Rickya128` returned to `@Deputy`. Fresh browser evidence is in [`artifacts/command-tests/`](artifacts/command-tests/), including the final health capture and remaining-command overview.

## Fresh stress rerun - 2026-08-27

The current sandbox deployment was rechecked after the live-style channel cleanup and routing migration. The live server was not opened or modified.

- `npm test`: **82/82 passed**.
- Command-surface audit: **24 registered commands, 24 unique names, no duplicate options, no overlapping permission groups, and no duplicate destination check within a workflow**. Shared destinations such as `#department-records` for personnel and qualification records are intentional routing, not duplicate commands.
- Sandbox live checks: `/setup-status`, `/pab-health`, `/pab-dashboard`, `/export-audit`, `/roster-sync` staged-disabled guard, `/my-birthday`, and `/remove-birthday` all completed with specific responses and no command failures. Birthday test data was removed after verification.
- `/pab-health`: all required destinations reachable, required bot permissions present, and every configured rank/award role manageable. Optional birthday, milestone, Google, and Forum integrations correctly reported disabled/not configured.
- Role audit: 59 expected live-style roles checked; **0 missing, 0 color mismatches, 0 unexpected gray roles**. The two reported order mismatches are the known duplicate divider-name comparison false positives; the exact sandbox manifest validator reported the role order as matching.
- Container logs: Ricky online, durable store ready, startup readiness gate passed. The only log line after startup was discord.js's non-failing deprecation warning for the legacy `ephemeral` response option.
