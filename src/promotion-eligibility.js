import { BCSO_RANK_MATRIX } from "./rank-matrix.js";

const RANKS = BCSO_RANK_MATRIX.map(({ key, displayName, aliases }) => ({
  key,
  names: [key, displayName, ...(aliases || [])].map(normalizeText)
}));

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function rowValue(row, aliases = [], predicate = null) {
  const entries = Object.entries(row || {});
  for (const alias of aliases) {
    const exact = entries.find(([key]) => key === alias);
    if (exact && String(exact[1] || "").trim()) return String(exact[1]).trim();
  }
  if (predicate) {
    const match = entries.find(([key, value]) => predicate(key) && String(value || "").trim());
    if (match) return String(match[1]).trim();
  }
  return "";
}

function extractCallsign(value) {
  return String(value || "").match(/\bC-?\d{1,4}\b/i)?.[0].replace(/^C(\d)/i, "C-$1").toUpperCase() || "";
}

function canonicalRank(value) {
  const normalized = normalizeText(value);
  return RANKS.find(rank => rank.names.includes(normalized))?.key || String(value || "").trim();
}

function rankIndex(value) {
  const key = canonicalRank(value);
  return RANKS.findIndex(rank => rank.key === key);
}

function rowIdentity(row) {
  const id = rowValue(row, ["discord_id", "user_id", "member_id"]);
  const callsign = extractCallsign(rowValue(row, ["callsign", "badge_number", "badge"]));
  const employee = rowValue(row, ["employee_deputy", "employee", "deputy"], key => /employee|deputy/.test(key));
  const employeeCallsign = extractCallsign(employee);
  const name = rowValue(row, ["display_name", "name", "employee_name"], key => /name/.test(key)) || employee.replace(/\(C-?\d{1,4}\)/ig, "").trim();
  return { id, callsign: callsign || employeeCallsign, name };
}

function memberIdentity(member, rosterRows = []) {
  const values = [member?.id, member?.nickname, member?.displayName, member?.user?.globalName, member?.user?.username].filter(Boolean).map(String);
  const callsigns = new Set(values.map(extractCallsign).filter(Boolean));
  const names = new Set(values.map(normalizeText).filter(Boolean));
  const roster = rosterRows.find(row => String(row.discord_id || row.user_id || row.member_id || "") === String(member?.id || ""));
  if (roster) {
    const identity = rowIdentity(roster);
    if (identity.callsign) callsigns.add(identity.callsign);
    if (identity.name) names.add(normalizeText(identity.name));
  }
  return { ids: new Set(member?.id ? [String(member.id)] : []), callsigns, names };
}

function matchesMember(row, identity) {
  const candidate = rowIdentity(row);
  if (candidate.id && identity.ids.has(candidate.id)) return { candidate, reason: "Discord ID" };
  if (candidate.callsign && identity.callsigns.has(candidate.callsign)) return { candidate, reason: "callsign" };
  const candidateName = normalizeText(candidate.name);
  if (candidateName && [...identity.names].some(name => name === candidateName || name.includes(candidateName) || candidateName.includes(name))) {
    return { candidate, reason: "name" };
  }
  return null;
}

function clearDiscipline(value) {
  return ["", "none", "no", "n/a", "na", "0", "clear", "no disciplinary actions", "no action"].includes(normalizeText(value));
}

function recommendationState(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "missing";
  if (/(deny|denied|not eligible|hold|reject|rejected|ineligible)/.test(normalized)) return "not-eligible";
  if (/(eligible|approved|approve|pass|passed|recommend)/.test(normalized) && !/(pending|review)/.test(normalized)) return "positive";
  if (/(pending|review|incomplete|await)/.test(normalized)) return "pending";
  return "other";
}

function formatCheck(label, state, detail) {
  return { label, state, detail };
}

/**
 * Compare one Discord member against the read-only promotion evaluation sheet.
 * This is an evidence summary for PAB; it never grants approval or changes a role.
 */
export function evaluatePromotionEligibility({ rows = [], rosterRows = [], member, memberRank = "", currentRank = "", requestedRank = "" } = {}) {
  const identity = memberIdentity(member, rosterRows);
  const row = rows.find(candidate => matchesMember(candidate, identity));
  const match = row ? matchesMember(row, identity) : null;
  if (!match) {
    return {
      matched: false,
      answer: "No promotion evaluation row found",
      checks: [formatCheck("Evaluation row", "missing", "No matching Discord ID, callsign, or name was found.")],
      source: "Google promotion evaluation sheet",
      row: null
    };
  }

  const evaluationCurrent = canonicalRank(rowValue(row, ["current_rank", "rank", "current"]));
  const evaluationRequested = canonicalRank(rowValue(row, ["rank_sought", "requested_rank", "rank_requested", "target_rank"]));
  const actualCurrent = canonicalRank(currentRank);
  const observedCurrent = canonicalRank(memberRank);
  const actualRequested = canonicalRank(requestedRank);
  const expectedNext = rankIndex(actualCurrent) >= 0 ? RANKS[rankIndex(actualCurrent) + 1]?.key || "" : "";
  const disciplinary = rowValue(row, ["disciplinary_actions", "discipline", "disciplinary"]);
  const recommendation = rowValue(row, ["pab_recommendation", "recommendation", "eligibility"]);
  const rankMatch = (!memberRank || !actualCurrent || observedCurrent === actualCurrent) && (!actualCurrent || !evaluationCurrent || evaluationCurrent === actualCurrent) && (!actualRequested || !evaluationRequested || evaluationRequested === actualRequested);
  const nextRank = !actualCurrent || !actualRequested || !expectedNext || actualRequested === expectedNext;
  const disciplineClear = clearDiscipline(disciplinary);
  const recommendationStatus = recommendationState(recommendation);
  const checks = [
    formatCheck("Evaluation row", "pass", `Matched by ${match.reason}${match.candidate.callsign ? ` (${match.candidate.callsign})` : ""}.`),
    formatCheck("Rank alignment", rankMatch ? "pass" : "review", rankMatch ? "Configured Discord role, sheet, and review values agree." : `Sheet lists ${evaluationCurrent || "unknown"} → ${evaluationRequested || "unknown"}; form lists ${actualCurrent || "unknown"} → ${actualRequested || "unknown"}; Discord role is ${observedCurrent || "unknown"}.`),
    formatCheck("Next-rank sequence", nextRank ? "pass" : "review", nextRank ? "Requested rank is the next configured BCSO rank." : `The configured next rank after ${actualCurrent || "the current rank"} is ${expectedNext || "not configured"}.`),
    formatCheck("Disciplinary field", disciplineClear ? "pass" : "review", disciplineClear ? "Sheet reports no disciplinary action." : `Sheet value: ${disciplinary || "blank"}. PAB must review the details.`),
    formatCheck("PAB recommendation", recommendationStatus === "positive" ? "pass" : recommendationStatus === "not-eligible" ? "fail" : "review", recommendation || "No recommendation entered."),
    formatCheck("Service / activity evidence", "info", `${rowValue(row, ["hours_of_service", "service_hours", "hours"], key => /hours.*service|service.*hours/.test(key)) || "No hours entered"}; reports: ${rowValue(row, ["reports_made", "reports", "activity"], key => /report|activity/.test(key)) || "none entered"}.`)
  ];
  const hardFail = checks.some(check => check.state === "fail") || !rankMatch;
  const needsReview = checks.some(check => check.state === "review") || recommendationStatus !== "positive";
  const answer = hardFail ? "Not eligible on the current record" : needsReview ? "Needs human PAB review" : "Eligible to submit for approval";
  return {
    matched: true,
    answer,
    matchReason: match.reason,
    checks,
    source: "Google promotion evaluation sheet",
    row: {
      callsign: match.candidate.callsign,
      name: match.candidate.name,
      currentRank: evaluationCurrent,
      requestedRank: evaluationRequested,
      hoursOfService: rowValue(row, ["hours_of_service", "service_hours", "hours"], key => /hours.*service|service.*hours/.test(key)),
      reportsMade: rowValue(row, ["reports_made", "reports", "activity"], key => /report|activity/.test(key)),
      disciplinaryActions: disciplinary,
      disciplinaryDetails: rowValue(row, ["disciplinary_details_date", "disciplinary_details", "discipline_details"]),
      pabRecommendation: recommendation,
      supervisorComments: rowValue(row, ["supervisor_comments", "supervisor_comment", "comments"]),
      lastPromotion: rowValue(row, ["date_of_last_promotion", "last_promotion", "promotion_date"])
    }
  };
}

export function promotionEligibilityLines(result) {
  if (!result) return ["Google promotion evaluation: not checked."];
  const lines = [`**Google promotion evaluation:** ${result.answer}`];
  for (const check of result.checks || []) lines.push(`${check.state === "pass" ? "✓" : check.state === "fail" ? "✗" : check.state === "info" ? "•" : "!"} **${check.label}:** ${check.detail}`);
  lines.push("Read-only evidence summary — PAB and Command still make the decision; Ricky never changes roles from a sheet.");
  return lines;
}
