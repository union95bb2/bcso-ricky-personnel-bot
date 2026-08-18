# Real BCSO bot function inventory

Observed read-only from the live `[NCRP] Blaine County Sheriff's Office` server on 2026-08-18. This is a compatibility and test reference, not a bot export. No tokens, source code, private configuration, databases, member records, or messages were copied.

## Visible installed applications

The Discord slash-command picker exposed these application surfaces in the live server:

| Live application / nickname | Function visible in the server | Representative commands observed |
| --- | --- | --- |
| BCSO Roster / FiveRoster | Roster and shift statistics | `/roster divisions`, `/roster loa`, `/roster member`, `/roster members`, `/roster panel` (admin), `/roster quota`, `/roster stats`; visible messages also showed **Shift Hours** and **Active Shifts** panels |
| BCSO Advisor / Dyno | AFK/status utility and moderation utility surface | `/afk set`, `/afk mod clear`, `/afk mod clearall`, `/afk mod ignore`, `/afk mod ignored`, `/afk mod list`, `/afk mod reset` |
| RoleSync | Cross-server role equivalency management | `/setmainguild`, `/setrole` |
| BCSO Logistics / Statbot | Server, channel, member, message, invite, activity, and chart analytics | `/channel chart`, `/channel stats`, `/chart activity`, `/chart channel`, `/chart invite`, `/chart member`, `/chart message` |
| NotesBot | Voice-channel recording controls | `/join`, `/leave`, `/ignore`, `/ignoredlist`, `/config`, `/help`, `/cancel` |
| BCSO Musician V2 / FlaviBot | Music playback and voice connection | `/24-7 connect`, `/24-7 enable`, `/24-7 disable`, `/animal cat`, `/animal dog`, `/animal fox`, `/announcechannel move` |
| BCSO Musician V2a / FlaviBot 2 | Second music instance with the same visible command family | Same visible `/24-7`, animal-image, and announcement-channel commands |
| BCSO Musician / LunaBot | Music playback and premium/server controls | `/247`, `/active`, `/addserver`, `/announce`, `/artist`, `/autoplay`, `/autorejoin` |
| BCSO DJ / LunaBot Prime | Second music/DJ instance | `/247`, `/active`, `/addprevious`, `/addserver`, `/announce`, `/artist`, `/autoplay` |
| counting | Counting game | `/calc`, `/donate-saves`, `/help`, `/invite`, `/leaderboard current`, `/leaderboard high`, `/leaderboard server` |
| Grow a Tree | Community game/economy | `/about`, `/background`, `/balance`, `/composter`, `/help`, `/profile`, `/report` |

The picker showed bot nicknames and command descriptions, while the bot-command channel showed FiveRoster output such as shift hours, active-shift rankings, division totals, and all-time/month/week statistics.

## What Ricky should be compared against

Ricky is not intended to replace every bot in the server. The useful comparison is the PAB/personnel slice:

| Capability | Ricky status | Sandbox verification |
| --- | --- | --- |
| Structured training record | Implemented | `/training-log` → date/time validation → private preview → human approval → formatted post and audit receipt |
| Human-approved promotion workflow | Implemented | `/promotion` → private Command approval → rank hierarchy check → role change → personnel record → announcement → audit |
| Allow-listed qualification/unit role changes | Implemented | `/award-role` and `/remove-role` with role allow-list and hierarchy checks |
| Department record from a mobile-first form | Implemented | `/department-record` → selected member/roles → preview → approved post |
| Neutral inactivity/activity review | Implemented | `/inactivity-review`; no discipline, IA, access, or role decision is made |
| Current Discord role snapshot | Implemented | `/member-profile`; no personnel jacket, complaint, IA, or prior-record history |
| Immutable correction trail | Implemented | `/correct-record` creates a linked correction without editing/deleting the original |
| PAB dashboard, search, audit export, health checks | Implemented | `/pab-dashboard`, `/find-record`, `/export-audit`, `/setup-status`, `/pab-health` |
| Live roster/shift-hour ingestion | Not implemented | FiveRoster remains the live source; add only through an explicitly approved roster API/export integration |
| Cross-server role synchronization | Not implemented | RoleSync remains outside Ricky’s current scope |
| AFK, moderation, music, games, or voice recording | Not implemented | Deliberately left to the existing specialized bots |

## Sandbox test order

1. Confirm each installed bot has a clearly named test channel and no production credentials.
2. Run Ricky’s `/setup-status` and `/pab-health` as the sandbox administrator.
3. Test one training record with `Today`, one manually entered date, and a timezone-suffixed time range.
4. Test one promotion using harmless test rank roles; verify the preview, Command approval, hierarchy refusal, role result, announcement, and audit receipt.
5. Test award/remove using only the configured harmless qualification role.
6. Test `/department-record`, `/inactivity-review`, `/member-profile`, `/correct-record`, `/find-record`, and `/export-audit`.
7. Compare the resulting messages against the live server’s desired PAB format. Do not expect Ricky to reproduce FiveRoster, music, AFK, Statbot, RoleSync, NotesBot, or game-bot behavior unless those are separately approved feature requests.

## Boundary

This inventory is intentionally function-level. Reproducing a third-party bot requires its owner’s official invite and configuration instructions. It does not authorize extracting credentials, source code, hidden settings, private databases, or proprietary implementation details.
