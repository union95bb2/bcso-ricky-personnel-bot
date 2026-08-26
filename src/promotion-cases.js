export const PROMOTION_CASE_CHECKS = Object.freeze([
  { key: 'timeInRank', label: 'Time in rank' },
  { key: 'hours', label: 'Hours logged / shift or period' },
  { key: 'psd', label: 'PSD eligibility review' }
]);

export function createPromotionCaseData({ memberId, memberLabel, fromRank, toRank, createdBy, createdAt = new Date().toISOString() }) {
  return {
    memberId,
    memberLabel,
    fromRank,
    toRank,
    createdBy,
    createdAt,
    status: 'pending-verification',
    candidateRemovedAt: null,
    ticketChannelId: null,
    ticketThreadId: null,
    ticketMessageId: null,
    checks: Object.fromEntries(PROMOTION_CASE_CHECKS.map(({ key }) => [key, { state: 'pending', value: null, source: null, reviewedBy: null, reviewedAt: null }])),
    events: []
  };
}

export function caseMissingChecks(data) {
  return PROMOTION_CASE_CHECKS.filter(({ key }) => data?.checks?.[key]?.state !== 'complete');
}

export function caseIsComplete(data) {
  return caseMissingChecks(data).length === 0;
}

export function completeCaseCheck(data, key, { value, source, reviewedBy, reviewedAt = new Date().toISOString() }) {
  if (!PROMOTION_CASE_CHECKS.some(check => check.key === key)) throw new Error(`Unknown promotion case check: ${key}`);
  if (!String(value || '').trim()) throw new Error('A verification value is required.');
  const next = structuredClone(data);
  next.checks[key] = {
    state: 'complete',
    value: String(value).trim(),
    source: String(source || '').trim() || 'PAB-provided — verify source',
    reviewedBy,
    reviewedAt
  };
  next.status = caseIsComplete(next) ? 'ready-for-oots' : 'pending-verification';
  return next;
}

export function reopenCaseCheck(data, key, reason, actorId, at = new Date().toISOString()) {
  if (!PROMOTION_CASE_CHECKS.some(check => check.key === key)) throw new Error(`Unknown promotion case check: ${key}`);
  const next = structuredClone(data);
  const prior = next.checks[key];
  next.checks[key] = { state: 'pending', value: null, source: null, reviewedBy: null, reviewedAt: null };
  next.status = 'pending-verification';
  next.events = [...(next.events || []), { type: 'check-reopened', key, reason, actorId, at, prior }];
  return next;
}

export function checkDisplay(check) {
  if (!check || check.state !== 'complete') return '✕ Pending';
  return `✓ ${check.value}\nSource: ${check.source || 'PAB-provided — verify source'}\nReviewed by: <@${check.reviewedBy || 'unknown'}>`;
}
