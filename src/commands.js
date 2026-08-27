import { SlashCommandBuilder } from "discord.js";
import { TRAINING_DIVISION_CHOICES, TRAINING_TIME_CHOICES, TRAINING_TIME_ZONES } from "./format.js";
import { BCSO_RANK_MATRIX } from "./rank-matrix.js";
import { commands as adminRoutingCommands } from "./cogs/admin-routing.js";

const DATE_CHOICES = [
  { name: "Today (prefill)", value: "today" },
  { name: "Enter manually", value: "manual" }
];

// Discord choices keep promotion intake on the canonical BCSO rank ladder.
// The value is the stable matrix key used by RANK_ROLE_IDS; aliases stay out
// of the menu so staff never have to guess which spelling Ricky accepts.
const PROMOTION_RANK_CHOICES = BCSO_RANK_MATRIX.map(({ key, displayName }) => ({
  name: key === "DST" ? `${displayName} (DST)` : displayName,
  value: key
}));

export const commands = [
  new SlashCommandBuilder()
    .setName("training-log")
    .setDescription("Create a formatted BCSO training record.")
    .addUserOption(option => option.setName("trainer").setDescription("The trainer who conducted the session.").setRequired(true))
    .addUserOption(option => option.setName("trainee").setDescription("The member who received training.").setRequired(true))
    .addStringOption(option => option.setName("division").setDescription("Division or program for this training record.").setRequired(true)
      .addChoices(...TRAINING_DIVISION_CHOICES))
    .addStringOption(option => option.setName("date").setDescription("Choose Today to pre-fill, or enter a date in the form.").setRequired(true)
      .addChoices(
        { name: "Today (prefill)", value: "today" },
        { name: "Enter manually", value: "manual" }
      ))
    .addStringOption(option => option.setName("timezone").setDescription("Timezone used for the form and posted record.").setRequired(true)
      .addChoices(...TRAINING_TIME_ZONES.map(({ name, value }) => ({ name, value }))))
    .addStringOption(option => option.setName("start-time").setDescription("Optional hourly dropdown prefill for the start time.")
      .addChoices(...TRAINING_TIME_CHOICES))
    .addStringOption(option => option.setName("end-time").setDescription("Optional hourly dropdown prefill for the end time.")
      .addChoices(...TRAINING_TIME_CHOICES)),
  new SlashCommandBuilder()
    .setName("promotion")
    .setDescription("Start a two-stage BCSO promotion and role update (PAB then Command).")
    .addUserOption(option => option.setName("member").setDescription("Member being promoted.").setRequired(true))
    .addStringOption(option => option.setName("target-rank").setDescription("Select the new rank from the BCSO rank ladder.").setRequired(true)
      .addChoices(...PROMOTION_RANK_CHOICES))
    .addStringOption(option => option.setName("date").setDescription("Choose Today to pre-fill the effective date.").setRequired(true).addChoices(...DATE_CHOICES)),
  new SlashCommandBuilder()
    .setName("demotion")
    .setDescription("Prepare and approve a BCSO demotion record and role update.")
    .addUserOption(option => option.setName("member").setDescription("Member being demoted.").setRequired(true))
    .addStringOption(option => option.setName("target-rank").setDescription("Select the lower rank being assigned.").setRequired(true)
      .addChoices(...PROMOTION_RANK_CHOICES))
    .addStringOption(option => option.setName("date").setDescription("Choose Today to pre-fill the effective date.").setRequired(true).addChoices(...DATE_CHOICES)),
  new SlashCommandBuilder()
    .setName("award-role")
    .setDescription("Award an approved BCSO qualification or unit role.")
    .addUserOption(option => option.setName("member").setDescription("Member receiving the role.").setRequired(true))
    .addRoleOption(option => option.setName("role").setDescription("Approved qualification or unit role.").setRequired(true))
    .addStringOption(option => option.setName("date").setDescription("Choose Today to pre-fill the effective date.").setRequired(true).addChoices(...DATE_CHOICES)),
  new SlashCommandBuilder()
    .setName("remove-role")
    .setDescription("Remove an approved BCSO qualification or unit role after review.")
    .addUserOption(option => option.setName("member").setDescription("Member losing the role.").setRequired(true))
    .addRoleOption(option => option.setName("role").setDescription("Approved qualification or unit role.").setRequired(true))
    .addStringOption(option => option.setName("date").setDescription("Choose Today to pre-fill the effective date.").setRequired(true).addChoices(...DATE_CHOICES)),
  new SlashCommandBuilder()
    .setName("department-record")
    .setDescription("Create the approved PAB department-record format from one mobile workflow.")
    .addUserOption(option => option.setName("member").setDescription("Member the record concerns.").setRequired(true))
    .addStringOption(option => option.setName("callsign").setDescription("Member callsign, for example C-907.").setRequired(true))
    .addRoleOption(option => option.setName("added-role").setDescription("Role added, if applicable."))
    .addRoleOption(option => option.setName("removed-role").setDescription("Role removed, if applicable."))
    .addRoleOption(option => option.setName("cc-role").setDescription("Additional role to notify, if applicable."))
    .addStringOption(option => option.setName("source-link").setDescription("Optional link to the original division record request.")),
  new SlashCommandBuilder()
    .setName("correct-record")
    .setDescription("Post an immutable PAB correction that links to an existing record.")
    .addStringOption(option => option.setName("message-link").setDescription("Copy Message Link for the record to correct.").setRequired(true)),
  new SlashCommandBuilder()
    .setName("promotion-check")
    .setDescription("Document a human PAB eligibility check before a promotion request.")
    .addUserOption(option => option.setName("member").setDescription("Member being reviewed.").setRequired(true)),
  new SlashCommandBuilder()
    .setName("promotion-case")
    .setDescription("Eligibility checklist only; never changes roles (PAB and OOTS).")
    .addUserOption(option => option.setName("member").setDescription("Member being reviewed.").setRequired(true))
    .addStringOption(option => option.setName("target-rank").setDescription("Select the rank being considered for the member.").setRequired(true)
      .addChoices(...PROMOTION_RANK_CHOICES)),
  new SlashCommandBuilder()
    .setName("personnel-status")
    .setDescription("Create a reviewed leave, transfer, separation, or return-to-duty record.")
    .addUserOption(option => option.setName("member").setDescription("Member this status record concerns.").setRequired(true))
    .addStringOption(option => option.setName("status").setDescription("Status to document.").setRequired(true)
      .addChoices(
        { name: "Leave of absence", value: "Leave of absence" },
        { name: "Return to duty", value: "Return to duty" },
        { name: "Transfer", value: "Transfer" },
        { name: "Separation", value: "Separation" }
      ))
    .addStringOption(option => option.setName("date").setDescription("Choose Today to pre-fill the effective date.").setRequired(true).addChoices(...DATE_CHOICES)),
  new SlashCommandBuilder()
    .setName("inactivity-review")
    .setDescription("Create a private PAB inactivity review for staff follow-up.")
    .addUserOption(option => option.setName("member").setDescription("Member whose activity needs a PAB review.").setRequired(true)),
  new SlashCommandBuilder()
    .setName("member-profile")
    .setDescription("Show PAB a private snapshot of a member's current Discord roles.")
    .addUserOption(option => option.setName("member").setDescription("Member to review.").setRequired(true)),
  new SlashCommandBuilder()
    .setName("personnel-history")
    .setDescription("Show PAB a private indexed personnel history for a member.")
    .addUserOption(option => option.setName("member").setDescription("Member whose records to find.").setRequired(true)),
  new SlashCommandBuilder()
    .setName("pab-announcement")
    .setDescription("Draft, review, and post a PAB announcement to the configured channel.")
    .addRoleOption(option => option.setName("notify-role").setDescription("Role to notify, if appropriate.")),
  new SlashCommandBuilder()
    .setName("pab-dashboard")
    .setDescription("Show PAB the workflow queue, recent activity, and operating status."),
  new SlashCommandBuilder()
    .setName("setup-status")
    .setDescription("Show server administrators the remaining bot configuration work."),
  new SlashCommandBuilder()
    .setName("pab-health")
    .setDescription("Run a read-only live check of configured channels, roles, and bot permissions."),
  ...adminRoutingCommands,
  new SlashCommandBuilder()
    .setName("find-record")
    .setDescription("Search the PAB receipt ledger by member or PAB record ID.")
    .addUserOption(option => option.setName("member").setDescription("Member whose records to find."))
    .addStringOption(option => option.setName("record-id").setDescription("PAB record ID, for example PAB-1234ABCD.")),
  new SlashCommandBuilder()
    .setName("export-audit")
    .setDescription("Export the local PAB receipt ledger for authorized backup or review."),
  new SlashCommandBuilder()
    .setName("my-birthday")
    .setDescription("Opt in to a birthday announcement using month and day only.")
    .addIntegerOption(option => option.setName("month").setDescription("Birth month (1-12). No birth year is stored.").setRequired(true).setMinValue(1).setMaxValue(12))
    .addIntegerOption(option => option.setName("day").setDescription("Birth day (1-31).").setRequired(true).setMinValue(1).setMaxValue(31)),
  new SlashCommandBuilder()
    .setName("remove-birthday")
    .setDescription("Remove your opt-in birthday announcement data."),
  new SlashCommandBuilder()
    .setName("roster-sync")
    .setDescription("Compare the configured Google Sheet roster with Discord; never changes roles automatically.")
].map(command => command.toJSON());
