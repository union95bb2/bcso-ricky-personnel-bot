import { configLabels, configurationIssues } from "./config.js";

const issues = configurationIssues(Object.keys(configLabels));
if (issues.length) {
  console.error("BCSO Personnel Bot preflight failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("Fix the protected .env file, then run npm run preflight again.");
  process.exitCode = 1;
} else {
  console.log("BCSO Personnel Bot preflight passed. Run /pab-health after the bot is installed to verify live permissions and role hierarchy.");
}
