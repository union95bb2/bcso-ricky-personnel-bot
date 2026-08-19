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
  "personnel-history",
  "pab-announcement",
  "pab-dashboard",
  "find-record"
]);

export const WORKFLOW_REQUIREMENTS = {
  "training-log": ["pabRoleId", "commandRoleId", "trainingRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  promotion: ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "promotionsAnnouncementsChannelId", "auditLogChannelId", "pabApprovalsChannelId", "rankRoleIds"],
  "award-role": ["pabRoleId", "commandRoleId", "qualificationsRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId", "awardableRoleIds"],
  "remove-role": ["pabRoleId", "commandRoleId", "qualificationsRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId", "awardableRoleIds"],
  "department-record": ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  "correct-record": ["pabRoleId", "commandRoleId", "auditLogChannelId", "pabApprovalsChannelId"],
  "promotion-check": ["pabRoleId", "commandRoleId", "pabApprovalsChannelId", "auditLogChannelId"],
  "personnel-status": ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  "inactivity-review": ["pabRoleId", "commandRoleId", "inactivityReviewChannelId", "auditLogChannelId", "pabApprovalsChannelId", "activityChannelIds"],
  "pab-announcement": ["pabRoleId", "commandRoleId", "pabAnnouncementsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  "pab-dashboard": ["pabRoleId", "commandRoleId"],
  "member-profile": ["pabRoleId", "commandRoleId"],
  "personnel-history": ["pabRoleId", "commandRoleId"],
  "find-record": ["pabRoleId", "commandRoleId"]
};

export const WORKFLOW_CHANNELS = {
  "training-log": ["trainingRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  promotion: ["pabApprovalsChannelId", "personnelRecordsChannelId", "promotionsAnnouncementsChannelId", "auditLogChannelId"],
  "award-role": ["qualificationsRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  "remove-role": ["qualificationsRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  "department-record": ["personnelRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  "correct-record": ["auditLogChannelId", "pabApprovalsChannelId"],
  "promotion-check": ["pabApprovalsChannelId", "auditLogChannelId"],
  "personnel-status": ["personnelRecordsChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  "inactivity-review": ["inactivityReviewChannelId", "auditLogChannelId", "pabApprovalsChannelId"],
  "pab-announcement": ["pabAnnouncementsChannelId", "auditLogChannelId", "pabApprovalsChannelId"]
};

export function commandCoverage(commandNames) {
  const names = new Set(commandNames);
  const known = new Set([...ADMIN_COMMANDS, ...PAB_COMMANDS, ...SELF_SERVICE_COMMANDS]);
  return {
    missingHandlers: [...names].filter(name => !known.has(name)),
    undocumentedHandlers: [...known].filter(name => !names.has(name)),
    missingRequirements: [...PAB_COMMANDS].filter(name => !WORKFLOW_REQUIREMENTS[name]),
    missingChannelChecks: [...PAB_COMMANDS].filter(name => !["pab-dashboard", "member-profile", "personnel-history", "find-record"].includes(name) && !WORKFLOW_CHANNELS[name])
  };
}
