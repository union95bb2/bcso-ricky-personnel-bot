export const ADMIN_COMMANDS = new Set(["setup-status", "pab-health", "export-audit", "roster-sync"]);

export const SELF_SERVICE_COMMANDS = new Set(["my-birthday", "remove-birthday"]);

export const PAB_COMMANDS = new Set([
  "training-log",
  "promotion",
  "award-role",
  "remove-role",
  "department-record",
  "correct-record",
  "promotion-check",
  "personnel-status",
  "inactivity-review",
  "member-profile",
  "pab-announcement",
  "pab-dashboard",
  "find-record"
]);

export const WORKFLOW_REQUIREMENTS = {
  "training-log": ["pabRoleId", "commandRoleId", "trainingRecordsChannelId", "auditLogChannelId"],
  promotion: ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "promotionsAnnouncementsChannelId", "auditLogChannelId", "pabApprovalsChannelId", "rankRoleIds"],
  "award-role": ["pabRoleId", "commandRoleId", "qualificationsRecordsChannelId", "auditLogChannelId", "awardableRoleIds"],
  "remove-role": ["pabRoleId", "commandRoleId", "qualificationsRecordsChannelId", "auditLogChannelId", "awardableRoleIds"],
  "department-record": ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "auditLogChannelId"],
  "correct-record": ["pabRoleId", "commandRoleId", "auditLogChannelId"],
  "promotion-check": ["pabRoleId", "commandRoleId", "pabApprovalsChannelId", "auditLogChannelId"],
  "personnel-status": ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "auditLogChannelId"],
  "inactivity-review": ["pabRoleId", "commandRoleId", "inactivityReviewChannelId", "auditLogChannelId", "activityChannelIds"],
  "pab-announcement": ["pabRoleId", "commandRoleId", "pabAnnouncementsChannelId", "auditLogChannelId"],
  "pab-dashboard": ["pabRoleId", "commandRoleId"],
  "member-profile": ["pabRoleId", "commandRoleId"],
  "find-record": ["pabRoleId", "commandRoleId"]
};

export const WORKFLOW_CHANNELS = {
  "training-log": ["trainingRecordsChannelId", "auditLogChannelId"],
  promotion: ["pabApprovalsChannelId", "personnelRecordsChannelId", "promotionsAnnouncementsChannelId", "auditLogChannelId"],
  "award-role": ["qualificationsRecordsChannelId", "auditLogChannelId"],
  "remove-role": ["qualificationsRecordsChannelId", "auditLogChannelId"],
  "department-record": ["personnelRecordsChannelId", "auditLogChannelId"],
  "correct-record": ["auditLogChannelId"],
  "promotion-check": ["pabApprovalsChannelId", "auditLogChannelId"],
  "personnel-status": ["personnelRecordsChannelId", "auditLogChannelId"],
  "inactivity-review": ["inactivityReviewChannelId", "auditLogChannelId"],
  "pab-announcement": ["pabAnnouncementsChannelId", "auditLogChannelId"]
};

export function commandCoverage(commandNames) {
  const names = new Set(commandNames);
  const known = new Set([...ADMIN_COMMANDS, ...PAB_COMMANDS, ...SELF_SERVICE_COMMANDS]);
  return {
    missingHandlers: [...names].filter(name => !known.has(name)),
    undocumentedHandlers: [...known].filter(name => !names.has(name)),
    missingRequirements: [...PAB_COMMANDS].filter(name => !WORKFLOW_REQUIREMENTS[name]),
    missingChannelChecks: [...PAB_COMMANDS].filter(name => !["pab-dashboard", "member-profile", "find-record"].includes(name) && !WORKFLOW_CHANNELS[name])
  };
}
