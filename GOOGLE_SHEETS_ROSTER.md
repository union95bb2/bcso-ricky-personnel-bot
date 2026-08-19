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
