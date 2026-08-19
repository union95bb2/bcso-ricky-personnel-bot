# Ricky Bot Google Sheets roster comparison

Ricky Bot's `/roster-sync` command is a read-only comparison. It does not add, remove, or replace Discord roles, and it does not write back to the sheet.

The integration is deliberately staged behind `GOOGLE_SHEETS_ENABLED=false`. Ricky Bot will not read the sheet while this switch is false, even if a spreadsheet ID is present.

## Sheet format

Use a header row with these columns:

| Header | Required | Purpose |
| --- | --- | --- |
| `discord_id` | Yes | The member's Discord user ID. |
| `callsign` | No | Human-readable callsign for the comparison report. |
| `display_name` | No | Roster display name. `name` is also accepted. |
| `rank` | No | Compared with Ricky Bot's configured `RANK_ROLE_IDS` map. `current_rank` and `role` are also accepted. |
| `status` | No | Informational only; never used to discipline or remove access. |

Example:

```text
discord_id,callsign,display_name,rank,status
123456789012345678,C-100,Cole Bonacorso,Corporal,Active
234567890123456789,C-907,Tyler M,Deputy,Active
```

## Setup

1. Create a Google Cloud service account and enable the Google Sheets API.
2. Give the spreadsheet **Viewer** access to the service-account email.
3. Set these protected runtime variables; do not commit them:

```text
GOOGLE_SHEETS_ENABLED=false
GOOGLE_SHEETS_SPREADSHEET_ID=the-id-from-the-sheet-url
GOOGLE_SHEETS_RANGE=Roster!A:Z
GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON={...service account JSON...}
```

4. Keep `GOOGLE_SHEETS_ENABLED=false` while preparing or testing the mapping. `/pab-health` will show the source as staged (disabled).
5. When the server owner is ready, set `GOOGLE_SHEETS_ENABLED=true`, restart Ricky Bot, run `/pab-health`, and confirm it shows enabled/configured.
6. A server administrator runs `/roster-sync` and reviews the report with PAB/Command.

The service account uses the read-only Sheets scope. A public link alone does not give Ricky Bot an identity; protected service-account JSON is still required when the integration is enabled. If the roster is wrong, correct the authoritative roster and/or Discord through the normal human workflow; Ricky Bot will not turn a spreadsheet discrepancy into an automatic role change.

## Promotion-evaluation evidence

`/promotion-check` can also read a separate promotion-evaluation sheet and place a compact evidence summary in the private PAB preview. This is an advisory answer, not an approval: PAB and Command still review the record, and Ricky Bot never changes a role because a row says `Eligible` or `Pending`.

The supplied evaluation sheet uses these columns (the long title in column A is accepted as the employee/deputy field):

| Header | Purpose |
| --- | --- |
| Employee / Deputy | Match by Discord ID when present, otherwise callsign or name. Values such as `(C-110) W. Dorfman` are supported. |
| `Current Rank` | Compared with the rank entered in the review form. |
| `Rank Sought` | Compared with the requested rank and the configured next-rank sequence. |
| `Hours of Service` | Displayed as evidence only; no minimum is invented by Ricky. |
| `Reports Made ...` | Displayed as activity evidence only. |
| `Disciplinary Actions` and `Disciplinary Details / Date` | A value other than `None`/`No` is flagged for human review. This is not an IA or discipline decision. |
| `PAB Recommendation` | `Pending`/blank remains human review; explicit positive or negative wording is shown as evidence. |
| `Supervisor Comments` | Displayed as a reference when present. |

Prepare the second source with protected variables (the service-account JSON is shared with the roster source):

```text
GOOGLE_PROMOTION_TESTS_ENABLED=false
GOOGLE_PROMOTION_TESTS_SPREADSHEET_ID=the-promotion-evaluation-sheet-id
GOOGLE_PROMOTION_TESTS_RANGE='BCSO Promotion Evaluation Roster'!A:Z
```

Keep the flag `false` while preparing. When the owner is ready, share both sheets with the service-account email, set the flag to `true`, restart Ricky Bot, and run `/promotion-check`. The preview will say whether the row was found, whether ranks align, whether the requested rank is the next configured rank, and whether the sheet still needs PAB review. A missing or stale row never blocks a human from documenting a review; it is reported as missing evidence instead.
