const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const dateText = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US") : "—";
const dateTimeText = value => value ? new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
const today = () => new Date().toISOString().slice(0, 10);
let currentAccount = null;
let currentMembers = [];
let searchTimer;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function showError(error) { $("error").textContent = error.message || String(error); $("error").classList.remove("hidden"); window.scrollTo({ top: 0, behavior: "smooth" }); }
function clearError() { $("error").classList.add("hidden"); }
function isPab() { return ["pab", "command", "admin"].includes(currentAccount?.accessLevel); }
function isCommand() { return ["command", "admin"].includes(currentAccount?.accessLevel); }
function setMessage(id, message, good = true) { const node = $(id); node.textContent = message; node.className = `form-message ${good ? "good" : "bad"}`; }

function showView(view) {
  document.querySelectorAll(".view").forEach(section => section.classList.toggle("hidden", section.id !== `view-${view}`));
  document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  if (view === "directory") loadMembers();
  if (view === "records") loadRecords();
  if (view === "approvals") loadApprovals();
  if (view === "audit") loadAudit();
}

function renderSummary(summary) {
  $("stat-members").textContent = summary.members.total;
  $("stat-members-sub").textContent = `${summary.members.inactive} inactive · ${summary.members.separated} separated`;
  $("stat-active").textContent = summary.members.active;
  $("stat-records").textContent = summary.records.total;
  $("stat-records-sub").textContent = `${summary.records.training} training · ${summary.records.promotion} promotion`;
  $("stat-approvals").textContent = summary.pendingApprovals;
  $("last-refresh").textContent = `Last refresh: ${dateTimeText(summary.generatedAt)}`;
  renderRecords(summary.recentRecords, "home-records", true);
}

function recordLabel(record) {
  return record.data?.summary || record.data?.subject || record.data?.notes || record.detail?.outcome || record.detail?.reason || "Structured RMS record";
}

function renderRecords(records, targetId = "records-results", compact = false) {
  const target = $(targetId);
  if (!records?.length) { target.innerHTML = '<p class="muted">No records match the current register.</p>'; return; }
  target.innerHTML = `<table class="data-table"><thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Summary</th><th>Status</th></tr></thead><tbody>${records.map(record => `<tr class="clickable" data-member="${esc(record.memberId)}"><td>${esc(dateText(record.effectiveDate))}</td><td><strong>${esc(record.member.callsign || "—")}</strong><br>${esc(record.member.displayName)}</td><td><span class="record-tag">${esc(record.recordType)}</span></td><td>${esc(recordLabel(record))}</td><td><span class="status status-${esc(record.status)}">${esc(record.status)}</span></td></tr>`).join("")}</tbody></table>`;
  target.querySelectorAll("[data-member]").forEach(row => row.addEventListener("click", () => openMember(row.dataset.member)));
  if (compact) target.querySelector("table")?.classList.add("compact");
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

async function openMember(id) {
  clearError();
  try {
    const data = await api(`/api/members/${encodeURIComponent(id)}`);
    $("member-title").textContent = `${data.member.callsign || "No callsign"} · ${data.member.displayName}`;
    $("member-summary").innerHTML = `<div><span>Rank</span><strong>${esc(data.member.rank || "Unassigned")}</strong></div><div><span>Status</span><strong>${esc(data.member.status)}</strong></div><div><span>Hire date</span><strong>${esc(dateText(data.member.hireDate))}</strong></div><div><span>Time zone</span><strong>${esc(data.member.timeZone || "—")}</strong></div><div><span>Discord ID</span><strong class="mono">${esc(data.member.discordId)}</strong></div>`;
    $("member-timeline").innerHTML = data.timeline.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Entry</th><th>Entered by</th></tr></thead><tbody>${data.timeline.map(item => `<tr><td>${esc(dateText(item.effectiveDate))}</td><td><span class="record-tag">${esc(item.recordType)}</span></td><td>${esc(recordLabel(item))}</td><td class="mono">${esc(item.createdBy)}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No RMS records have been entered for this member.</p>';
    $("member-panel").classList.remove("hidden");
    $("member-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { showError(error); }
}

async function loadRecords() {
  if (!isPab()) { $("records-results").innerHTML = '<p class="muted">PAB access is required to view the records register.</p>'; return; }
  try { const query = new URLSearchParams({ limit: "500" }); if ($("record-type-filter").value) query.set("type", $("record-type-filter").value); if ($("record-status-filter").value) query.set("status", $("record-status-filter").value); const data = await api(`/api/records?${query}`); renderRecords(data.records); fillRecordMemberSelect(currentMembers); } catch (error) { showError(error); }
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
    $("approval-results").innerHTML = data.approvals.length ? `<table class="data-table"><thead><tr><th>Requested</th><th>Workflow</th><th>Stage</th><th>Requested by</th><th>Action</th></tr></thead><tbody>${data.approvals.map(approval => `<tr><td>${esc(dateTimeText(approval.requestedAt))}</td><td>${esc(approval.workflowType)}</td><td>${esc(approval.stage)}</td><td class="mono">${esc(approval.requestedBy)}</td><td class="action-cell"><button class="gov-button small approve-button" data-approval="${esc(approval.id)}" data-decision="approved">Approve</button><button class="gov-button small reject-button" data-approval="${esc(approval.id)}" data-decision="rejected">Reject</button></td></tr>`).join("")}</tbody></table>` : '<p class="muted">There are no open approvals.</p>';
    $("approval-results").querySelectorAll("[data-approval]").forEach(button => button.addEventListener("click", () => decideApproval(button.dataset.approval, button.dataset.decision)));
  } catch (error) { showError(error); }
}

async function decideApproval(id, status) {
  const notes = window.prompt(`${status === "approved" ? "Approval" : "Rejection"} note (optional):`, "");
  if (notes === null) return;
  try { await api(`/api/approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body: JSON.stringify({ status, notes }) }); await loadApprovals(); await loadSummary(); } catch (error) { showError(error); }
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
  try { await api("/api/records", { method: "POST", body: JSON.stringify({ memberId: fields.memberId, recordType: fields.recordType, effectiveDate: fields.effectiveDate, data, detail }) }); setMessage("record-form-message", "Official record saved."); event.currentTarget.reset(); $("effective-date"); closeForms(); await loadRecords(); await loadSummary(); } catch (error) { setMessage("record-form-message", error.message, false); }
}

async function boot() {
  try {
    const data = await api("/api/me");
    currentAccount = data.account;
    $("signed-out").classList.add("hidden"); $("app").classList.remove("hidden");
    $("identity").textContent = data.member ? `${data.member.callsign || "No callsign"} · ${data.member.displayName}` : `Discord member ${data.account.discordId}`;
    $("access-level").textContent = data.account.accessLevel.toUpperCase();
    if (!isPab()) { document.querySelectorAll("[data-pab-only]").forEach(node => node.classList.add("hidden")); }
    $("new-member-button").classList.toggle("hidden", !isPab()); $("new-record-button").classList.toggle("hidden", !isPab());
    await loadSummary();
    await loadMembers();
    showView("home");
  } catch (error) { if (!/Sign in/.test(error.message)) showError(error); }
}

document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
$("member-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadMembers, 250); });
$("member-status-filter").addEventListener("change", () => renderMembers(currentMembers));
$("record-type-filter").addEventListener("change", loadRecords); $("record-status-filter").addEventListener("change", loadRecords); $("refresh-records").addEventListener("click", loadRecords);
$("refresh-approvals").addEventListener("click", loadApprovals); $("refresh-audit").addEventListener("click", loadAudit);
$("new-member-button").addEventListener("click", () => openForm("member-form-panel")); $("new-record-button").addEventListener("click", () => { $("record-form").elements.effectiveDate.value = today(); openForm("record-form-panel"); });
$("close-member").addEventListener("click", () => $("member-panel").classList.add("hidden")); document.querySelectorAll(".close-form").forEach(button => button.addEventListener("click", closeForms));
$("member-form").addEventListener("submit", saveMember); $("record-form").addEventListener("submit", saveRecord);
boot();
