# Ricky command-matrix test report

Test environment: `BCSO Bot Demo | TEST ONLY` (`1539383172536467516`), 2026-08-18, through the logged-in Discord client. The test used one controlled local Ricky process after an older `bcso-personnel-bot` container on `picam` was stopped. The old container was not deleted and its data volume was left intact.

## Result

All 16 registered slash commands were exercised through their real Discord surface. Form commands were taken from command picker → member/role selector → guided form → preview/approval → destination record. Role-changing tests used the clean sandbox member `Rickya128`; the member was restored to Deputy after the promotion test.

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

## Guardrail checks observed

- Awarding a role to a member whose highest role was above Ricky was refused with a clear hierarchy message; the test then used the clean sandbox member.
- Inactivity review did not infer or apply discipline. It required a verified date when no source activity existed and posted a private review only.
- Personnel status explicitly stated that it does not change roles or access.
- No IA complaints, personnel-jacket history, auto-discipline, auto-removal, or subjective promotion decision was performed.
- Discord member and role selectors produced real mentions rather than free-form text.

## Evidence

The complete browser screenshot set is in [`artifacts/command-tests/`](artifacts/command-tests/). The numbered files include modal, filled-form, preview, approval, and destination states for the workflows above.

## Code and deployment checks

- `npm test`: **34 passed**.
- `git diff --check`: passed.
- `npm run preflight`: intentionally reports missing live `.env` IDs; the protected `.env` is not the demo configuration. Demo readiness was verified through `/setup-status` and `/pab-health`.
- A guild-bound interaction guard was added so an old deployment configured for another guild ignores this guild’s interactions instead of racing the active instance.

## Post-matrix production-readiness hardening

After the Discord matrix, the release gates were tightened so these conditions fail before production use rather than during command testing:

- `npm run preflight:demo`: **passed** against the protected token/client credentials plus the committed TEST ONLY configuration.
- `DEPLOY_CONFIG_ENV_FILE=.env.demo.example npm run preflight:deploy`: **passed**; the deploy gate validated the complete candidate configuration without printing credentials.
- `npm run start:demo`: **passed** the live startup readiness gate after checking the configured guild, all destination/activity channels, required bot permissions, configured roles, and role hierarchy.
- Startup also verified the exact 16-command guild registration, rejecting missing or stale command definitions.
- A second simultaneous `npm run start:demo`: **refused before Discord login** by the same-volume process lock.
- `npm test`: **34 passed** after adding the process-lock regression test.

The deployment and cutover procedure is now in [`RELEASE_READINESS.md`](RELEASE_READINESS.md). The stale Pi container was stopped before the matrix and its data volume was preserved; no token or third-party bot code was copied.
