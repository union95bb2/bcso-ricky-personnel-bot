from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    Image, KeepTogether, HRFlowable
)
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.utils import ImageReader
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "BCSO_Ricky_Owners_Manual.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#111827")
BLUE = colors.HexColor("#1F4E79")
GOLD = colors.HexColor("#C58B2A")
PALE = colors.HexColor("#F3F6FA")
MID = colors.HexColor("#D5DEE8")
INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#5B6675")
GREEN = colors.HexColor("#146C43")
RED = colors.HexColor("#9B1C31")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverKicker", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=10, leading=13, textColor=GOLD, alignment=TA_CENTER,
    spaceAfter=14, tracking=1.2,
))
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=27, leading=31, textColor=NAVY, alignment=TA_CENTER,
    spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica",
    fontSize=12, leading=17, textColor=MUTED, alignment=TA_CENTER,
    spaceAfter=18,
))
styles.add(ParagraphStyle(
    name="H1Manual", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=18, leading=22, textColor=BLUE, spaceBefore=8, spaceAfter=10,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="H2Manual", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=12.5, leading=16, textColor=NAVY, spaceBefore=10, spaceAfter=5,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="BodyManual", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.1, leading=13.2, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="SmallManual", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.8, leading=10.3, textColor=MUTED, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="BulletManual", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9, leading=12.5, textColor=INK, leftIndent=14, firstLineIndent=-8,
    bulletIndent=2, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=9.3, leading=13.4, textColor=NAVY, leftIndent=8, rightIndent=8,
    spaceBefore=5, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="CodeManual", parent=styles["BodyText"], fontName="Courier",
    fontSize=7.6, leading=10, textColor=INK, backColor=PALE,
    leftIndent=8, rightIndent=8, borderPadding=6, spaceBefore=3, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.8, leading=9.4, textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="TableCell", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.6, leading=9.6, textColor=INK,
))
styles.add(ParagraphStyle(
    name="TableCellBold", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.6, leading=9.6, textColor=INK,
))


def P(text, style="BodyManual"):
    return Paragraph(text, styles[style])


def bullets(items):
    return [P(f"- {item}", "BulletManual") for item in items]


def table(data, widths, header=True, repeatRows=1, small=False):
    converted = []
    for r, row in enumerate(data):
        converted.append([
            P(str(cell), "TableHead" if header and r == 0 else ("TableCell" if not small else "SmallManual"))
            for cell in row
        ])
    t = Table(converted, colWidths=widths, repeatRows=repeatRows if header else 0,
              hAlign="LEFT", splitByRow=1)
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, MID),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands += [("BACKGROUND", (0, 0), (-1, 0), BLUE), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
        start = 1
    else:
        start = 0
    for r in range(start, len(data)):
        if (r - start) % 2 == 0:
            commands.append(("BACKGROUND", (0, r), (-1, r), PALE))
    t.setStyle(TableStyle(commands))
    return t


def callout(text, color=GOLD):
    t = Table([[P(text, "Callout")]], colWidths=[7.0 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF8E8")),
        ("BOX", (0, 0), (-1, -1), 1, color),
        ("LINEBEFORE", (0, 0), (0, -1), 5, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def footer(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setStrokeColor(MID)
    canvas.setLineWidth(0.5)
    canvas.line(0.6 * inch, 0.48 * inch, width - 0.6 * inch, 0.48 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.6 * inch, 0.29 * inch, "Ricky BCSO Personnel Bot | Owner's Manual | Technical reference")
    canvas.drawRightString(width - 0.6 * inch, 0.29 * inch, f"Page {doc.page}")
    canvas.restoreState()


story = []

# Cover
logo = ROOT / "assets" / "bcso-pab-badge-v2-1024.png"
if logo.exists():
    im = Image(str(logo), width=1.28 * inch, height=1.28 * inch)
    im.hAlign = "CENTER"
    story += [Spacer(1, 0.38 * inch), im, Spacer(1, 0.18 * inch)]
story += [
    P("BCSO PERSONNEL ADMINISTRATION BUREAU", "CoverKicker"),
    P("Ricky", "CoverTitle"),
    P("Owner's Manual and Server Administrator Reference", "CoverTitle"),
    P("A technical operating guide for the Discord personnel workflow bot", "CoverSub"),
    Spacer(1, 0.15 * inch),
    callout("This manual describes what the bot does, what it never does, how approvals work, and exactly how to install, test, operate, and troubleshoot it. It is written for server owners, developers, Command, and PAB staff."),
    Spacer(1, 0.16 * inch),
    P("Repository: github.com/union95bb2/bcso-ricky-personnel-bot", "SmallManual"),
    P("Current command matrix: 19 guild slash commands | Human approval required for every consequential action", "SmallManual"),
    PageBreak(),
]

# 1
story += [P("1. Read this first", "H1Manual")]
story += [P("Ricky is a Discord workflow application. It turns a small amount of factual staff input into a consistent BCSO/PAB record, sends it to the configured destination, and leaves a searchable receipt. It does not replace PAB or Command judgment.")]
story += [callout("The bot is not an autonomous disciplinary, Internal Affairs, promotion, or personnel-jacket system. It never decides that a member is guilty, inactive enough for discipline, eligible for promotion, or deserving of removal.", RED)]
story += [P("The operating model is deliberately two-stage:")]
story += bullets([
    "Capture: a staff member selects real Discord members and roles, completes a guided form, and receives a private preview.",
    "Review: the authorized human approves, cancels, or corrects the preview. The bot performs only the action authorized by that approval.",
    "Audit: the final Discord record and private SQLite receipt preserve what was posted, who submitted it, and which action occurred.",
])
story += [P("Scope boundary", "H2Manual")]
story += [table([
    ["In scope", "Out of scope"],
    ["Training, department, qualification, rank-request, status, activity-review, announcement, correction, search, audit export, live-role snapshot.", "IA complaints, investigations, evidence, findings, sanctions, discipline decisions, personnel-jacket history, automatic removals, automatic inactivity discipline."],
], [3.5 * inch, 3.5 * inch])]
story += [P("The separate inactivity-review workflow is allowed because it is a neutral staff-attention record. It reports activity evidence and follow-up; it does not make a disciplinary finding or alter access/roles.")]

# 2
story += [P("2. What is installed", "H1Manual")]
story += [P("The production repository is a Node.js Discord application using discord.js, a local SQLite operational ledger, a guild-bound command registration path, startup readiness gates, and a single-instance process lock.")]
story += [table([
    ["Component", "Function", "Owner action"],
    ["Discord application", "Receives slash commands, renders forms, posts embeds, applies approved role changes.", "Keep token private; grant least-privilege permissions."],
    ["SQLite ledger", "Stores pending approvals and durable receipt metadata for search/export.", "Protect the data directory and back it up under the server's personnel-record process."],
    ["Guild configuration", "Maps channels, PAB/Command roles, rank roles, awardable roles, activity sources, and time zone.", "Copy IDs carefully and validate with preflight and /pab-health."],
    ["Startup gate", "Refuses to serve if IDs, destination channels, permissions, hierarchy, or command set are incomplete.", "Treat a failed startup as a no-go, not as a warning."],
], [1.35 * inch, 3.65 * inch, 2.0 * inch])]
story += [P("The bot is guild-bound. A process configured for one guild ignores interactions from another guild, which prevents an old deployment from racing a sandbox or production instance.")]
story += [P("Public source", "H2Manual"), P("The source, tests, configuration examples, release gates, and live command report are public at github.com/union95bb2/bcso-ricky-personnel-bot. Secrets, tokens, SQLite files, and server records are intentionally excluded.")]

# 3 command reference
story += [PageBreak(), P("3. Command reference", "H1Manual")]
story += [P("The following is the exact registered command surface. Discord presents the options and forms; staff should not type free-form member mentions or role names when a selector is available.")]
cmd_rows = [
    ["Command", "Who uses it", "What it does", "Changes roles/access?"],
    ["/setup-status", "Server admin", "Reports required ID/map configuration without showing secrets.", "No"],
    ["/pab-health", "Server admin", "Read-only checks channels, permissions, bot hierarchy, managed roles, and administrator guardrails.", "No"],
    ["/pab-dashboard", "PAB", "Private queue, completed count, recent activity, and quick-workflow links.", "No"],
    ["/export-audit", "Server admin", "Private JSON export of the local receipt ledger.", "No"],
    ["/member-profile", "PAB", "Private live snapshot of current Discord roles and join date.", "No"],
    ["/training-log", "PAB", "Guided trainer/trainee/division/date/time-zone/time form; preview then post.", "No"],
    ["/department-record", "PAB", "Branded department record with callsign, optional role fields, CC, and source link.", "No"],
    ["/promotion-check", "PAB", "Documents a human eligibility review in private PAB queue; not approval.", "No"],
    ["/promotion", "PAB then Command", "Creates promotion request; Command approval is the role-change control point.", "Only after Command approval"],
    ["/award-role", "PAB", "Adds one explicitly allow-listed qualification/unit role after preview approval.", "Yes, allow-list only"],
    ["/remove-role", "PAB", "Removes one explicitly allow-listed qualification/unit role after preview approval.", "Yes, allow-list only"],
    ["/personnel-status", "PAB", "Records leave, return, transfer, or separation; no access change.", "No"],
    ["/inactivity-review", "PAB", "Neutral activity review; computes last activity when the field is blank.", "No"],
    ["/pab-announcement", "PAB", "Reviewed announcement with optional safe notification role.", "No"],
    ["/find-record", "PAB", "Searches by member or PAB record ID.", "No"],
    ["/correct-record", "PAB", "Posts an immutable correction linked to an existing message; original remains.", "No"],
    ["/my-birthday", "Any member", "Opt-in birthday notice using month/day only; no birth year is stored.", "No"],
    ["/remove-birthday", "Any member", "Deletes that member's opt-in birthday data.", "No"],
    ["/roster-sync", "Server admin", "Read-only Google Sheet comparison showing missing IDs and rank mismatches.", "No"],
]
story += [table(cmd_rows, [1.25 * inch, 1.0 * inch, 3.2 * inch, 1.55 * inch], small=True)]
story += [P("The command list is exact for the current release. After changing command definitions, run the register command for the target guild and restart through the normal release gate.", "SmallManual")]

# 4 forms
story += [P("4. Guided forms and input rules", "H1Manual")]
story += [P("Date fields use one format everywhere: MM/DD/YYYY. Promotion, role award/removal, personnel status, and training offer Today (prefill) or manual entry. Inactivity review uses MM/DD/YYYY - MM/DD/YYYY.")]
story += [P("Training form", "H2Manual")]
story += bullets([
    "Required selectors: trainer, trainee, division/program, date choice, and time zone.",
    "Optional hourly start/end dropdowns cover a one-hour day; the form validates the range and derives duration.",
    "The posted record carries the selected zone label, for example 4:00 PM MST - 5:00 PM MST.",
    "Invalid dates, reversed ranges, and malformed times are rejected before a preview exists.",
])
story += [P("Department record form", "H2Manual")]
story += [P("The member and optional role fields are Discord selectors. The factual note remains staff-entered. A source link can be preserved for traceability; Ricky does not scrape or copy source-message content automatically.")]
story += [P("Correction form", "H2Manual")]
story += [P("Use Discord's Copy Message Link on the original record. The bot validates the guild/message, captures the correction text, and creates a new linked record. It never edits or deletes the original.")]
story += [P("Birthday and milestone settings", "H2Manual")]
story += bullets([
    "Any human member may use /my-birthday with month and day to opt in. Ricky stores no birth year and does not expose the stored date in a public command response.",
    "Use /remove-birthday at any time to opt out and delete the stored month/day.",
    "If the owner configures BIRTHDAY_CHANNEL_ID, Ricky posts one annual mention. SERVICE_MILESTONES_CHANNEL_ID enables informational one-month, three-month, six-month, and yearly notices based on the Discord join date and Ricky's own approved promotion receipts for time in rank.",
])

# 5 roles and channels
story += [PageBreak(), P("5. Discord server layout", "H1Manual")]
story += [P("Roles are a Discord server configuration concern, not a bot-code concern. Use inert separator roles to make the role list readable without granting permissions. Separator names such as -----BCSO | Awards----- and -----BCSO Divisions----- should have permissions 0, be non-mentionable, and never appear in the rank or awardable maps.")]
story += [P("Required role model", "H2Manual")]
story += [table([
    ["Role", "Purpose", "Bot behavior"],
    ["PAB", "Staff allowed to submit/approve ordinary PAB workflows.", "Checked for command authorization."],
    ["Command", "Staff allowed to approve promotions.", "Required at the promotion approval step."],
    ["Actual bot/controller role", "The role assigned to Ricky that Discord uses for hierarchy.", "Must be above every rank/award role Ricky must change."],
    ["Rank roles", "Complete BCSO matrix: DST / Deputy Sheriff Trainee, Deputy, Senior Deputy, Corporal, Sergeant, Staff Sergeant, 2nd Lieutenant, 1st Lieutenant, Captain, Major, Commander, Division Chief, Chief Deputy, Assistant Sheriff, UnderSheriff, Sheriff.", "Startup requires every canonical key in RANK_ROLE_IDS; only those roles are removed/replaced by promotion."],
    ["Qualification/unit roles", "FTO, certifications, divisions, awards.", "Only IDs in AWARDABLE_ROLE_IDS may be added/removed."],
    ["Category separators", "Visual labels only.", "Permissions 0; never assign to members or map to bot actions."],
], [1.45 * inch, 3.1 * inch, 2.45 * inch])]
story += [P("Hierarchy rule", "H2Manual")]
story += [callout("Move the actual assigned Ricky role above every configured RANK_ROLE_IDS and AWARDABLE_ROLE_IDS role. Moving an unassigned controller role does nothing. Ricky can never manage the server owner, and Administrator roles are intentionally refused.", RED)]
story += [P("PAB and Command approval roles must be normal mentionable roles (or Ricky must have Mention Everyone) for restricted group pings to notify staff. /pab-health flags non-mentionable, managed, or elevated approval roles.", "SmallManual")]
story += [P("Recommended records category", "H2Manual")]
story += [table([
    ["Channel", "Ordinary members", "PAB/Command", "Ricky"],
    ["#training-records", "View", "View/send", "View/send/embed"],
    ["#personnel-records", "View", "View/send", "View/send/embed"],
    ["#pab-approvals", "No access", "View/send", "View/send/embed"],
    ["#pab-audit-log", "No access", "View", "View/send/embed"],
    ["#qualification-records", "View", "View/send", "View/send/embed"],
    ["#promotion-announcements", "View", "View/send", "View/send/embed"],
    ["#pab-announcements", "View", "View/send", "View/send/embed"],
    ["#pab-inactivity-review", "No access", "View/send", "View/send/embed"],
], [1.75 * inch, 1.35 * inch, 1.65 * inch, 2.25 * inch])]
story += [P("Normal text channels are the supported baseline. Forum/thread routing can be introduced later, after the primary text-channel workflow is stable.", "SmallManual")]

# 6 approval flows
story += [P("6. Approval flows", "H1Manual")]
story += [P("Every consequential workflow has a private preview. The preview is the control boundary. If a field, member, role, channel, ping, or date is wrong, cancel and run the command again.")]
story += [P("Training / department / status / announcement", "H2Manual")]
story += bullets([
    "PAB selects members and roles, completes the form, and reviews the preview.",
    "PAB clicks Approve & post (or Approve & announce).",
    "Ricky posts the formatted record to the configured destination and writes the receipt.",
])
story += [P("Promotion", "H2Manual")]
story += bullets([
    "PAB runs /promotion and submits the factual request. No role changes occur.",
    "The request routes to private #pab-approvals.",
    "PAB clicks PAB review & forward after checking the member, current rank, new rank, date, authorization, and reference.",
    "Ricky updates the request and pings Command. Only the Command approve & apply action can replace configured rank roles, post the personnel record, announce the promotion, and log the audit receipt.",
])
story += [P("Award / remove role", "H2Manual")]
story += bullets([
    "PAB selects a member and an allow-listed qualification/unit role.",
    "Ricky refuses rank, PAB, Command, managed, Administrator, or unallow-listed roles.",
    "PAB reviews the private preview and approves the single role mutation.",
])
story += [P("Inactivity review", "H2Manual")]
story += bullets([
    "PAB selects a member and review period.",
    "Leave last-known activity blank to use the latest tracked timestamp from approved activity channels, or enter a verified override when the ledger has no event.",
    "The result is private and neutral. It applies no discipline, role change, access change, IA finding, or automatic removal.",
])
story += [P("Approval expiry, reminders, and renewal", "H2Manual")]
story += bullets([
    "A preview lasts PENDING_ACTION_TTL_MINUTES (24 hours by default; administrators may configure 1 hour to 7 days). Every preview shows an absolute expiry timestamp and Discord's live relative countdown. A role-ping reminder is sent in private #pab-approvals during the PENDING_REMINDER_MINUTES window (1 hour by default).",
    "Every request pings the PAB role. Promotions use two gates: PAB clicks PAB review & forward, Ricky updates the same request and pings Command, then Command clicks Command approve & apply for the final role change. The creator can click Renew to create a fresh approval window; Command may also renew a promotion request. The original action is still rechecked against current members, roles, and permissions at approval time.",
    "Expired previews fail closed; they never apply a late role change. Run the command again when facts or authorization need to be refreshed.",
])
story += [P("Google Sheet roster comparison", "H2Manual")]
story += [P("Configure a Viewer-only service account, spreadsheet ID, and range, share the sheet with that service-account email, then use /roster-sync as a server administrator. The expected header row includes discord_id and may include callsign, display_name, rank, and status. See GOOGLE_SHEETS_ROSTER.md for the exact setup. Ricky reports differences for human review and never changes a Discord role from spreadsheet data.")]

# 7 setup
story += [PageBreak(), P("7. Installation and configuration", "H1Manual")]
story += [P("Use a separate private sandbox before live cutover. The repository includes demo and sandbox examples with IDs but blank credentials. Keep the token and client ID only on the protected host.")]
story += [P("Developer Portal", "H2Manual")]
story += bullets([
    "Create the Ricky application and bot user.",
    "Install with bot and applications.commands scopes.",
    "Grant only View Channels, Send Messages, Embed Links, Read Message History, Attach Files, Manage Roles, and Use Application Commands.",
    "Enable Server Members Intent. Do not grant Administrator.",
])
story += [P("Host preparation", "H2Manual")]
story += [P("Copy .env.example to .env on the protected host. Fill the IDs below. Never commit .env, data/, SQLite files, screenshots containing private personnel data, or credentials.")]
env_rows = [
    ["Variable", "Required value"],
    ["DISCORD_TOKEN", "Protected bot token; never printed or pasted into Discord."],
    ["DISCORD_CLIENT_ID", "Ricky application client ID."],
    ["DISCORD_GUILD_ID", "One target guild for this process."],
    ["PAB_ROLE_ID / COMMAND_ROLE_ID", "Exact authorization role IDs."],
    ["*_CHANNEL_ID variables", "Each configured destination/activity channel ID."],
    ["RANK_ROLE_IDS", "JSON rank-name to role-ID map; include every rank Ricky may replace."],
    ["AWARDABLE_ROLE_IDS", "Comma-separated non-rank qualification/unit role IDs only."],
    ["TIME_ZONE_LABEL", "Configured display label, such as MST."],
]
story += [table(env_rows, [1.9 * inch, 5.1 * inch])]
story += [P("Example rank map", "H2Manual"), P('{"Deputy":"123456789012345678","Senior Deputy":"234567890123456789","Corporal":"345678901234567890"}', "CodeManual")]
story += [P("Release commands", "H2Manual"), P("npm ci\nnpm run preflight:deploy\nnpm run register\nnpm start", "CodeManual")]
story += [P("Sandbox commands", "H2Manual"), P("npm run preflight:demo\nnpm run register:demo\nnpm run start:demo", "CodeManual")]
story += [P("The startup gate checks the guild, every destination/activity channel, required permissions, role maps, role hierarchy, and the exact guild command set. A failed gate is a hard no-go.")]

# 8 checks
story += [P("8. First-day commissioning checklist", "H1Manual")]
check_items = [
    "Create or confirm the PAB records channels and permissions.",
    "Create or confirm inert category separator roles; give them no permissions and do not assign them.",
    "Copy IDs with Developer Mode enabled; verify each ID against the visible name before writing .env.",
    "Place Ricky's actual assigned role above every configured rank and award role.",
    "Run npm run preflight:demo or npm run preflight:deploy; stop on any failure.",
    "Start exactly one Ricky process and confirm the startup readiness gate passes.",
    "Run /setup-status and /pab-health as a server administrator.",
    "Run one harmless test of training, department record, promotion-check, personnel-status, inactivity-review, announcement, award-role, remove-role, correction, search, and audit export.",
    "Use a clean test member for role changes; never test against the server owner.",
    "Verify the test member's baseline role is restored and /pab-health is green before handoff.",
]
story += [P(f"{i + 1}. {item}", "BulletManual") for i, item in enumerate(check_items)]
story += [P("The repository's COMMAND_TEST_REPORT.md contains the controlled Discord command matrix and screenshot evidence from the TEST ONLY guild. Add birthday, renewal, reminder, and roster-comparison checks to the commissioning run when those optional features are enabled.")]

# 9 troubleshooting
story += [PageBreak(), P("9. Troubleshooting", "H1Manual")]
trouble_rows = [
    ["Message / symptom", "Cause", "Fix"],
    ["Workflow is not ready yet", "A required ID, map, channel, or allow-list is missing.", "Run /setup-status; fill the protected config; restart; run /pab-health."],
    ["Move Ricky above it", "The actual role assigned to the bot is below a rank/award role.", "Move the assigned Ricky/controller role above every configured managed role. Do not move an unassigned role."],
    ["Bot cannot manage that member", "Target is the server owner, above Ricky, or protected by Discord hierarchy.", "Use a normal sandbox member and correct hierarchy. Never test role changes on the owner."],
    ["Role is not eligible", "Role is not in AWARDABLE_ROLE_IDS, or is rank/managed/elevated.", "Use a harmless allow-listed qualification/unit role. Never add PAB, Command, rank, moderator, or Administrator roles."],
    ["Enter time as...", "Input does not match the validated range or selected zone.", "Use the dropdowns or h:mm AM/PM - h:mm AM/PM in the selected timezone."],
    ["Preview expired", "The configured approval lifetime elapsed. The action failed closed.", "Use Renew before the deadline when more review time is needed, or rerun the command so current roles and facts are captured again."],
    ["Preview already being processed", "The single-use approval was already claimed or the UI is stale.", "Refresh the PAB queue, verify the destination receipt, and do not approve the same preview again."],
    ["Google roster comparison failed", "The sheet is not configured, inaccessible, or not shared with the service account.", "Set the protected Google variables, share the sheet with the service-account email, verify the range, and rerun /roster-sync."],
    ["Commands missing or stale", "Guild registration was not run after a command change.", "Run the target guild register command, then restart through the release gate."],
    ["Second process refuses to start", "The process lock is working.", "Stop the old instance cleanly; never run two Ricky processes for one token/guild."],
]
story += [table(trouble_rows, [1.7 * inch, 2.35 * inch, 2.95 * inch], small=True)]
story += [P("Do not solve a Discord hierarchy failure by granting Administrator. The bot is deliberately designed to fail closed and report the missing capability.")]

# 10 data
story += [P("10. Data, backups, and security", "H1Manual")]
story += bullets([
    "Published records live in Discord channels according to the server's retention rules.",
    "data/pab.sqlite contains pending approvals and searchable receipt metadata. Protect it like PAB personnel data.",
    "/export-audit produces a private JSON backup for an authorized server administrator.",
    "Unapproved previews expire after PENDING_ACTION_TTL_MINUTES, reminders are deduplicated, and expired rows are eventually purged. Renewing never bypasses final permission or hierarchy checks.",
    "Opt-in birthday data stores month/day only. Delivery markers prevent duplicate annual notices.",
    "Google Sheets credentials are read-only and belong only in the protected host environment; the service-account JSON must never be committed.",
    "Activity tracking stores member ID, timestamp, source channel, and source event ID. It does not store message content and is limited to ACTIVITY_CHANNEL_IDS.",
    "The bot does not import IA, complaint, discipline, personnel-jacket, or historical roster data.",
    "Use Docker or a supervised process with one persistent data directory. Back up the SQLite file under the approved personnel-record procedure.",
])
story += [P("Secret handling", "H2Manual"), P("Never commit .env, paste DISCORD_TOKEN into Discord, place the token in a screenshot, or attach the SQLite database to a public channel. Rotate the token in the Developer Portal if it is exposed.")]

# 11 update and ownership
story += [P("11. Ownership and updates", "H1Manual")]
story += [P("The repository is the source of truth for bot code, tests, release gates, command definitions, and documentation. The Discord guild is the source of truth for role positions, channel permissions, and server-specific IDs.")]
story += bullets([
    "Keep changes in a branch, run npm test, git diff --check, and the relevant preflight, then push to GitHub.",
    "Review the diff before deployment; never add .env or data/.",
    "Register commands only for the intended guild and maintenance window.",
    "After deployment, run /setup-status, /pab-health, and a sandbox or controlled live smoke test.",
    "If a workflow changes, update README.md, ADMIN_HANDOFF.md, COMMAND_TEST_REPORT.md, and this manual together.",
])
story += [P("Current validation baseline", "H2Manual")]
story += [table([
    ["Check", "Expected result"],
    ["npm test", "38 tests passed in the current release baseline."],
    ["npm run preflight:demo", "Demo IDs and protected credentials pass validation."],
    ["DEPLOY_CONFIG_ENV_FILE=.env.demo.example npm run preflight:deploy", "Candidate deployment configuration passes without printing secrets."],
    ["/setup-status + /pab-health", "All IDs/channels/permissions/hierarchy ready in the target guild."],
    ["Discord command matrix", "Registered commands exercised with previews, approvals, receipts, and guardrails; optional birthday and roster checks added when enabled."],
], [2.7 * inch, 4.3 * inch])]

# 12 quick reference
story += [PageBreak(), P("12. One-page operator quick reference", "H1Manual")]
story += [callout("If you remember only one thing: capture facts, review the private preview, approve intentionally, then verify the destination receipt.", GOLD)]
story += [P("Routine record", "H2Manual")]
story += [P("1. Run the command. 2. Select real members/roles. 3. Choose Today or enter MM/DD/YYYY. 4. Complete the guided form. 5. Read the preview. 6. Approve or cancel. 7. Verify the destination channel and receipt.")]
story += [P("Promotion", "H2Manual")]
story += [P("/promotion creates a private request. Command approval is required. No promotion is automatic, including after training completion.")]
story += [P("Role award/removal", "H2Manual")]
story += [P("Use only an allow-listed qualification/unit role. Preview approval is required. Rank, PAB, Command, managed, moderation, and Administrator roles are blocked.")]
story += [P("Inactivity", "H2Manual")]
story += [P("Use /inactivity-review for neutral staff follow-up. Leave last-known activity blank to use the latest tracked activity. It never disciplines, removes, or changes access.")]
story += [P("Correction", "H2Manual")]
story += [P("Copy Message Link from the original, run /correct-record, state the factual correction, approve, and preserve the original record.")]
story += [P("Admin diagnostics", "H2Manual")]
story += [P("/setup-status = configuration. /pab-health = live permissions/hierarchy. /pab-dashboard = queue. /find-record = receipt search. /export-audit = private backup. /roster-sync = read-only Google comparison. /my-birthday and /remove-birthday = member-controlled opt-in.")]
story += [Spacer(1, 0.2 * inch), HRFlowable(width="100%", thickness=1, color=GOLD), Spacer(1, 0.1 * inch)]
story += [P("This document is an operating manual for Ricky. Server-specific policy, retention, role names, and authorization decisions remain under the server owner's control.", "SmallManual")]


doc = SimpleDocTemplate(
    str(OUT), pagesize=letter, rightMargin=0.6 * inch, leftMargin=0.6 * inch,
    topMargin=0.62 * inch, bottomMargin=0.68 * inch,
    title="Ricky BCSO Personnel Bot - Owner's Manual",
    author="BCSO Personnel Administration Bureau",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
