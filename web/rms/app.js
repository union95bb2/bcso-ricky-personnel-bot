const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const dateText = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US") : "—";
const dateTimeText = value => value ? new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
const today = () => new Date().toISOString().slice(0, 10);
let currentAccount = null;
let currentMembers = [];
let currentRecords = [];
let searchTimer;
let activeView = "home";

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.requestId = payload.requestId || response.headers.get("x-request-id") || "";
    throw error;
  }
  return payload;
}

function showError(error) {
  const message = error.message || String(error);
  $("error-message").textContent = message;
  $("error-reference").textContent = error.requestId ? `Reference: ${error.requestId}${error.status ? ` · HTTP ${error.status}` : ""}` : "";
  $("error").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function clearError() { $("error").classList.add("hidden"); $("error-message").textContent = ""; $("error-reference").textContent = ""; }
function isPab() { return ["pab", "command", "admin"].includes(currentAccount?.accessLevel); }
function isCommand() { return ["command", "admin"].includes(currentAccount?.accessLevel); }
function setMessage(id, message, good = true) { const node = $(id); node.textContent = message; node.className = `form-message ${good ? "good" : "bad"}`; }

function showView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach(section => section.classList.toggle("hidden", section.id !== `view-${view}`));
  document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  if (view === "directory") loadMembers();
  if (view === "records") loadRecords();
  if (view === "inactivity") loadInactivity();
  if (view === "approvals") loadApprovals();
  if (view === "audit") loadAudit();
}

function renderSummary(summary) {
  $("stat-members").textContent = summary.members.total;
  $("stat-members-sub").textContent = `${summary.members.inactive} inactive · ${summary.members.separated} separated`;
  $("stat-active").textContent = summary.members.active;
  $("stat-records").textContent = summary.records.total;
  $("stat-records-sub").textContent = `${summary.records.training} training · ${summary.records.promotion} rank actions`;
  $("stat-approvals").textContent = summary.pendingApprovals;
  $("last-refresh").textContent = `Last refresh: ${dateTimeText(summary.generatedAt)}`;
  renderRecords(summary.recentRecords, "home-records", true);
  renderExpiring(summary.expiringQualifications || []);
}

function renderExpiring(records) {
  const target = $("expiring-records");
  if (!records.length) { target.innerHTML = '<p class="muted">No expiring qualifications in the next 30 days.</p>'; return; }
  target.innerHTML = `<table class="data-table compact"><thead><tr><th>Member</th><th>Record</th><th>Expires</th></tr></thead><tbody>${records.map(record => `<tr class="clickable" data-member="${esc(record.memberId)}"><td><strong>${esc(record.member.callsign || "—")}</strong><br>${esc(record.member.displayName)}</td><td>${esc(recordLabel(record))}</td><td><span class="status status-draft">${esc(dateText(record.expiresOn))}</span></td></tr>`).join("")}</tbody></table>`;
  target.querySelectorAll("[data-member]").forEach(row => row.addEventListener("click", () => openMember(row.dataset.member)));
}

async function refreshDashboard() {
  clearError();
  await Promise.all([loadSummary(), loadMembers()]);
}

function retryActiveView() {
  clearError();
  if (activeView === "directory") return loadMembers();
  if (activeView === "records") return loadRecords();
  if (activeView === "approvals") return loadApprovals();
  if (activeView === "audit") return loadAudit();
  return refreshDashboard();
}

function recordLabel(record) {
  return record.data?.summary || record.data?.subject || record.data?.notes || record.detail?.outcome || record.detail?.reason || "Structured RMS record";
}

function renderRecords(records, targetId = "records-results", compact = false) {
  if (targetId === "records-results") currentRecords = records || [];
  const target = $(targetId);
  if (!records?.length) { target.innerHTML = '<p class="muted">No records match the current register.</p>'; return; }
  target.innerHTML = `<table class="data-table"><thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Summary</th><th>Expires</th><th>Status</th></tr></thead><tbody>${records.map(record => `<tr class="clickable" data-member="${esc(record.memberId)}"><td>${esc(dateText(record.effectiveDate))}</td><td><strong>${esc(record.member.callsign || "—")}</strong><br>${esc(record.member.displayName)}</td><td><span class="record-tag">${esc(record.recordType)}</span></td><td>${esc(recordLabel(record))}</td><td>${esc(dateText(record.expiresOn))}</td><td><span class="status status-${esc(record.status)}">${esc(record.status)}</span></td></tr>`).join("")}</tbody></table>`;
  target.querySelectorAll("[data-member]").forEach(row => row.addEventListener("click", () => openMember(row.dataset.member)));
  if (compact) target.querySelector("table")?.classList.add("compact");
}

function renderInactivity(reviews) {
  const target = $("inactivity-results");
  if (!reviews?.length) { target.innerHTML = '<p class="muted">No inactive personnel are currently queued for review.</p>'; return; }
  target.innerHTML = `<table class="data-table"><thead><tr><th>Personnel</th><th>Rank</th><th>Status</th><th>Last recorded activity</th><th>Last inactivity review</th><th>Action</th></tr></thead><tbody>${reviews.map(review => `<tr><td><strong>${esc(review.member.callsign || "—")}</strong><br>${esc(review.member.displayName)}</td><td>${esc(review.member.rank || "Unassigned")}</td><td><span class="status status-${esc(review.member.status)}">${esc(review.member.status)}</span></td><td>${review.lastActivity ? `${esc(dateText(review.lastActivity.date))} · ${esc(review.lastActivity.type)}<br>${esc(review.lastActivity.summary || "No summary")}` : "No RMS activity recorded"}</td><td>${esc(dateText(review.lastReviewDate))}</td><td><button class="gov-button small open-inactivity-member" data-member="${esc(review.member.id)}">Open jacket</button></td></tr>`).join("")}</tbody></table>`;
  target.querySelectorAll("[data-member]").forEach(button => button.addEventListener("click", () => openMember(button.dataset.member)));
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function exportRecords() {
  if (!currentRecords.length) { showError(new Error("There are no records to export.")); return; }
  const rows = [["Effective date", "Callsign", "Member", "Record type", "Status", "Summary", "Record ID"], ...currentRecords.map(record => [record.effectiveDate, record.member.callsign, record.member.displayName, record.recordType, record.status, recordLabel(record), record.id])];
  const blob = new Blob([rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `ricky-rms-records-${today()}.csv`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderMembers(members) {
  currentMembers = members;
  const status = $("member-status-filter").value;
  const filtered = status ? members.filter(member => member.status === status) : members;
  if (!filtered.length) { $("member-results").innerHTML = '<p class="muted">No personnel match the current search.</p>'; return; }
  $("member-results").innerHTML = `<table class="data-table"><thead><tr><th>Callsign</th><th>Name</th><th>Rank</th><th>Status</th><th>Hire date</th><th>Discord ID</th></tr></thead><tbody>${filtered.map(member => `<tr class="clickable" data-member="${esc(member.id)}"><td><strong>${esc(member.callsign || "—")}</strong></td><td>${esc(member.displayName)}</td><td>${esc(member.rank || "Unassigned")}</td><td><span class="status status-${esc(member.status)}">${esc(member.status)}</span></td><td>${esc(dateText(member.hireDate))}</td><td class="mono">${esc(member.discordId)}</td></tr>`).join("")}</tbody></table>`;
  $("member-results").querySelectorAll("[data-member]").forEach(row => row.addEventListener("click", () => openMember(row.dataset.member)));
  fillRecordMemberSelect(filtered);
}

async function loadMembers() {
  if (!isPab()) { $("member-results").innerHTML = '<p class="muted">PAB access is required to search the directory.</p>'; return; }
  try { const data = await api(`/api/members?q=${encodeURIComponent($("member-search").value)}&limit=100`); renderMembers(data.members); } catch (error) { showError(error); }
}

async function syncRoster() {
  if (!isPab()) return;
  const button = $("sync-roster-button");
  button.disabled = true;
  button.textContent = "Syncing…";
  clearError();
  try {
    const result = await api("/api/sync", { method: "POST", body: "{}" });
    button.textContent = `Synced ${result.count} members`;
    await loadMembers();
    await loadSummary();
    window.setTimeout(() => { button.textContent = "Sync Discord roster"; }, 2500);
  } catch (error) {
    button.textContent = "Sync failed";
    showError(error);
    window.setTimeout(() => { button.textContent = "Sync Discord roster"; }, 2500);
  } finally {
    button.disabled = false;
  }
}

async function openMember(id) {
  clearError();
  try {
    const data = await api(`/api/members/${encodeURIComponent(id)}`);
    $("member-panel").dataset.memberId = data.member.id;
    $("member-title").textContent = `${data.member.callsign || "No callsign"} · ${data.member.displayName}`;
    $("member-summary").innerHTML = `<div><span>Rank</span><strong>${esc(data.member.rank || "Unassigned")}</strong></div><div><span>Status</span><strong>${esc(data.member.status)}</strong></div><div><span>Hire date</span><strong>${esc(dateText(data.member.hireDate))}</strong></div><div><span>Time zone</span><strong>${esc(data.member.timeZone || "—")}</strong></div><div><span>Discord ID</span><strong class="mono">${esc(data.member.discordId)}</strong></div>`;
    const latest = data.timeline[0];
    $("member-activity").innerHTML = `<strong>Last recorded activity:</strong> ${latest ? `${esc(dateText(latest.effectiveDate))} · ${esc(latest.recordType)} · ${esc(recordLabel(latest))}` : "No RMS activity has been recorded."}`;
    $("eligibility-result").classList.add("hidden");
    $("member-timeline").innerHTML = data.timeline.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Entry</th><th>Entered by</th></tr></thead><tbody>${data.timeline.map(item => `<tr class="clickable" data-record="${esc(item.id)}"><td>${esc(dateText(item.effectiveDate))}</td><td><span class="record-tag">${esc(item.recordType)}</span></td><td>${esc(recordLabel(item))}</td><td class="mono">${esc(item.createdBy)}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No RMS records have been entered for this member.</p>';
    $("member-timeline").querySelectorAll("[data-record]").forEach(row => row.addEventListener("click", () => showRecordDetail(data.timeline.find(item => item.id === row.dataset.record))));
    $("record-detail").classList.add("hidden");
    $("member-panel").classList.remove("hidden");
    $("member-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { showError(error); }
}

async function checkEligibility() {
  const memberId = $("member-panel").dataset.memberId;
  if (!memberId) return;
  const requestedRank = window.prompt("Requested rank for this advisory check (optional):", "");
  if (requestedRank === null) return;
  try {
    const query = requestedRank.trim() ? `?requestedRank=${encodeURIComponent(requestedRank.trim())}` : "";
    const result = await api(`/api/members/${encodeURIComponent(memberId)}/eligibility${query}`);
    $("eligibility-result").innerHTML = `<strong>Advisory eligibility check: ${esc(result.recommendation)}</strong><span>${esc(result.blockers.length ? result.blockers.join(" ") : "No current RMS blockers found. PAB and Command still decide eligibility and promotion.")}</span><small>Evidence: ${esc(result.evidence.training)} training · ${esc(result.evidence.qualifications)} qualifications · ${esc(result.evidence.promotions)} promotions</small>`;
    $("eligibility-result").classList.remove("hidden");
  } catch (error) { showError(error); }
}

function showRecordDetail(record) {
  if (!record) return;
  const detail = record.detail || {};
  const fields = Object.entries(detail).filter(([, value]) => value !== null && value !== undefined && value !== "").map(([key, value]) => `<div><span>${esc(key.replaceAll("_", " "))}</span><strong>${esc(value)}</strong></div>`).join("");
  $("record-detail").innerHTML = `<div class="panel-heading"><h3>Record detail</h3><button id="close-record-detail" class="text-button">Close</button></div><div class="record-detail-grid"><div><span>Record type</span><strong>${esc(record.recordType)}</strong></div><div><span>Effective date</span><strong>${esc(dateText(record.effectiveDate))}</strong></div><div><span>Status</span><strong>${esc(record.status)}</strong></div><div><span>Record ID</span><strong class="mono">${esc(record.id)}</strong></div>${fields}</div><p class="record-detail-note">This view is read-only. Corrections must be entered through the approved RMS workflow.</p>`;
  $("record-detail").classList.remove("hidden");
  $("close-record-detail").addEventListener("click", () => $("record-detail").classList.add("hidden"));
}

async function loadRecords() {
  if (!isPab()) { $("records-results").innerHTML = '<p class="muted">PAB access is required to view the records register.</p>'; return; }
  try { const query = new URLSearchParams({ limit: "500" }); if ($("record-search").value.trim()) query.set("q", $("record-search").value.trim()); if ($("record-type-filter").value) query.set("type", $("record-type-filter").value); if ($("record-status-filter").value) query.set("status", $("record-status-filter").value); const data = await api(`/api/records?${query}`); renderRecords(data.records); fillRecordMemberSelect(currentMembers); } catch (error) { showError(error); }
}

async function loadInactivity() {
  if (!isPab()) { $("inactivity-results").innerHTML = '<p class="muted">PAB access is required to view activity review.</p>'; return; }
  try { const data = await api("/api/inactivity"); renderInactivity(data.reviews); } catch (error) { showError(error); }
}

function fillRecordMemberSelect(members = currentMembers) {
  const select = $("record-member");
  if (!select) return;
  const selected = select.value;
  select.innerHTML = members.map(member => `<option value="${esc(member.id)}">${esc(member.callsign || "—")} · ${esc(member.displayName)}</option>`).join("");
  if (selected && members.some(member => member.id === selected)) select.value = selected;
}

async function loadApprovals() {
  if (!isPab()) { $("approval-results").innerHTML = '<p class="muted">PAB access is required to view the approval queue.</p>'; return; }
  try {
    const data = await api("/api/approvals");
    const renewalLabel = data.renewalWindowMinutes >= 24 * 60 && data.renewalWindowMinutes % (24 * 60) === 0 ? `${data.renewalWindowMinutes / (24 * 60)}d` : `${Math.round(data.renewalWindowMinutes / 60)}h`;
    $("approval-results").innerHTML = data.approvals.length ? `<table class="data-table"><thead><tr><th>Requested</th><th>Workflow</th><th>Stage</th><th>Requested by</th><th>Decision window</th><th>Action</th></tr></thead><tbody>${data.approvals.map(approval => `<tr><td>${esc(dateTimeText(approval.requestedAt))}</td><td>${esc(approval.workflowType)}</td><td>${esc(approval.stage)}</td><td class="mono">${esc(approval.requestedBy)}</td><td>${approval.expiresAt ? `<span class="approval-countdown" data-expires="${esc(approval.expiresAt)}">${esc(dateTimeText(approval.expiresAt))}</span>` : '<span class="muted">No expiry</span>'}</td><td class="action-cell"><button class="gov-button small approve-button" data-approval="${esc(approval.id)}" data-decision="approved">Approve</button><button class="gov-button small reject-button" data-approval="${esc(approval.id)}" data-decision="rejected">Reject</button><button class="gov-button small renew-button" data-approval="${esc(approval.id)}">Renew 24h</button></td></tr>`).join("")}</tbody></table>` : '<p class="muted">There are no open approvals.</p>';
    $("approval-results").querySelectorAll(".renew-button").forEach(button => { button.textContent = `Renew ${renewalLabel}`; });
    updateApprovalCountdowns();
    $("approval-results").querySelectorAll(".approve-button, .reject-button").forEach(button => button.addEventListener("click", () => decideApproval(button.dataset.approval, button.dataset.decision)));
    $("approval-results").querySelectorAll(".renew-button").forEach(button => button.addEventListener("click", () => renewApproval(button.dataset.approval)));
  } catch (error) { showError(error); }
}

function updateApprovalCountdowns() {
  document.querySelectorAll(".approval-countdown").forEach(node => {
    const remaining = Number(node.dataset.expires) - Date.now();
    if (remaining <= 0) { node.textContent = "Expired — refresh queue"; node.classList.add("expired"); return; }
    const hours = Math.floor(remaining / 3_600_000);
    const minutes = Math.floor((remaining % 3_600_000) / 60_000);
    node.textContent = `${dateTimeText(node.dataset.expires)} · ${hours}h ${minutes}m remaining`;
  });
}

async function decideApproval(id, status) {
  const notes = window.prompt(`${status === "approved" ? "Approval" : "Rejection"} note (optional):`, "");
  if (notes === null) return;
  try { await api(`/api/approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body: JSON.stringify({ status, notes }) }); await loadApprovals(); await loadSummary(); } catch (error) { showError(error); }
}

async function renewApproval(id) {
  if (!window.confirm("Renew this approval using the configured review window?")) return;
  try { await api(`/api/approvals/${encodeURIComponent(id)}/renew`, { method: "POST", body: "{}" }); await loadApprovals(); await loadSummary(); } catch (error) { showError(error); }
}

async function loadAudit() {
  if (!isCommand()) { $("audit-results").innerHTML = '<p class="muted">Command access is required to view the audit log.</p>'; return; }
  try { const data = await api("/api/audit"); $("audit-results").innerHTML = data.events.length ? `<table class="data-table"><thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Actor</th></tr></thead><tbody>${data.events.map(event => `<tr><td>${esc(dateTimeText(event.createdAt))}</td><td>${esc(event.action)}</td><td>${esc(event.entityType)}<br><span class="mono">${esc(event.entityId || "")}</span></td><td class="mono">${esc(event.actorDiscordId || "system")}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No audit activity has been recorded.</p>'; } catch (error) { showError(error); }
}

async function loadSummary() { if (!isPab()) return; try { renderSummary(await api("/api/summary")); } catch (error) { showError(error); } }

function openForm(id) { $(id).classList.remove("hidden"); $(id).scrollIntoView({ behavior: "smooth", block: "start" }); }
function closeForms() { $("member-form-panel").classList.add("hidden"); $("record-form-panel").classList.add("hidden"); }

async function saveMember(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  try { await api("/api/members", { method: "POST", body: JSON.stringify(body) }); setMessage("member-form-message", "Personnel saved."); event.currentTarget.reset(); closeForms(); await loadMembers(); await loadSummary(); } catch (error) { setMessage("member-form-message", error.message, false); }
}

async function saveRecord(event) {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
  const data = { summary: fields.summary, notes: fields.notes };
  const detail = { trainingType: fields.trainingType, timeZone: fields.timeZone, fromRank: fields.fromRank, toRank: fields.toRank, promotionDate: fields.effectiveDate, trainingDate: fields.effectiveDate, notes: fields.notes, outcome: fields.summary, trainerDiscordId: currentAccount?.discordId };
  try { await api("/api/records", { method: "POST", body: JSON.stringify({ memberId: fields.memberId, recordType: fields.recordType, effectiveDate: fields.effectiveDate, expiresOn: fields.expiresOn || null, data, detail }) }); setMessage("record-form-message", "Official record saved."); event.currentTarget.reset(); event.currentTarget.elements.effectiveDate.value = today(); closeForms(); await loadRecords(); await loadSummary(); } catch (error) { setMessage("record-form-message", error.message, false); }
}

async function boot() {
  try {
    const data = await api("/api/me");
    currentAccount = data.account;
    $("signed-out").classList.add("hidden"); $("app").classList.remove("hidden");
    $("identity").textContent = data.member ? `${data.member.callsign || "No callsign"} · ${data.member.displayName}` : `Discord member ${data.account.discordId}`;
    $("access-level").textContent = data.account.accessLevel.toUpperCase();
    if (!isPab()) { document.querySelectorAll("[data-pab-only]").forEach(node => node.classList.add("hidden")); }
    $("new-member-button").classList.toggle("hidden", !isPab()); $("new-record-button").classList.toggle("hidden", !isPab()); $("sync-roster-button").classList.toggle("hidden", !isPab());
    await loadSummary();
    await loadMembers();
    showView("home");
  } catch (error) { if (!/Sign in/.test(error.message)) showError(error); }
}

document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
$("member-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadMembers, 250); });
$("member-status-filter").addEventListener("change", () => renderMembers(currentMembers));
$("record-type-filter").addEventListener("change", loadRecords); $("record-status-filter").addEventListener("change", loadRecords); $("refresh-records").addEventListener("click", loadRecords);
$("record-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadRecords, 250); }); $("export-records").addEventListener("click", exportRecords);
$("refresh-inactivity").addEventListener("click", loadInactivity);
$("refresh-approvals").addEventListener("click", loadApprovals); $("refresh-audit").addEventListener("click", loadAudit);
window.setInterval(updateApprovalCountdowns, 30_000);
$("sync-roster-button").addEventListener("click", syncRoster);
$("refresh-dashboard").addEventListener("click", refreshDashboard);
$("retry-request").addEventListener("click", retryActiveView);
$("check-eligibility").addEventListener("click", checkEligibility);
$("new-member-button").addEventListener("click", () => openForm("member-form-panel")); $("new-record-button").addEventListener("click", () => { $("record-form").elements.effectiveDate.value = today(); openForm("record-form-panel"); });
$("close-member").addEventListener("click", () => $("member-panel").classList.add("hidden")); $("print-member").addEventListener("click", () => window.print()); document.querySelectorAll(".close-form").forEach(button => button.addEventListener("click", closeForms));
$("member-form").addEventListener("submit", saveMember); $("record-form").addEventListener("submit", saveRecord);
boot();
