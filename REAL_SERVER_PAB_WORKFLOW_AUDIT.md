# Real-server PAB workflow audit

Read-only workflow reference captured from the visible BCSO Discord process on 2026-08-18. This is a clean-room compatibility reference; it is not a message export, personnel file, IA record, or third-party bot implementation.

## What the live process is doing

1. A trainer, FTO, or division coordinator submits a request in a division-specific record-request channel (for example, SAR/SEB/TED/DET or FTO request channels).
2. PAB monitors those requests and reformats the source into the approved Department Record format. The source request is not copied verbatim.
3. The finished record must identify and directly ping the member the record concerns. If a normal mention does not resolve, staff use the member's Discord ID mention.
4. PAB and any required division/Command roles are included in the CC line.
5. Role changes are handled after the record/request is reviewed; the record itself is not permission to invent a promotion or qualification decision.

## Training-log fields observed

The live training records consistently provide a division/program, trainee name and Discord ID, trainer name, trainer rank, session duration, factual trainer feedback, pass/fail or other session result, required CC, and a signed trainer/division line. Ricky's guided training form already captures the trainer, trainee, date, time zone, training completed, outcome, notes, and signer; the division/program and duration should be added when a server adopts the division-request workflow.

## Ricky parity and boundary

Ricky currently implements the PAB reformatting and approval surface through `/department-record`, `/training-log`, `/promotion`, `/promotion-check`, `/award-role`, `/remove-role`, and the correction/audit commands. It uses Discord member and role selectors so the target ping is generated from a real server object, and it previews before posting.

Ricky does **not** read or copy source-message content from division request channels. That is intentional: the bot does not use Message Content Intent, and the activity ledger stores only human message IDs/timestamps in explicitly approved channels. A PAB member still enters the factual source information into the guided form. An optional source-link field can be added later if Command wants a traceable link back to the request.

## Permission model required for this workflow

- PAB members: use the workflow commands and approve their own non-promotion previews.
- Command: approve and apply rank promotions.
- Ricky: View Channel, Send Messages, Embed Links, Read Message History, Attach Files, and Manage Roles at the server/integration level; destination channels must also grant the effective channel permissions required by that workflow.
- Ricky's **actual highest assigned role** must be above every configured rank or allow-listed qualification/unit role it changes. `/pab-health` is authoritative for the role name; moving an unassigned `Ricky Controller` role does nothing.
- No Administrator permission is required. Managed integration roles, `@everyone`, Administrator roles, PAB/Command roles, and rank roles are blocked from the award/remove allow-list.

## Deliberate scope boundary

Inactivity review is a neutral PAB activity follow-up. IA complaints, investigations, findings, policy-violation cases, sanctions, and personnel-jacket history remain outside Ricky's scope. Ricky does not make subjective decisions or automatically discipline, demote, remove, or change access for a member.
