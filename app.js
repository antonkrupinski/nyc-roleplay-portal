const SAMPLE_PROFILE = {
  name: "Alex Morgan",
  dob: "1998-04-18",
  pronouns: "They / Them",
  borough: "Manhattan",
  neighborhood: "Lower East Side",
  occupation: "Neighborhood regular",
  eyes: "Hazel",
  height: "5′ 9″",
  idNo: "NY 108 · 427 · 319"
};

const SAMPLE_VEHICLES = [
  { id: "sample-1", plate: "NYC-4281", model: "2022 Declasse Premier", color: "Midnight blue", borough: "Manhattan", status: "Registered" },
  { id: "sample-2", plate: "7BK-9012", model: "2019 Vapid Stanier", color: "Silver", borough: "Brooklyn", status: "Parked" }
];

const pageInfo = {
  profile: { title: "Profile", section: "Civilian" },
  events: { title: "Events", section: "Civilian" },
  licenses: { title: "Licenses", section: "Civilian" },
  wallet: { title: "Wallet", section: "Resident account" },
  businesses: { title: "Businesses", section: "Around the block" },
  market: { title: "Market", section: "City exchange" },
  shop: { title: "Shop", section: "City storefront" },
  vehicles: { title: "Vehicles", section: "Civilian" },
  "city-hall": { title: "City Hall", section: "City departments" },
  leo: { title: "Police MDT", section: "Law enforcement" },
  bolos: { title: "BOLOs", section: "Law enforcement" }
};

const profileKey = "nycrp.profile.v1";
const vehicleKey = "nycrp.vehicles.v1";
const marketKey = "nycrp.paper-portfolio.v1";
const defaultProfile = { ...SAMPLE_PROFILE };
let profile = { ...defaultProfile };
let vehicles = SAMPLE_VEHICLES.map((vehicle) => ({ ...vehicle }));
let portfolio = { balance: 3325, holdings: [], transactions: [] };
let marketData = null;
let currentUser = null;
let vehicleSyncStatus = "loading";
let vehicleRobloxUsername = "";
let residentAvatarImage = null;
let residentAvatarPromise = null;
let residentAvatarUserId = null;
let toastTimer;
let activeTradeSide = "buy";
let departments = [];
let departmentPageInfo = {};
let activeDepartment = null;
let activeDepartmentTab = "overview";
let adminData = null;
let activeAdminTab = "overview";

const $ = (selector, root = document) => root.querySelector(selector);
const profileModal = $("#profile-modal");
const connectModal = $("#connect-modal");
const tradeModal = $("#trade-modal");

function makeId() {
  return "NY " + [3, 3, 3].map(() => Math.floor(100 + Math.random() * 900)).join(" · ");
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value || "—";
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2900);
}

function activatePage(requestedPage, updateHistory = false) {
  const page = Object.hasOwn(pageInfo, requestedPage) || Object.hasOwn(departmentPageInfo, requestedPage) ? requestedPage : "profile";
  const info = pageInfo[page] || departmentPageInfo[page];
  const pageType = page.startsWith("department-") ? "department" : page;
  document.querySelectorAll(".route-page").forEach((section) => {
    section.classList.toggle("is-active", section.dataset.page === pageType);
  });
  document.querySelectorAll(".nav-link[data-route]").forEach((link) => {
    const active = link.dataset.route === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.body.dataset.page = page;
  setText("#breadcrumb-title", info.title);
  setText("#breadcrumb-section", info.section);
  document.title = "NYC Roleplay — " + info.title;

  if (updateHistory && window.location.hash !== "#" + page) {
    window.history.pushState({ page }, "", "#" + page);
  }
  window.scrollTo({ top: 0, behavior: "auto" });
  $("#sidebar").classList.remove("open");
  if (page.startsWith("department-")) loadDepartmentPage(page.slice("department-".length));
  if (page === "admin") loadAdminData();
  if (page === "licenses" && currentUser) void loadLicenses();
}

function currentPageFromHash() {
  return window.location.hash.slice(1) || "profile";
}

function formatCad(value) {
  const amount = Number(value);
  return "C$ " + new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}

function formatUsd(value) {
  const amount = Number(value);
  return "$" + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}

function loadGuestData() {
  try {
    const savedProfile = JSON.parse(localStorage.getItem(profileKey) || "null");
    const savedVehicles = JSON.parse(localStorage.getItem(vehicleKey) || "null");
    const savedPortfolio = JSON.parse(localStorage.getItem(marketKey) || "null");
    profile = savedProfile && typeof savedProfile === "object" ? { ...defaultProfile, ...savedProfile } : { ...defaultProfile };
    vehicles = Array.isArray(savedVehicles) ? savedVehicles : SAMPLE_VEHICLES.map((vehicle) => ({ ...vehicle }));
    portfolio = savedPortfolio && typeof savedPortfolio === "object"
      ? { balance: Number(savedPortfolio.balance) || 0, holdings: Array.isArray(savedPortfolio.holdings) ? savedPortfolio.holdings : [], transactions: Array.isArray(savedPortfolio.transactions) ? savedPortfolio.transactions : [] }
      : { balance: 3325, holdings: [], transactions: [] };
  } catch {
    profile = { ...defaultProfile };
    vehicles = SAMPLE_VEHICLES.map((vehicle) => ({ ...vehicle }));
    portfolio = { balance: 3325, holdings: [], transactions: [] };
  }
  if (!profile.idNo) profile.idNo = makeId();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function normalizeVehicleStatus(value) {
  const normalized = String(value ?? "").trim();
  const statusMap = { Registered: "Valid", Parked: "Valid", Valid: "Valid", Stolen: "Stolen", Expired: "Expired" };
  return statusMap[normalized] || "Valid";
}

function readVehicleStatusMap() {
  try {
    const raw = JSON.parse(localStorage.getItem("nycrp.vehicle-statuses.v1") || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeVehicleStatusMap(statuses) {
  localStorage.setItem("nycrp.vehicle-statuses.v1", JSON.stringify(statuses));
}

function persistVehicleList(list) {
  localStorage.setItem(vehicleKey, JSON.stringify(Array.isArray(list) ? list : []));
}

function minutesLabel(value) {
  const minutes = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function memberWeeklyMinutes(member) {
  const elapsed = member.activeShift?.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(member.activeShift.startedAt).getTime()) / 60000)) : 0;
  return (Number(member.weeklyMinutes) || 0) + elapsed;
}

function departmentRoute(id) {
  return "department-" + id;
}

function departmentBadgeMarkup(department, className = "dept-dot") {
  const logoUrl = typeof department?.logoUrl === "string" ? department.logoUrl.trim() : "";
  if (logoUrl) {
    return `<span class="${escapeHtml(className)} dept-logo-badge ${escapeHtml(department.color || "blue")}" aria-label="${escapeHtml(department.name || "Department logo")}"><img src="${escapeHtml(logoUrl)}" alt="" loading="lazy"></span>`;
  }
  return `<span class="${escapeHtml(className)} ${escapeHtml(department.color || "blue")}">${escapeHtml(department.icon || "✦")}</span>`;
}

function renderDepartmentNavigation() {
  const nav = $("#department-nav");
  if (!nav) return;
  nav.querySelectorAll("[data-dynamic-department]").forEach((link) => link.remove());
  for (const department of departments) {
    const link = document.createElement("a");
    link.className = "nav-link";
    link.href = "#" + departmentRoute(department.id);
    link.dataset.route = departmentRoute(department.id);
    link.dataset.dynamicDepartment = "true";
    link.innerHTML = `${departmentBadgeMarkup(department)}${escapeHtml(department.name)}`;
    nav.append(link);
  }
}

async function loadDepartments() {
  try {
    const data = await requestJson("/api/departments");
    departments = Array.isArray(data.departments) ? data.departments : [];
    departmentPageInfo = {};
    departments.forEach((department) => {
      departmentPageInfo[departmentRoute(department.id)] = { title: department.name, section: "City departments" };
    });
    const isAdmin = Boolean(data.seniorHighRanking);
    $("#admin-nav-section").hidden = !isAdmin;
    if (isAdmin) pageInfo.admin = { title: "Admin", section: "Senior High Ranking" };
    else delete pageInfo.admin;
    renderDepartmentNavigation();
    return true;
  } catch (error) {
    departments = [];
    departmentPageInfo = {};
    $("#admin-nav-section").hidden = true;
    return false;
  }
}

function renderLicenseCards(data) {
  const grid = $("#license-grid");
  if (!grid) return;
  const playedSeconds = Math.max(0, Math.floor(Number(data.playtimeSeconds) || 0));
  const playedMinutes = Math.floor(playedSeconds / 60);
  setText("#license-playtime-total", `${minutesLabel(playedMinutes)} tracked`);
  setText("#license-live-state", data.currentlyTracked ? "IN SERVER" : data.monitorOnline ? "NOT IN SERVER" : "MONITOR OFFLINE");
  const state = $("#license-live-state");
  if (state) state.classList.toggle("is-live", Boolean(data.currentlyTracked));

  grid.innerHTML = (data.licenses || []).map((license) => {
    const requiredSeconds = Math.max(0, Number(license.requiredSeconds) || 0);
    const requiredMinutes = Math.ceil(requiredSeconds / 60);
    const eligible = Boolean(license.eligible) || requiredSeconds === 0;
    const licensed = Boolean(license.licensed);
    const progress = requiredSeconds === 0 ? 100 : Math.min(100, (playedSeconds / requiredSeconds) * 100);
    const remainingMinutes = Math.max(0, Math.ceil((requiredSeconds - playedSeconds) / 60));
    const status = licensed ? "LICENSED" : eligible ? "READY TO CLAIM" : "IN PROGRESS";
    const requirement = requiredSeconds === 0 ? "No playtime requirement" : `Requires ${minutesLabel(requiredMinutes)} of server time`;
    const progressText = licensed
      ? `Issued ${license.issuedAt ? new Date(license.issuedAt).toLocaleDateString() : "to your resident record"}`
      : eligible ? "Requirement met — ready to claim" : `${minutesLabel(playedMinutes)} played · ${minutesLabel(remainingMinutes)} remaining`;
    const buttonLabel = licensed ? "✓ Licensed" : eligible ? "Claim license" : `${minutesLabel(remainingMinutes)} remaining`;
    return `<article class="license-card ${licensed ? "is-licensed" : ""}" data-license-card="${escapeHtml(license.id)}"><div class="license-art art-${escapeHtml(license.art)}" aria-hidden="true"><span class="license-art-label">CITY LICENSE DIVISION</span><span class="license-art-icon">${escapeHtml(license.icon)}</span><span class="license-art-title">${escapeHtml(license.name.toUpperCase())}</span></div><div class="license-card-body"><div class="license-card-heading"><div><span class="license-card-kicker">RESIDENT PERMIT</span><h2>${escapeHtml(license.name)}</h2></div><span class="license-status-pill ${licensed ? "licensed" : eligible ? "eligible" : "locked"}">${status}</span></div><p class="license-card-description">${escapeHtml(license.description)}</p><div class="license-requirement"><span>${escapeHtml(requirement)}</span>${requiredSeconds ? `<strong>${minutesLabel(playedMinutes)} / ${minutesLabel(requiredMinutes)}</strong>` : "<strong>OPEN</strong>"}</div><div class="license-progress" role="progressbar" aria-label="${escapeHtml(license.name)} playtime progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(progress)}"><span style="width:${progress}%"></span></div><div class="license-card-footer"><small>${escapeHtml(progressText)}</small><button class="button license-claim ${eligible && !licensed ? "button-primary" : "button-outline"}" type="button" data-license-claim="${escapeHtml(license.id)}" ${eligible && !licensed ? "" : "disabled"}>${escapeHtml(buttonLabel)}</button></div></div></article>`;
  }).join("") || '<div class="license-empty-state">No licenses are available right now.</div>';
}

async function loadLicenses(quiet = false) {
  const grid = $("#license-grid");
  if (!grid || !currentUser) return;
  if (!quiet) grid.innerHTML = '<div class="license-empty-state">Checking your ER:LC playtime and resident record…</div>';
  try {
    renderLicenseCards(await requestJson("/api/licenses"));
  } catch (error) {
    setText("#license-playtime-total", "Playtime unavailable");
    setText("#license-live-state", "CHECK CONNECTION");
    grid.innerHTML = `<div class="license-empty-state"><strong>Licenses could not load.</strong><span>${escapeHtml(error.message)}</span><button class="button button-outline" type="button" data-license-refresh>Try again</button></div>`;
  }
}

function departmentTabButton(id, title, icon) {
  return `<button type="button" class="department-tab ${activeDepartmentTab === id ? "active" : ""}" data-department-tab="${id}"><span>${icon}</span>${title}</button>`;
}

function renderDepartmentPage() {
  const root = $("#department-content");
  if (!root || !activeDepartment) return;
  const { department, membership, permissions, leaveRequests } = activeDepartment;
  const manageable = Boolean(permissions.canManage);
  const roleLabel = membership?.roleName || "Not on roster";
  const pendingLeaves = leaveRequests.filter((leave) => leave.status === "pending");
  const activeMembers = department.members.filter((member) => member.activeShift);
  updateLeoAccess();
  const tabs = [
    departmentTabButton("overview", "Overview", "◫"),
    departmentTabButton("shift", "Shift management", "◷"),
    departmentTabButton("leaderboard", "Leaderboard", "↗"),
    departmentTabButton("roles", "Roles", "♙"),
    departmentTabButton("roster", "Roster", "▤")
  ];
  if (membership) tabs.push(departmentTabButton("leave", "Request leave", "▦"));
  if (manageable) tabs.push(departmentTabButton("manage", "Manage", "⚙"));

  const heading = `<div class="department-hero dynamic-department-hero ${escapeHtml(department.color || "blue")}">
      ${departmentBadgeMarkup(department, "dept-dot")}
      <div><span class="section-kicker">CITY DEPARTMENT · FIVE BOROUGHS</span><h1>${escapeHtml(department.name)}<span class="heading-period">.</span></h1><p>${escapeHtml(department.description || "A New York City roleplay department.")}</p></div>
      <span class="department-status">${escapeHtml(roleLabel)}</span>
    </div>
    <nav class="department-tabs" aria-label="Department pages">${tabs.join("")}</nav>`;

  let content = "";
  if (activeDepartmentTab === "overview") {
    content = `<div class="department-stats">
        <article class="metric-card"><span class="metric-label">ROSTER</span><strong>${department.members.length}</strong><small>Department members</small></article>
        <article class="metric-card"><span class="metric-label">ON SHIFT</span><strong>${activeMembers.length}</strong><small>Working right now</small></article>
        <article class="metric-card"><span class="metric-label">YOUR WEEK</span><strong>${membership ? minutesLabel(memberWeeklyMinutes(membership)) : "—"}</strong><small>Resets Sunday at 12 AM</small></article>
      </div>
      ${membership ? `<section class="shift-callout content-panel"><div><span class="section-kicker">YOUR DEPARTMENT SHIFT</span><h2>${membership.activeShift ? "You are currently working." : "Ready to clock in?"}</h2><p>${membership.activeShift ? `Started ${new Date(membership.activeShift.startedAt).toLocaleString()}. Current week: ${minutesLabel(memberWeeklyMinutes(membership))}.` : `Your completed time this week is ${minutesLabel(membership.weeklyMinutes)}.`}</p></div><button class="button ${membership.activeShift ? "button-outline" : "button-primary"}" data-department-action="${membership.activeShift ? "end-shift" : "start-shift"}">${membership.activeShift ? "End shift" : "Start shift"} <span>→</span></button></section>` : `<section class="content-panel department-not-member"><span class="section-kicker">ROSTER ACCESS</span><h2>You are not on this department roster.</h2><p>Ask a department manager or the Senior High Ranking account to add your Discord account.</p></section>`}
      <section class="content-panel department-active-panel"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">◷</span><div><h2>Working now</h2><p>Active department shifts</p></div><span class="count-pill">${activeMembers.length}</span></div></div>${activeMembers.length ? `<div class="department-roster-list">${activeMembers.map((member) => `<div class="department-roster-row"><div class="dept-avatar">${escapeHtml(member.username.slice(0, 1).toUpperCase())}</div><div class="dept-person"><strong>${escapeHtml(member.username)}</strong><small>${escapeHtml(member.roleName)} · started ${new Date(member.activeShift.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div><b data-live-start="${escapeHtml(member.activeShift.startedAt)}">${minutesLabel(memberWeeklyMinutes(member))}</b></div>`).join("")}</div>` : `<div class="department-empty">No one is working a shift right now.</div>`}</section>`;
  } else if (activeDepartmentTab === "shift") {
    content = `<div class="page-heading"><div><div class="eyebrow"><span>SHIFT TRACKING</span><i></i><span>WEEKLY HOURS</span></div><h1>Shift management<span class="heading-period">.</span></h1><p class="heading-subtitle">Clock in when you start serving your department, then clock out when you finish.</p></div></div>
      ${membership ? `<section class="shift-callout content-panel"><div><span class="section-kicker">${membership.activeShift ? "SHIFT IN PROGRESS" : "YOUR SHIFT"}</span><h2>${membership.activeShift ? "Currently working" : "Not currently on shift"}</h2><p>${membership.activeShift ? `This session began ${new Date(membership.activeShift.startedAt).toLocaleString()}.` : "Start a shift when you are ready to work."} Weekly total: ${minutesLabel(memberWeeklyMinutes(membership))}.</p></div><button class="button ${membership.activeShift ? "button-outline" : "button-primary"}" data-department-action="${membership.activeShift ? "end-shift" : "start-shift"}">${membership.activeShift ? "End shift" : "Start shift"} <span>→</span></button></section>` : `<section class="content-panel department-not-member"><p>Only rostered department members can start a shift.</p></section>`}
      <section class="content-panel department-active-panel"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">◷</span><div><h2>Active shifts</h2><p>${activeMembers.length} currently working</p></div></div></div>${renderActiveShiftRows(activeMembers, department, manageable)}</section>`;
  } else if (activeDepartmentTab === "leaderboard") {
    const leaderboard = [...department.members].sort((left, right) => memberWeeklyMinutes(right) - memberWeeklyMinutes(left));
    content = `<div class="page-heading"><div><div class="eyebrow"><span>WEEKLY SERVICE</span><i></i><span>DEPARTMENT STANDINGS</span></div><h1>Shift leaderboard<span class="heading-period">.</span></h1><p class="heading-subtitle">The department's weekly shift time. Rankings reset each Sunday at midnight, New York time.</p></div></div>
      <section class="content-panel department-table-panel"><div class="department-table-head"><span>RANK</span><span>MEMBER</span><span>ROLE</span><span>STATUS</span><span>THIS WEEK</span></div>${leaderboard.length ? leaderboard.map((member, index) => `<div class="department-table-row"><b class="rank-number">${String(index + 1).padStart(2, "0")}</b><span class="dept-person"><strong>${escapeHtml(member.username)}</strong><small>${member.isHead ? "Department Head" : "Roster member"}</small></span><span class="role-pill">${escapeHtml(member.roleName)}</span><span class="shift-state ${member.activeShift ? "working" : "off-duty"}">${member.activeShift ? "Working" : "Off duty"}</span><b data-live-start="${member.activeShift ? escapeHtml(member.activeShift.startedAt) : ""}">${minutesLabel(memberWeeklyMinutes(member))}</b></div>`).join("") : `<div class="department-empty">The leaderboard is ready when people join this department.</div>`}</section>`;
  } else if (activeDepartmentTab === "roles") {
    content = `<div class="page-heading"><div><div class="eyebrow"><span>DEPARTMENT STRUCTURE</span><i></i><span>RANKS & PERMISSIONS</span></div><h1>Department roles<span class="heading-period">.</span></h1><p class="heading-subtitle">Role permissions are scoped to ${escapeHtml(department.name)}.</p></div></div><div class="role-directory-grid">${department.roles.map((role) => `<article class="directory-card department-role-card"><span class="directory-icon">${role.isHead ? "✦" : "♙"}</span><span class="section-kicker">RANK ${Number(role.level) || 0}</span><h2>${escapeHtml(role.name)}</h2><p>${role.isHead ? "Department head. Receives and reviews leave requests." : role.canManage ? "Can manage the roster, roles, shifts, and leave requests." : "Department member access."}</p><span class="directory-tag">${department.members.filter((member) => member.roleId === role.id).length} PEOPLE</span></article>`).join("")}</div>`;
  } else if (activeDepartmentTab === "roster") {
    content = `<div class="page-heading"><div><div class="eyebrow"><span>DEPARTMENT ROSTER</span><i></i><span>${department.members.length} PEOPLE</span></div><h1>${escapeHtml(department.name)} roster<span class="heading-period">.</span></h1><p class="heading-subtitle">People currently assigned to this department and their role.</p></div></div><section class="content-panel department-table-panel"><div class="department-table-head roster-head"><span>MEMBER</span><span>ROLE</span><span>SHIFT</span><span>THIS WEEK</span>${manageable ? "<span>MANAGE</span>" : ""}</div>${department.members.length ? department.members.map((member) => `<div class="department-table-row roster-row"><span class="dept-person"><strong>${escapeHtml(member.username)}</strong><small>${member.isHead ? "Department Head" : "Department member"}</small></span>${manageable ? `<select class="role-select" data-member-role="${escapeHtml(member.discordId)}" ${member.isHead && !permissions.isSeniorHighRanking ? "disabled" : ""}>${department.roles.map((role) => `<option value="${escapeHtml(role.id)}" ${role.id === member.roleId ? "selected" : ""}>${escapeHtml(role.name)}</option>`).join("")}</select>` : `<span class="role-pill">${escapeHtml(member.roleName)}</span>`}<span class="shift-state ${member.activeShift ? "working" : "off-duty"}">${member.activeShift ? "Working" : "Off duty"}</span><b data-live-start="${member.activeShift ? escapeHtml(member.activeShift.startedAt) : ""}">${minutesLabel(memberWeeklyMinutes(member))}</b>${manageable ? `<span class="roster-actions">${member.activeShift ? `<button type="button" class="icon-button" data-department-action="force-end-shift" data-member-id="${escapeHtml(member.discordId)}" title="End this shift">⏹</button>` : ""}<button type="button" class="icon-button danger-icon" data-department-action="remove-member" data-member-id="${escapeHtml(member.discordId)}" title="Remove from department">×</button></span>` : ""}</div>`).join("") : `<div class="department-empty">No one has been added to this roster yet.</div>`}</section>`;
  } else if (activeDepartmentTab === "leave" && membership) {
    const ownRequests = leaveRequests.filter((leave) => leave.discordId === currentUser.id);
    content = `<div class="page-heading"><div><div class="eyebrow"><span>TIME AWAY</span><i></i><span>DEPARTMENT HEAD REVIEW</span></div><h1>Request leave<span class="heading-period">.</span></h1><p class="heading-subtitle">Your request is sent to this department's head for review.</p></div></div>
      ${department.settings?.allowLeaveRequests ? `<form class="content-panel department-form leave-request-form" data-department-form="leave"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">▦</span><div><h2>New leave request</h2><p>Tell the department head which dates you need.</p></div></div></div><div class="department-form-grid"><label>First day<input name="startDate" type="date" required></label><label>Last day<input name="endDate" type="date" required></label><label class="field-wide">Reason<textarea name="reason" rows="3" minlength="8" maxlength="500" required placeholder="Share a short explanation for your department head."></textarea></label></div><div class="department-form-actions"><span class="small-muted">Assigned to ${escapeHtml(department.roles.find((role) => role.isHead)?.name || "Department Head")}</span><button class="button button-primary" type="submit">Submit request <span>→</span></button></div></form>` : `<section class="content-panel department-not-member"><p>Leave requests are currently disabled by department management.</p></section>`}
      <section class="content-panel department-table-panel"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">◷</span><div><h2>Your requests</h2><p>Submitted leave and review status</p></div></div></div>${ownRequests.length ? ownRequests.map((leave) => `<div class="leave-row"><div><strong>${escapeHtml(leave.startDate)} → ${escapeHtml(leave.endDate)}</strong><small>${escapeHtml(leave.reason)}</small></div><span class="leave-status ${escapeHtml(leave.status)}">${escapeHtml(leave.status)}</span></div>`).join("") : `<div class="department-empty">You haven't requested leave yet.</div>`}</section>`;
  } else if (activeDepartmentTab === "manage" && manageable) {
    const pendingList = leaveRequests.filter((leave) => leave.status === "pending");
    content = `<div class="page-heading"><div><div class="eyebrow"><span>LEADERSHIP TOOLS</span><i></i><span>DEPARTMENT CONTROL</span></div><h1>Manage ${escapeHtml(department.name)}<span class="heading-period">.</span></h1><p class="heading-subtitle">Settings, roles, roster, shifts, and leave requests.</p></div></div>
      <form class="content-panel department-form" data-department-form="settings"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">⚙</span><div><h2>Department settings</h2><p>Update the name, description, and services.</p></div></div></div><div class="department-form-grid"><label>Department name<input name="name" required maxlength="40" value="${escapeHtml(department.name)}"></label><label>Icon<input name="icon" maxlength="3" value="${escapeHtml(department.icon || "✦")}"></label><label class="field-wide">Logo image URL<input name="logoUrl" type="url" maxlength="2000" value="${escapeHtml(department.logoUrl || "")}" placeholder="https://example.com/department-logo.png"></label><label class="field-wide">Upload logo<input name="logoUpload" type="file" accept="image/*"></label><label class="field-wide">Description<textarea name="description" rows="2" maxlength="240">${escapeHtml(department.description || "")}</textarea></label><label>Accent color<select name="color">${["blue", "navy", "red", "mint", "gold", "violet"].map((color) => `<option value="${color}" ${department.color === color ? "selected" : ""}>${color}</option>`).join("")}</select></label><label class="check-field"><input name="allowLeaveRequests" type="checkbox" ${department.settings?.allowLeaveRequests ? "checked" : ""}> Accept leave requests</label><label class="check-field"><input name="shiftsEnabled" type="checkbox" ${department.settings?.shiftsEnabled !== false ? "checked" : ""}> Enable shifts</label></div><div class="department-form-actions"><span></span><button class="button button-primary" type="submit">Save settings <span>→</span></button></div></form>
      <div class="manage-grid"><section class="content-panel department-form"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">♙</span><div><h2>Add a person</h2><p>They must be verified in the Discord server.</p></div></div></div><form class="department-form-inner" data-department-form="member"><label>Discord user ID<input name="discordId" inputmode="numeric" pattern="[0-9]{17,20}" required placeholder="17–20 digit ID"></label><label>Display name<input name="username" maxlength="32" required placeholder="Discord username"></label><label>Department role<select name="roleId" required>${department.roles.map((role) => `<option value="${escapeHtml(role.id)}" ${!role.isHead && role.name === "Member" ? "selected" : ""} ${role.isHead && !permissions.isSeniorHighRanking ? "disabled" : ""}>${escapeHtml(role.name)}</option>`).join("")}</select></label><button class="button button-primary" type="submit">Add to roster <span>→</span></button></form></section>
        <section class="content-panel department-form"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">＋</span><div><h2>Create a role</h2><p>Set a rank and decide if it can manage this department.</p></div></div></div><form class="department-form-inner" data-department-form="role"><label>Role name<input name="name" maxlength="32" required placeholder="e.g. Lieutenant"></label><label>Rank<input name="level" type="number" min="1" max="99" required value="25"></label><label class="check-field"><input name="canManage" type="checkbox"> Can manage roster, shifts, and leave</label><button class="button button-primary" type="submit">Create role <span>→</span></button></form></section></div>
      <section class="content-panel department-table-panel"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">♙</span><div><h2>Manage roles</h2><p>Department Head stays reserved for the Senior High Ranking account.</p></div></div></div>${department.roles.map((role) => `<form class="role-admin-row" data-department-form="role-edit" data-role-id="${escapeHtml(role.id)}"><div class="role-admin-fields"><input name="name" maxlength="32" value="${escapeHtml(role.name)}" ${role.isHead ? "readonly" : "required"}><input name="level" type="number" min="1" max="99" value="${Number(role.level) || 1}" ${role.isHead ? "readonly" : "required"}><label class="check-field"><input name="canManage" type="checkbox" ${role.canManage ? "checked" : ""} ${role.isHead ? "disabled" : ""}> Manager</label></div><div class="role-admin-actions"><button class="button button-small" type="submit">Save role</button>${role.isHead ? `<span class="small-muted">Head role</span>` : `<button type="button" class="button button-small button-quiet" data-department-action="delete-role" data-role-id="${escapeHtml(role.id)}">Delete</button>`}</div></form>`).join("")}</section>
      <section class="content-panel department-table-panel"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">▦</span><div><h2>Leave requests</h2><p>Pending requests are assigned to the department head.</p></div></div><span class="count-pill">${pendingList.length}</span></div>${pendingList.length ? pendingList.map((leave) => `<div class="leave-row manager-leave-row"><div><strong>${escapeHtml(leave.username)} · ${escapeHtml(leave.startDate)} → ${escapeHtml(leave.endDate)}</strong><small>${escapeHtml(leave.reason)}</small></div><div class="leave-review-actions"><button class="button button-small button-primary" data-department-action="review-leave" data-leave-id="${escapeHtml(leave.id)}" data-decision="approved">Approve</button><button class="button button-small button-quiet" data-department-action="review-leave" data-leave-id="${escapeHtml(leave.id)}" data-decision="denied">Deny</button></div></div>`).join("") : `<div class="department-empty">No pending requests.</div>`}</section>`;
  } else {
    activeDepartmentTab = "overview";
    renderDepartmentPage();
    return;
  }
  root.innerHTML = heading + `<div class="department-tab-content">${content}</div>`;
}

function renderActiveShiftRows(members, department, manageable) {
  if (!members.length) return `<div class="department-empty">No active shifts right now.</div>`;
  return `<div class="department-roster-list">${members.map((member) => `<div class="department-roster-row"><div class="dept-avatar">${escapeHtml(member.username.slice(0, 1).toUpperCase())}</div><div class="dept-person"><strong>${escapeHtml(member.username)}</strong><small>${escapeHtml(member.roleName)} · started ${new Date(member.activeShift.startedAt).toLocaleString()}</small></div><b data-live-start="${escapeHtml(member.activeShift.startedAt)}">${minutesLabel(memberWeeklyMinutes(member))}</b>${manageable ? `<button class="button button-small" data-department-action="force-end-shift" data-member-id="${escapeHtml(member.discordId)}">End shift</button>` : ""}</div>`).join("")}</div>`;
}

async function loadDepartmentPage(departmentId) {
  try {
    const data = await requestJson("/api/departments/" + encodeURIComponent(departmentId));
    if (currentPageFromHash() !== departmentRoute(departmentId)) return;
    activeDepartment = data;
    renderDepartmentPage();
  } catch (error) {
    if (currentPageFromHash() === departmentRoute(departmentId)) {
      $("#department-content").innerHTML = `<section class="content-panel department-not-member"><h2>Department unavailable</h2><p>${escapeHtml(error.message)}</p></section>`;
    }
  }
}

async function loadAdminData() {
  if (!currentUser?.seniorHighRanking) return;
  try {
    adminData = await requestJson("/api/admin");
    renderAdminPage();
  } catch (error) {
    $("#admin-content").innerHTML = `<section class="content-panel department-not-member"><h2>Admin access unavailable</h2><p>${escapeHtml(error.message)}</p></section>`;
  }
}

function renderAdminPage() {
  const root = $("#admin-content");
  if (!root || !adminData) return;
  document.querySelectorAll("[data-admin-tab]").forEach((button) => button.classList.toggle("active", button.dataset.adminTab === activeAdminTab));
  const departments = adminData.departments || [];
  const members = adminData.members || [];
  const body = activeAdminTab === "overview"
    ? `<div class="admin-page-heading"><div><div class="eyebrow"><span>NEW YORK CITY ROLEPLAY</span><i></i><span>ADMIN CONTROL</span></div><h1>City administration<span class="heading-period">.</span></h1><p class="heading-subtitle">Manage the city's departments, rosters, shifts, and leadership.</p></div></div><div class="department-stats admin-metrics"><article class="metric-card"><span class="metric-label">DEPARTMENTS</span><strong>${departments.length}</strong><small>Active city departments</small></article><article class="metric-card"><span class="metric-label">ROSTERED PEOPLE</span><strong>${members.length}</strong><small>Across all departments</small></article><article class="metric-card"><span class="metric-label">WORKING NOW</span><strong>${adminData.activeShiftCount}</strong><small>Current active shifts</small></article><article class="metric-card"><span class="metric-label">LEAVE REQUESTS</span><strong>${adminData.pendingLeaveCount}</strong><small>Awaiting department review</small></article></div><section class="content-panel admin-overview-panel"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">▥</span><div><h2>Departments</h2><p>Open a department to manage its operations.</p></div></div><button class="button button-add" data-admin-tab="departments"><span>＋</span> Create department</button></div>${renderAdminDepartmentCards(departments)}</section>`
    : activeAdminTab === "departments"
      ? `<div class="admin-page-heading"><div><div class="eyebrow"><span>ORGANIZATION</span><i></i><span>DEPARTMENT BUILDER</span></div><h1>Departments<span class="heading-period">.</span></h1><p class="heading-subtitle">Create, rename, and remove city departments.</p></div></div><form class="content-panel department-form" data-department-form="create-department"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">＋</span><div><h2>Create a department</h2><p>New departments start with a head, deputy, supervisor, and member role.</p></div></div></div><div class="department-form-grid"><label>Department name<input name="name" required maxlength="40" placeholder="e.g. NYPD"></label><label>Department icon<input name="icon" maxlength="3" placeholder="✦"></label><label class="field-wide">Logo image URL<input name="logoUrl" type="url" maxlength="2000" placeholder="https://example.com/department-logo.png"></label><label class="field-wide">Upload logo<input name="logoUpload" type="file" accept="image/*"></label><label class="field-wide">Description<textarea name="description" rows="2" maxlength="240" placeholder="What this department does in the city."></textarea></label><label>Accent color<select name="color"><option value="blue">Blue</option><option value="navy">Navy</option><option value="red">Red</option><option value="mint">Mint</option><option value="gold">Gold</option><option value="violet">Violet</option></select></label><label class="check-field"><input name="allowLeaveRequests" type="checkbox" checked> Accept leave requests</label></div><div class="department-form-actions"><span></span><button class="button button-primary" type="submit">Create department <span>→</span></button></div></form><section class="content-panel admin-overview-panel"><div class="panel-heading"><div class="panel-title"><span class="panel-icon">▤</span><div><h2>City departments</h2><p>${departments.length} department${departments.length === 1 ? "" : "s"} configured</p></div></div></div>${renderAdminDepartmentCards(departments, true)}</section>`
      : activeAdminTab === "people"
        ? `<div class="admin-page-heading"><div><div class="eyebrow"><span>CITY ROSTERS</span><i></i><span>MEMBERSHIP</span></div><h1>People<span class="heading-period">.</span></h1><p class="heading-subtitle">A combined view of everyone assigned to a city department.</p></div></div><section class="content-panel department-table-panel"><div class="department-table-head admin-people-head"><span>PERSON</span><span>DEPARTMENT</span><span>ROLE</span><span>SHIFT</span><span>THIS WEEK</span></div>${members.length ? members.map((member) => `<div class="department-table-row admin-people-row"><span class="dept-person"><strong>${escapeHtml(member.username)}</strong><small>${escapeHtml(member.discordId)}</small></span><a class="role-pill" href="#${departmentRoute(member.departmentId)}" data-route="${departmentRoute(member.departmentId)}">${escapeHtml(member.departmentName)}</a><span>${escapeHtml(member.roleName)}</span><span class="shift-state ${member.activeShift ? "working" : "off-duty"}">${member.activeShift ? "Working" : "Off duty"}</span><b>${minutesLabel(memberWeeklyMinutes(member))}</b></div>`).join("") : `<div class="department-empty">No people have been assigned to a department yet.</div>`}</section>`
        : `<div class="admin-page-heading"><div><div class="eyebrow"><span>SHIFT POLICY</span><i></i><span>NEW YORK TIME</span></div><h1>Settings<span class="heading-period">.</span></h1><p class="heading-subtitle">System-wide cadence and senior access.</p></div></div><section class="content-panel admin-settings-card"><span class="directory-icon">◷</span><span class="section-kicker">WEEKLY SHIFT CYCLE</span><h2>Sunday at 12:00 AM</h2><p>All active department shifts are ended and weekly minutes and shift records are cleared at midnight in America/New_York. The reset runs automatically while the CAD server is online and is also applied on the first request after a restart.</p><span class="directory-tag">CURRENT WEEK STARTED ${escapeHtml(adminData.weekKey)}</span></section><section class="content-panel admin-settings-card"><span class="section-kicker">SENIOR ACCESS ACCOUNT</span><h2>@${escapeHtml(adminData.seniorAccount)}</h2><p>This Discord username is granted the Senior High Ranking role and the protected Admin tab.</p></section>`;
  root.innerHTML = body;
}

function renderAdminDepartmentCards(items, showDelete = false) {
  if (!items.length) return `<div class="department-empty">No departments yet. Create one above.</div>`;
  return `<div class="admin-department-list">${items.map((department) => `<article class="admin-department-row">${departmentBadgeMarkup(department, "dept-dot")}<div class="dept-person"><strong>${escapeHtml(department.name)}</strong><small>${escapeHtml(department.description || "")} · ${department.members.length} people · ${(department.members || []).filter((member) => member.activeShift).length} working</small></div><a class="button button-small" href="#${departmentRoute(department.id)}" data-route="${departmentRoute(department.id)}">Open department <span>→</span></a>${showDelete ? `<button type="button" class="button button-small button-quiet danger-text" data-admin-action="delete-department" data-department-id="${escapeHtml(department.id)}">Remove</button>` : ""}</article>`).join("")}</div>`;
}

async function refreshDepartmentPage(message = "Department updated.") {
  const id = activeDepartment?.department?.id;
  if (!id) return;
  await loadDepartmentPage(id);
  if (message) showToast(message);
}

async function handleDepartmentForm(form) {
  const formData = new FormData(form);
  const kind = form.dataset.departmentForm;
  const checked = (name) => form.elements.namedItem(name)?.checked === true;
  const payload = { ...Object.fromEntries(formData.entries()) };
  const logoUpload = formData.get("logoUpload");
  if (logoUpload && typeof logoUpload !== "string" && logoUpload.size > 0) {
    if (logoUpload.size > 2 * 1024 * 1024) throw new Error("The department logo must be 2 MB or smaller.");
    const imageUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("The uploaded logo file could not be read."));
      reader.readAsDataURL(logoUpload);
    });
    payload.logoUrl = imageUrl;
  }
  if (typeof payload.logoUrl === "string") payload.logoUrl = payload.logoUrl.trim();
  delete payload.logoUpload;
  if (kind === "create-department") {
    const result = await requestJson("/api/admin/departments", { method: "POST", body: JSON.stringify({ ...payload, allowLeaveRequests: checked("allowLeaveRequests") }) });
    activeAdminTab = "departments";
    await loadDepartments();
    await loadAdminData();
    showToast(`${result.department.name} department created.`);
    return;
  }
  if (!activeDepartment?.department) return;
  const base = "/api/departments/" + encodeURIComponent(activeDepartment.department.id);
  if (kind === "settings") {
    await requestJson(base, { method: "PUT", body: JSON.stringify({ ...payload, allowLeaveRequests: checked("allowLeaveRequests"), shiftsEnabled: checked("shiftsEnabled") }) });
    await refreshDepartmentPage("Department settings saved.");
  } else if (kind === "member") {
    await requestJson(base + "/members", { method: "POST", body: JSON.stringify(values) });
    await refreshDepartmentPage("Person added to the department roster.");
  } else if (kind === "role") {
    await requestJson(base + "/roles", { method: "POST", body: JSON.stringify({ ...values, level: Number(values.level), canManage: checked("canManage") }) });
    await refreshDepartmentPage("Department role created.");
  } else if (kind === "role-edit") {
    await requestJson(base + "/roles/" + encodeURIComponent(form.dataset.roleId), { method: "PUT", body: JSON.stringify({ ...values, level: Number(values.level), canManage: checked("canManage") }) });
    await refreshDepartmentPage("Department role saved.");
  } else if (kind === "leave") {
    await requestJson(base + "/leave", { method: "POST", body: JSON.stringify(values) });
    activeDepartmentTab = "leave";
    await refreshDepartmentPage("Leave request sent to the department head.");
  }
}

async function handleDepartmentAction(button) {
  const base = "/api/departments/" + encodeURIComponent(activeDepartment.department.id);
  const action = button.dataset.departmentAction;
  if (action === "start-shift" || action === "end-shift") {
    await requestJson(base + "/shift", { method: "POST", body: JSON.stringify({ action: action === "start-shift" ? "start" : "end" }) });
    await refreshDepartmentPage(action === "start-shift" ? "Shift started." : "Shift ended and weekly time saved.");
  } else if (action === "force-end-shift") {
    await requestJson(base + "/members/" + encodeURIComponent(button.dataset.memberId) + "/shift-end", { method: "POST", body: JSON.stringify({}) });
    await refreshDepartmentPage("Department shift ended.");
  } else if (action === "remove-member") {
    if (!confirm("Remove this person from the department roster?")) return;
    await requestJson(base + "/members/" + encodeURIComponent(button.dataset.memberId), { method: "DELETE" });
    await refreshDepartmentPage("Person removed from the department.");
  } else if (action === "review-leave") {
    await requestJson(base + "/leave/" + encodeURIComponent(button.dataset.leaveId), { method: "POST", body: JSON.stringify({ decision: button.dataset.decision }) });
    await refreshDepartmentPage(button.dataset.decision === "approved" ? "Leave request approved." : "Leave request denied.");
  } else if (action === "delete-role") {
    if (!confirm("Delete this role? It must have no assigned members.")) return;
    await requestJson(base + "/roles/" + encodeURIComponent(button.dataset.roleId), { method: "DELETE" });
    await refreshDepartmentPage("Department role deleted.");
  }
}

function updateLiveShiftCounters() {
  document.querySelectorAll("[data-live-start]").forEach((node) => {
    const member = activeDepartment?.department?.members.find((item) => item.activeShift?.startedAt === node.dataset.liveStart);
    if (member) node.textContent = minutesLabel(memberWeeklyMinutes(member));
  });
}

async function saveProfile() {
  if (currentUser) {
    const result = await requestJson("/api/profile", { method: "PUT", body: JSON.stringify({ profile }) });
    if (result.profile) profile = { ...profile, ...result.profile };
    if (result.portfolio) portfolio = result.portfolio;
  } else {
    localStorage.setItem(profileKey, JSON.stringify(profile));
  }
}

async function saveGuestPortfolio() {
  localStorage.setItem(marketKey, JSON.stringify(portfolio));
}

function updateProfileUI() {
  setText("#id-name", profile.name);
  setText("#id-dob", profile.dob);
  setText("#id-pronouns", profile.pronouns);
  setText("#id-borough", profile.borough);
  setText("#id-eyes", profile.eyes);
  setText("#id-height", profile.height);
  setText("#id-job", profile.occupation);
  setText("#id-number", profile.idNo);
  setText("#back-id", profile.idNo);
  setText("#id-signature", profile.name);
  setText("#borough-title", profile.borough);
  setText("#neighborhood-caption", profile.neighborhood);
  setText("#sidebar-name", currentUser?.displayName || currentUser?.username || profile.name);
  setText("#sidebar-role", currentUser?.seniorHighRanking ? "Senior High Ranking" : currentUser ? "Connected · Civilian" : "Civilian · New York");
  updateResidentAvatar();

  const boroughDescriptions = {
    Manhattan: "The city that never slows down.",
    Brooklyn: "Big hearts, block by block.",
    Queens: "The whole world on one avenue.",
    "The Bronx": "The birthplace of something bigger.",
    "Staten Island": "A little room to breathe."
  };
  setText("#borough-caption", boroughDescriptions[profile.borough] || "A neighborhood of your own.");
  const initials = (profile.name || "NY").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  $("#sidebar-avatar").replaceChildren();
  $("#top-avatar").replaceChildren();
  if (currentUser?.avatar && currentUser.id && !currentUser.demo) {
    const avatarUrl = "https://cdn.discordapp.com/avatars/" + encodeURIComponent(currentUser.id) + "/" + encodeURIComponent(currentUser.avatar) + ".png?size=96";
    const sidebarImage = document.createElement("img");
    sidebarImage.src = avatarUrl;
    sidebarImage.alt = "";
    const topImage = document.createElement("img");
    topImage.src = avatarUrl;
    topImage.alt = "";
    $("#sidebar-avatar").append(sidebarImage);
    $("#top-avatar").append(topImage);
  } else {
    $("#sidebar-avatar").textContent = initials || "NY";
    $("#top-avatar").textContent = initials || "NY";
  }

  const connectLabel = currentUser ? "Sign out" : "Connect Discord";
  setText("#signin-label", connectLabel);
  setText("#connection-name", currentUser ? currentUser.username : "Not connected");
  setText("#connection-caption", currentUser ? "Your profile is saved to your Discord account." : "Sign in with Discord to save your profile anywhere.");
  setText("#connect-inline", currentUser ? "Connected ✓" : "Connect ↗");
  renderVehicles();
  renderPortfolio();
}

function updateResidentAvatar() {
  const frame = $("#resident-portrait-frame");
  const image = $("#resident-avatar");
  const code = $("#portrait-code");
  if (!frame || !image) return;

  const robloxId = currentUser?.robloxId ? String(currentUser.robloxId) : "";
  if (!/^\d{1,24}$/.test(robloxId)) {
    frame.classList.remove("has-avatar");
    image.removeAttribute("src");
    image.dataset.robloxId = "";
    residentAvatarImage = null;
    residentAvatarPromise = null;
    residentAvatarUserId = null;
    if (code) code.textContent = "NYC · 001";
    return;
  }

  if (residentAvatarUserId === robloxId && residentAvatarPromise) return;
  residentAvatarUserId = robloxId;
  residentAvatarImage = null;
  image.dataset.robloxId = robloxId;
  if (code) code.textContent = "ROBLOX AVATAR · " + (currentUser.robloxUsername || "RESIDENT").toUpperCase();
  residentAvatarPromise = new Promise((resolve) => {
    image.onload = () => {
      residentAvatarImage = image;
      frame.classList.add("has-avatar");
      resolve(image);
    };
    image.onerror = () => {
      frame.classList.remove("has-avatar");
      resolve(null);
    };
    image.src = "/api/roblox-avatar";
  });
}

function createVehicleRow(vehicle) {
    const row = document.createElement("div");
    row.className = "vehicle-row";
    if (vehicle.source === "erlc") row.classList.add("live-vehicle");

    const icon = document.createElement("span");
    icon.className = "vehicle-symbol";
    icon.textContent = "▰";
    const plate = document.createElement("strong");
    plate.className = "vehicle-plate";
    plate.textContent = vehicle.plate;
    const model = document.createElement("span");
    model.className = "vehicle-model";
    const color = vehicle.colorHex ? `${vehicle.color || "Color"} ${vehicle.colorHex}` : vehicle.color;
    const texture = vehicle.texture && !/^none$/i.test(vehicle.texture) ? "Livery: " + vehicle.texture : "";
    model.textContent = [vehicle.model, color, texture].filter(Boolean).join(" · ");
    const statusValue = normalizeVehicleStatus(vehicle.status || "Valid");
    const status = document.createElement("span");
    status.className = "vehicle-status " + statusValue.toLowerCase();
    status.textContent = statusValue;
    if (vehicle.source === "erlc") {
      status.classList.add("vehicle-status-control");
      status.tabIndex = 0;
      status.setAttribute("role", "button");
      status.title = "Change registry status: Valid → Stolen → Expired → Valid";
      status.dataset.vehicleStatus = String(vehicle.plate || vehicle.id);
    }
    model.title = [vehicle.model, vehicle.color, vehicle.colorHex, texture, vehicle.owner ? "Owner: " + vehicle.owner : ""].filter(Boolean).join(" · ");
    row.append(icon, plate, model, status);
    return row;
}

function renderVehicles() {
  ["#vehicle-list", "#vehicle-list-page"].forEach((selector) => {
    const list = $(selector);
    if (!list) return;
    list.replaceChildren();
    if (vehicles.length) {
      vehicles.forEach((vehicle) => list.append(createVehicleRow(vehicle)));
    } else {
      const empty = document.createElement("div");
      empty.className = "vehicle-empty";
      empty.textContent = vehicleSyncStatus === "loading"
        ? "Loading your ER:LC vehicles…"
        : vehicleSyncStatus === "error"
          ? "Live ER:LC vehicle data is unavailable right now."
          : `No vehicles are currently spawned for ${vehicleRobloxUsername || "your linked Roblox account"}.`;
      list.append(empty);
    }
  });
  setText("#vehicle-count", String(vehicles.length).padStart(2, "0"));
  setText("#garage-count", String(vehicles.length).padStart(2, "0") + (vehicles.length === 1 ? " RECORD" : " RECORDS"));
  setText("#vehicle-count-page", String(vehicles.length).padStart(2, "0"));
  setText("#garage-count-page", String(vehicles.length).padStart(2, "0") + (vehicles.length === 1 ? " RECORD" : " RECORDS"));
  const sourceLabel = vehicleSyncStatus === "loading"
    ? "CONNECTING TO ER:LC"
    : vehicleSyncStatus === "error"
      ? "ER:LC VEHICLE FEED UNAVAILABLE"
      : "LIVE ER:LC · " + (vehicleRobloxUsername || "LINKED ROBLOX ACCOUNT").toUpperCase();
  document.querySelectorAll(".garage-source").forEach((node) => { node.textContent = sourceLabel; });
}

async function refreshLiveVehicles() {
  if (!currentUser) return;
  const cachedVehicles = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(vehicleKey) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  })();
  const savedStatuses = readVehicleStatusMap();

  try {
    const data = await requestJson("/api/erlc/vehicles");
    const liveVehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    const merged = [];
    const seen = new Set();

    liveVehicles.forEach((vehicle) => {
      const key = String(vehicle.plate || vehicle.id);
      if (!key) return;
      seen.add(key);
      merged.push({ ...vehicle, status: normalizeVehicleStatus(savedStatuses[key] || vehicle.status || "Valid") });
    });

    cachedVehicles.forEach((vehicle) => {
      const key = String(vehicle.plate || vehicle.id);
      if (!key || seen.has(key)) return;
      merged.push({ ...vehicle, status: normalizeVehicleStatus(savedStatuses[key] || vehicle.status || "Valid") });
    });

    vehicles = merged.length ? merged : cachedVehicles.map((vehicle) => ({ ...vehicle, status: normalizeVehicleStatus(savedStatuses[String(vehicle.plate || vehicle.id)] || vehicle.status || "Valid") }));
    vehicleRobloxUsername = data.robloxUsername || currentUser.robloxUsername || "";
    vehicleSyncStatus = "ready";
    persistVehicleList(vehicles);
  } catch {
    vehicles = cachedVehicles.map((vehicle) => ({ ...vehicle, status: normalizeVehicleStatus(savedStatuses[String(vehicle.plate || vehicle.id)] || vehicle.status || "Valid") }));
    vehicleSyncStatus = vehicles.length ? "ready" : "error";
    if (vehicles.length) persistVehicleList(vehicles);
  }
  renderVehicles();
}

function findQuote(symbol) {
  return marketData?.quotes?.find((quote) => quote.symbol === symbol) || null;
}

function renderMarket() {
  renderMarketQuotes();
  renderPortfolio();
}

function renderMarketQuotes() {
  if (!marketData) return;
  const list = $("#market-list");
  list.replaceChildren();
  marketData.quotes.forEach((quote) => {
    const row = document.createElement("div");
    row.className = "market-stock-row";
    const identity = document.createElement("div");
    identity.className = "stock-identity";
    const badge = document.createElement("span");
    badge.className = "stock-badge stock-" + quote.symbol;
    badge.textContent = quote.symbol;
    const text = document.createElement("div");
    text.className = "stock-copy";
    const company = document.createElement("strong");
    company.textContent = quote.company;
    const listing = document.createElement("small");
    listing.textContent = quote.exchange + " · " + quote.borough;
    text.append(company, listing);
    identity.append(badge, text);

    const usd = document.createElement("div");
    usd.className = "stock-usd";
    const usdPrice = document.createElement("strong");
    usdPrice.textContent = formatUsd(quote.priceUsd);
    const usdLabel = document.createElement("small");
    usdLabel.textContent = quote.quoteDate;
    usd.append(usdPrice, usdLabel);

    const cad = document.createElement("div");
    cad.className = "stock-cad";
    const cadPrice = document.createElement("strong");
    cadPrice.textContent = formatCad(quote.priceCad);
    const cadLabel = document.createElement("small");
    cadLabel.textContent = "per share";
    cad.append(cadPrice, cadLabel);

    const change = document.createElement("span");
    change.className = "stock-change " + (quote.changePercent >= 0 ? "is-up" : "is-down");
    change.textContent = (quote.changePercent > 0 ? "+" : "") + quote.changePercent.toFixed(2) + "%";

    const trade = document.createElement("button");
    trade.className = "button stock-trade-button";
    trade.type = "button";
    trade.textContent = "Trade";
    trade.addEventListener("click", () => openTrade(quote.symbol, "buy"));
    row.append(identity, usd, cad, change, trade);
    list.append(row);
  });

  const quoteDates = [...new Set(marketData.quotes.map((quote) => quote.quoteDate))];
  const quoteLabel = quoteDates.join(", ");
  const hasCachedQuote = marketData.quotes.some((quote) => quote.stale);
  $(".quote-source").textContent = hasCachedQuote ? "NASDAQ + CACHED" : "NASDAQ DELAYED";
  setText("#quote-as-of", (hasCachedQuote ? "Nasdaq quotes with cached snapshot fallback" : "Nasdaq delayed quotes") + " · last trade " + quoteLabel + " · USD/CAD daily rate " + marketData.usdCadDate);
  setText("#metric-rate", formatCad(marketData.usdCad));
  setText("#metric-rate-date", marketData.fxFallback ? "Cached Bank of Canada rate" : "Bank of Canada · " + marketData.usdCadDate);
  setText("#market-status-label", marketData.marketStatus === "Open" ? "MARKET OPEN" : "MARKET CLOSED");
  $(".market-status").classList.toggle("is-open", marketData.marketStatus === "Open");
}

function renderActivityList(selector, emptyMessage) {
  const activity = $(selector);
  if (!activity) return;
  activity.replaceChildren();
  const transactions = Array.isArray(portfolio.transactions) ? portfolio.transactions.slice(0, 5) : [];
  if (!transactions.length) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = emptyMessage;
    activity.append(empty);
    return;
  }
  transactions.forEach((transaction) => {
    const row = document.createElement("div");
    row.className = "activity-row";
    const icon = document.createElement("span");
    icon.className = "activity-icon " + transaction.side;
    icon.textContent = transaction.side === "buy" ? "↓" : "↑";
    const copy = document.createElement("div");
    copy.className = "activity-copy";
    const headline = document.createElement("strong");
    headline.textContent = transaction.side.toUpperCase() + " " + transaction.quantity + " " + transaction.symbol;
    const date = document.createElement("small");
    date.textContent = new Date(transaction.executedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    copy.append(headline, date);
    const amount = document.createElement("b");
    amount.textContent = formatCad(transaction.totalCad);
    row.append(icon, copy, amount);
    activity.append(row);
  });
}

function renderPortfolio() {
  const balance = Number(portfolio.balance) || 0;
  const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];
  const activeHoldings = holdings.filter((holding) => holding.quantity > 0);
  const marketValue = activeHoldings.reduce((sum, holding) => {
    const quote = findQuote(holding.symbol);
    return sum + holding.quantity * (quote?.priceCad || holding.averagePriceCad || 0);
  }, 0);
  const costBasis = activeHoldings.reduce((sum, holding) => sum + holding.quantity * holding.averagePriceCad, 0);
  const unrealized = marketValue - costBasis;

  setText("#wallet-balance", formatCad(balance));
  setText("#wallet-balance-side", formatCad(balance));
  setText("#wallet-balance-page", formatCad(balance));
  setText("#metric-balance", formatCad(balance));
  setText("#metric-value", formatCad(balance + marketValue));
  setText("#metric-positions", String(activeHoldings.length));
  const gainNode = $("#metric-gain");
  gainNode.textContent = activeHoldings.length
    ? (unrealized >= 0 ? "+" : "−") + formatCad(Math.abs(unrealized)) + " unrealized"
    : "No open positions yet";
  gainNode.classList.toggle("gain-positive", unrealized >= 0 && activeHoldings.length > 0);
  gainNode.classList.toggle("gain-negative", unrealized < 0);
  setText("#holding-count", String(activeHoldings.length));

  const list = $("#holdings-list");
  list.replaceChildren();
  if (!activeHoldings.length) {
    const empty = document.createElement("div");
    empty.className = "empty-market";
    const mark = document.createElement("span");
    mark.textContent = "⌁";
    const title = document.createElement("strong");
    title.textContent = "No stocks yet";
    const help = document.createElement("small");
    help.textContent = "Choose a company and make your first pretend trade.";
    empty.append(mark, title, help);
    list.append(empty);
  } else {
    activeHoldings.forEach((holding) => {
      const quote = findQuote(holding.symbol);
      const unitPrice = quote?.priceCad || holding.averagePriceCad;
      const value = unitPrice * holding.quantity;
      const pnl = value - holding.quantity * holding.averagePriceCad;
      const row = document.createElement("div");
      row.className = "holding-row";
      const top = document.createElement("div");
      top.className = "holding-top";
      const ticker = document.createElement("strong");
      ticker.textContent = holding.symbol;
      const valueText = document.createElement("b");
      valueText.textContent = formatCad(value);
      top.append(ticker, valueText);
      const meta = document.createElement("div");
      meta.className = "holding-meta";
      const shares = document.createElement("span");
      shares.textContent = holding.quantity + (holding.quantity === 1 ? " share" : " shares");
      const delta = document.createElement("span");
      delta.className = pnl >= 0 ? "gain-positive" : "gain-negative";
      delta.textContent = (pnl >= 0 ? "+" : "−") + formatCad(Math.abs(pnl));
      meta.append(shares, delta);
      const sell = document.createElement("button");
      sell.type = "button";
      sell.className = "holding-sell";
      sell.textContent = "Sell";
      sell.addEventListener("click", () => openTrade(holding.symbol, "sell"));
      row.append(top, meta, sell);
      list.append(row);
    });
  }

  renderActivityList("#activity-list", "Your buys and sells will show up here.");
  renderActivityList("#wallet-activity-list", "Your wallet activity will appear here.");
}

async function fetchMarketData(forceRefresh = false) {
  const refresh = $("#refresh-market");
  if (refresh) refresh.disabled = true;
  if (refresh) setText("#market-status-label", "UPDATING");
  try {
    marketData = await requestJson("/api/market" + (forceRefresh ? "?refresh=1" : ""));
    renderMarket();
  } catch (error) {
    setText("#market-status-label", "QUOTES OFFLINE");
    showToast(error.message || "Could not load stock quotes.");
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

function openTrade(symbol, side = "buy") {
  const quote = findQuote(symbol);
  if (!quote) {
    showToast("Wait for the latest market quotes to load.");
    return;
  }
  const holding = portfolio.holdings.find((item) => item.symbol === symbol);
  $("#trade-symbol").value = symbol;
  $("#trade-company-name").textContent = quote.company + " (" + symbol + ")";
  $("#trade-company-subtitle").textContent = quote.district + " · " + quote.borough + " · " + quote.exchange;
  $("#trade-quantity").value = "1";
  setTradeSide(side);
  updateTradePreview();
  if (side === "sell" && !holding) $("#trade-error").textContent = "You don’t own any shares of this company yet.";
  tradeModal.showModal();
}

function setTradeSide(side) {
  activeTradeSide = side;
  document.querySelectorAll(".trade-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.side === side));
  setText("#trade-total-label", side === "buy" ? "ESTIMATED TOTAL" : "ESTIMATED PROCEEDS");
  setText("#confirm-trade", side === "buy" ? "Buy shares →" : "Sell shares →");
  updateTradePreview();
}

function updateTradePreview() {
  const symbol = $("#trade-symbol").value;
  const quote = findQuote(symbol);
  if (!quote) return;
  const quantity = Math.floor(Number($("#trade-quantity").value) || 0);
  const total = quantity * quote.priceCad;
  const holding = portfolio.holdings.find((item) => item.symbol === symbol);
  const sharesOwned = holding ? holding.quantity : 0;
  setText("#trade-price", formatCad(quote.priceCad));
  setText("#trade-balance", formatCad(portfolio.balance));
  setText("#trade-total", formatCad(total));
  let error = "";
  if (quantity < 1) error = "Enter at least one whole share.";
  else if (activeTradeSide === "buy" && total > portfolio.balance) error = "That order is larger than your available credits.";
  else if (activeTradeSide === "sell" && quantity > sharesOwned) error = "You own " + sharesOwned + " " + (sharesOwned === 1 ? "share" : "shares") + " of this stock.";
  setText("#trade-error", error);
  $("#confirm-trade").disabled = Boolean(error);
}

async function submitTrade() {
  const symbol = $("#trade-symbol").value;
  const quantity = Math.floor(Number($("#trade-quantity").value) || 0);
  const quote = findQuote(symbol);
  if (!quote || quantity < 1) return;
  const totalCad = Math.round(quote.priceCad * quantity * 100) / 100;
  try {
    if (currentUser) {
      const result = await requestJson("/api/trade", {
        method: "POST",
        body: JSON.stringify({ symbol, side: activeTradeSide, quantity })
      });
      portfolio = result.portfolio;
    } else {
      const holdings = portfolio.holdings.map((item) => ({ ...item }));
      const index = holdings.findIndex((item) => item.symbol === symbol);
      const holding = index >= 0 ? holdings[index] : { symbol, quantity: 0, averagePriceCad: 0 };
      if (activeTradeSide === "buy") {
        if (totalCad > portfolio.balance) throw new Error("That order is larger than your available credits.");
        const nextQuantity = holding.quantity + quantity;
        holding.averagePriceCad = Math.round(((holding.quantity * holding.averagePriceCad + totalCad) / nextQuantity) * 100) / 100;
        holding.quantity = nextQuantity;
        portfolio.balance = Math.round((portfolio.balance - totalCad) * 100) / 100;
        if (index >= 0) holdings[index] = holding;
        else holdings.push(holding);
      } else {
        if (quantity > holding.quantity) throw new Error("You do not have that many shares to sell.");
        holding.quantity -= quantity;
        portfolio.balance = Math.round((portfolio.balance + totalCad) * 100) / 100;
        if (holding.quantity === 0) holdings.splice(index, 1);
        else holdings[index] = holding;
      }
      const transaction = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        symbol,
        side: activeTradeSide,
        quantity,
        priceUsd: quote.priceUsd,
        priceCad: quote.priceCad,
        totalCad,
        quoteDate: quote.quoteDate,
        executedAt: new Date().toISOString()
      };
      portfolio.holdings = holdings;
      portfolio.transactions = [transaction, ...portfolio.transactions].slice(0, 30);
      await saveGuestPortfolio();
    }
    tradeModal.close();
    renderMarket();
    showToast(activeTradeSide === "buy" ? "Shares added to your paper portfolio." : "Shares sold. Credits returned to your wallet.");
  } catch (error) {
    setText("#trade-error", error.message);
    $("#confirm-trade").disabled = true;
  }
}

function openProfileEditor() {
  const form = $("#profile-form");
  Object.entries(profile).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  });
  profileModal.showModal();
}

async function openConnect() {
  if (currentUser) {
    if (confirm("Sign out of your Discord account?")) window.location.href = "/auth/logout";
    return;
  }
  connectModal.showModal();
  try {
    const config = await requestJson("/api/config");
    const button = $("#discord-login");
    button.disabled = false;
    if (!config.discordConfigured) {
      button.onclick = (event) => {
        event.preventDefault();
        showToast("Add your Discord app credentials in .env to enable sign-in.");
      };
    } else {
      button.onclick = (event) => {
        event.preventDefault();
        window.location.href = "/auth/discord";
      };
    }
  } catch {
    $("#discord-login").onclick = (event) => {
      event.preventDefault();
      showToast("The sign-in service is unavailable right now.");
    };
  }
}

async function refreshErlcStatus() {
  const label = $("#server-live-label");
  if (!label) return;
  try {
    const server = await requestJson("/api/erlc/server");
    label.textContent = `${server.name} · ${server.currentPlayers}/${server.maxPlayers}`;
    label.title = `Live ER:LC server status · updated ${new Date(server.updatedAt).toLocaleTimeString()}`;
  } catch {
    label.textContent = "ER:LC STATUS UNAVAILABLE";
    label.title = "The connected ER:LC server status could not be loaded.";
  }
}

function escapeXml(value) {
  return String(value || "").replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  })[character]);
}

async function downloadCard() {
  if (currentUser?.robloxId && !residentAvatarPromise) updateResidentAvatar();
  if (residentAvatarPromise) await residentAvatarPromise;
  const canvas = document.createElement("canvas");
  canvas.width = 1440;
  canvas.height = 830;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#dcebed");
  gradient.addColorStop(.55, "#c6dcdf");
  gradient.addColorStop(1, "#e1e9e4");
  ctx.fillStyle = gradient;
  roundedRect(ctx, 0, 0, width, height, 28);
  ctx.fill();

  ctx.save();
  roundedRect(ctx, 14, 14, width - 28, height - 28, 22);
  ctx.clip();
  ctx.strokeStyle = "rgba(44,103,117,.11)";
  ctx.lineWidth = 2;
  for (let y = 28; y < height; y += 15) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + Math.sin(y / 90) * 8);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#567d8a";
  ctx.font = "700 18px sans-serif";
  ctx.letterSpacing = "4px";
  ctx.fillText("NEW YORK CITY", 54, 55);
  ctx.textAlign = "right";
  ctx.fillText("RESIDENT IDENTIFICATION  ·  EST. 1624", width - 54, 55);
  ctx.textAlign = "left";

  const logo = new Image();
  logo.onload = () => {
    ctx.fillStyle = "#173b4c";
    roundedRect(ctx, 54, 89, 92, 92, 15);
    ctx.fill();
    ctx.drawImage(logo, 62, 96, 76, 76);
    ctx.fillStyle = "#f3f3ef";
    ctx.font = "700 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("NYC", 100, 174);
    ctx.textAlign = "left";
    ctx.fillStyle = "#537988";
    ctx.font = "700 15px sans-serif";
    ctx.fillText("THE CITY OF NEW YORK", 170, 112);
    ctx.fillStyle = "#183a46";
    ctx.font = "700 48px sans-serif";
    ctx.fillText("RESIDENT CARD", 170, 158);
    ctx.fillStyle = "#638590";
    ctx.font = "700 13px sans-serif";
    ctx.fillText("FIVE BOROUGHS  ·  ONE CITY", 172, 184);

    ctx.strokeStyle = "rgba(41,100,117,.35)";
    ctx.beginPath();
    ctx.moveTo(54, 213);
    ctx.lineTo(width - 54, 213);
    ctx.stroke();

    const portrait = ctx.createLinearGradient(55, 245, 315, 660);
    portrait.addColorStop(0, "#9bb3b6");
    portrait.addColorStop(1, "#708b91");
    ctx.fillStyle = portrait;
    roundedRect(ctx, 54, 245, 262, 397, 15);
    ctx.fill();
    if (residentAvatarImage?.complete && residentAvatarImage.naturalWidth) {
      const x = 54, y = 245, w = 262, h = 397;
      ctx.save();
      roundedRect(ctx, x, y, w, h, 15);
      ctx.clip();
      const scale = Math.max(w / residentAvatarImage.naturalWidth, h / residentAvatarImage.naturalHeight);
      const drawnWidth = residentAvatarImage.naturalWidth * scale;
      const drawnHeight = residentAvatarImage.naturalHeight * scale;
      ctx.drawImage(residentAvatarImage, x + (w - drawnWidth) / 2, y + (h - drawnHeight) / 2, drawnWidth, drawnHeight);
      ctx.restore();
    } else {
      ctx.fillStyle = "#c39a7c";
      ctx.beginPath();
      ctx.ellipse(185, 427, 66, 100, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#484035";
      ctx.beginPath();
      ctx.ellipse(185, 355, 67, 40, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#272d30";
      ctx.fillRect(150, 418, 12, 4);
      ctx.fillRect(207, 418, 12, 4);
      ctx.strokeStyle = "#744a3d";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(185, 457, 22, .2, Math.PI - .2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(20,43,49,.72)";
    ctx.fillRect(54, 608, 262, 34);
    ctx.fillStyle = "#eff2ee";
    ctx.font = "700 13px sans-serif";
    ctx.fillText("NYC · CITY RESIDENT", 71, 630);

    const left = 363;
    const field = (label, value, x, y, fontSize = 24) => {
      ctx.fillStyle = "#5d838e";
      ctx.font = "700 12px sans-serif";
      ctx.fillText(label.toUpperCase(), x, y);
      ctx.fillStyle = "#183a46";
      ctx.font = "600 " + fontSize + "px sans-serif";
      ctx.fillText(value || "—", x, y + 30);
    };
    field("01 · Full name", profile.name, left, 270, 36);
    field("02 · Date of birth", profile.dob, left, 348);
    field("03 · Pronouns", profile.pronouns, 700, 348);
    field("04 · Borough", profile.borough, left, 433);
    field("05 · Eyes / height", profile.eyes + " · " + profile.height, 700, 433);
    field("06 · Occupation", profile.occupation, left, 518, 23);

    ctx.strokeStyle = "rgba(41,100,117,.35)";
    ctx.beginPath();
    ctx.moveTo(54, 689);
    ctx.lineTo(width - 54, 689);
    ctx.stroke();
    field("Resident no.", profile.idNo, 54, 720, 20);
    ctx.textAlign = "right";
    ctx.fillStyle = "#355967";
    ctx.font = "italic 600 35px Georgia,serif";
    ctx.fillText(profile.name, width - 56, 738);
    ctx.fillStyle = "#648893";
    ctx.font = "700 10px sans-serif";
    ctx.fillText("HOLDER SIGNATURE", width - 56, 758);
    ctx.textAlign = "left";
    ctx.fillStyle = "#71919a";
    ctx.font = "700 9px sans-serif";
    ctx.fillText("ROLEPLAY ID · NOT A GOVERNMENT DOCUMENT", 54, 794);
    ctx.textAlign = "right";
    ctx.fillText("NEW YORK, NY", width - 54, 794);
    ctx.textAlign = "left";

    const link = document.createElement("a");
    link.download = "nyc-resident-card.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("Resident card downloaded as PNG.");
  };
  logo.onerror = () => showToast("Could not prepare the card image.");
  logo.src = "/assets/nyc-mark.png";
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

const leoRecordsKey = "nycrp.leo-records.v1";
const boloKey = "nycrp.bolos.v1";
function readStore(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } }
function writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function isPoliceDepartment(name="") { return /NYPD|NYSP|COAST\s*GUARD|NYPP/i.test(name); }
function updateLeoAccess() {
  const section = $("#leo-nav-section"); if (!section) return;
  const onDuty = Boolean(activeDepartment?.membership?.activeShift && isPoliceDepartment(activeDepartment.department?.name));
  section.hidden = !onDuty;
  if (!onDuty && ["leo", "bolos"].includes(document.body.dataset.page)) activatePage("profile", true);
}
function renderBolos() {
  const root = $("#bolo-list"); if (!root) return;
  const items = readStore(boloKey);
  root.innerHTML = items.length ? items.map((b,i)=>`<article class="leo-result"><div><strong>${escapeHtml(b.kind === "vehicle" ? "VEHICLE BOLO" : "PERSON BOLO")}</strong><p>${escapeHtml(b.summary)}</p><small>${escapeHtml(b.createdAt)}</small></div><span class="leave-status pending">ACTIVE</span></article>`).join("") : '<div class="department-empty">No active BOLOs.</div>';
}
function openLeoModal(html) { const d=$("#leo-modal"); $("#leo-modal-content").innerHTML=html; d.showModal(); }
function searchLeo(type, query) {
  const q=query.trim().toLowerCase(); const liveVehicles=vehicles || [];
  const vehicleMatches=liveVehicles.filter(v => type==="plate" && String(v.plate||"").toLowerCase().includes(q));
  const records=readStore(leoRecordsKey);
  const people=records.filter(r => type!=="plate" && String(type==="roblox"?r.robloxUsername:r.cadName||"").toLowerCase().includes(q));
  const root=$("#leo-results");
  const rows=[...vehicleMatches.map(v=>({kind:"vehicle",value:v})),...people.map(v=>({kind:"person",value:v}))];
  root.innerHTML=rows.length?rows.map((r,i)=>`<button class="leo-result leo-result-button" data-leo-open="${i}"><span><strong>${escapeHtml(r.kind==="vehicle"?`${r.value.plate||"NO PLATE"} · ${r.value.model||"Vehicle"}`:`${r.value.cadName||r.value.robloxUsername}`)}</strong><small>${r.kind==="vehicle"?"VEHICLE REGISTRATION": "PERSON RECORD"}</small></span><span>View record →</span></button>`).join(""):'<div class="department-empty">No matching records found. Person records appear after an officer adds a citation, arrest, warrant, or note.</div>';
  root._leoRows=rows;
}
function createLeoPaperwork(person, kind) {
  const chargeOptions = [
    "Speeding",
    "Reckless Driving",
    "Expired Registration",
    "No Insurance",
    "Driving While Suspended",
    "Improper Lane Change",
    "Failure to Stop",
    "Signal Violation",
    "Obstruction",
    "Disorderly Conduct",
    "No Valid License",
    "Other"
  ];
  const reportTitle = String(kind || "Citation");
  openLeoModal(`<div class="paperwork"><div class="paperwork-head"><small>NEW YORK ROLEPLAY · LAW ENFORCEMENT</small><h2>${escapeHtml(reportTitle.toUpperCase())} REPORT</h2><p>OFFICIAL INCIDENT / RECORD DOCUMENT</p></div><form id="leo-paper-form"><div class="official-form-grid"><label>CAD Name<input name="cadName" required value="${escapeHtml(person.cadName || "")}"></label><label>Roblox Username<input name="robloxUsername" value="${escapeHtml(person.robloxUsername || "")}"></label><label>Case Number<input name="caseNumber" value="NY-${Date.now()}"></label><label>Charge<select name="charge" required>${chargeOptions.map((charge) => `<option value="${escapeHtml(charge)}">${escapeHtml(charge)}</option>`).join("")}</select></label><label>Location<input name="location" value="NYC" placeholder="Location"></label><label>Officer<input name="officer" value="${escapeHtml(currentUser?.username || "Officer")}"></label></div><label>Details<textarea name="details" rows="5" required placeholder="Provide the factual summary, observed behavior, and any relevant statements..."></textarea></label><div class="paperwork-actions"><button type="button" class="button button-quiet" data-close-modal>Cancel</button><button class="button button-primary">File ${escapeHtml(reportTitle)}</button></div></form></div>`);
  $("#leo-paper-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const list = readStore(leoRecordsKey);
    const recordId = String(person.id || `${person.robloxUsername || person.cadName || "person"}-${Date.now()}`);
    const existingIndex = list.findIndex((entry) => String(entry.id) === recordId);
    const record = existingIndex >= 0 ? { ...list[existingIndex] } : { ...person, id: recordId, cadName: person.cadName || formData.get("cadName") || "", robloxUsername: person.robloxUsername || formData.get("robloxUsername") || "", documents: Array.isArray(person.documents) ? [...person.documents] : [] };
    record.cadName = String(formData.get("cadName") || record.cadName || "").trim();
    record.robloxUsername = String(formData.get("robloxUsername") || record.robloxUsername || "").trim();
    record.documents = Array.isArray(record.documents) ? record.documents : [];
    record.documents.push({
      type: reportTitle,
      charge: String(formData.get("charge") || "Other"),
      caseNumber: String(formData.get("caseNumber") || `NY-${Date.now()}`),
      location: String(formData.get("location") || "NYC"),
      details: String(formData.get("details") || ""),
      officer: String(formData.get("officer") || currentUser?.username || "Officer"),
      createdAt: new Date().toLocaleString()
    });
    if (existingIndex >= 0) list[existingIndex] = record; else list.push(record);
    writeStore(leoRecordsKey, list);
    $("#leo-modal").close();
    showToast(`${reportTitle} saved to the person record.`);
    searchLeo("roblox", record.robloxUsername || record.cadName || "");
  });
}
function showLeoResult(row) {
  if (row.kind === "vehicle") {
    const v = row.value;
    const status = normalizeVehicleStatus(v.status || "Valid");
    const driverName = String(v.owner || vehicleRobloxUsername || "Driver unknown");
    const driverPerson = { id: String(v.plate || v.id || driverName), cadName: driverName, robloxUsername: v.owner || vehicleRobloxUsername || "", documents: [] };
    openLeoModal(`<div class="paperwork"><div class="paperwork-head"><small>NEW YORK ROLEPLAY · VEHICLE REGISTRY</small><h2>VEHICLE RECORD</h2><p>${escapeHtml(v.plate || "NO PLATE")}</p></div><dl class="record-details"><dt>Vehicle</dt><dd>${escapeHtml(v.model || "Unknown")}</dd><dt>Color</dt><dd>${escapeHtml(v.color || "Unknown")}</dd><dt>Owner</dt><dd>${escapeHtml(driverName)}</dd><dt>Registration status</dt><dd><b class="leave-status ${status.toLowerCase()}">${escapeHtml(status)}</b></dd></dl><p class="small-muted">Status is controlled by the vehicle owner / registry record.</p><div class="paperwork-actions"><button class="button button-primary" data-leo-paper="Citation">Issue Citation</button><button class="button button-primary" data-leo-paper="Arrest">Arrest Driver</button><button class="button button-primary" data-leo-paper="Note">Add Note</button><button class="button button-quiet" data-close-modal>Close</button></div></div>`);
    $("#leo-modal-content").querySelectorAll("[data-leo-paper]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.leoPaper === "Close") return;
        createLeoPaperwork(driverPerson, button.dataset.leoPaper);
      });
    });
    return;
  }
  const person = row.value;
  const docs = person.documents || [];
  openLeoModal(`<div class="paperwork"><div class="paperwork-head"><small>NEW YORK ROLEPLAY · PERSONNEL RECORD</small><h2>PERSON RECORD</h2><p>${escapeHtml(person.cadName || person.robloxUsername || "Unidentified subject")}</p></div><dl class="record-details"><dt>CAD Name</dt><dd>${escapeHtml(person.cadName || "—")}</dd><dt>Roblox Username</dt><dd>${escapeHtml(person.robloxUsername || "—")}</dd></dl><h3>Filed documents</h3>${docs.length ? docs.map((document) => `<article class="paper-document"><strong>${escapeHtml(document.type)} · ${escapeHtml(document.caseNumber || "N/A")}</strong><p><b>${escapeHtml(document.charge || "Charge")}</b> · ${escapeHtml(document.details || "No details provided.")}</p><small>${escapeHtml(document.location || "NYC")} · ${escapeHtml(document.officer || "Officer")} · ${escapeHtml(document.createdAt || "Unknown time")}</small></article>`).join("") : '<p>No documents on file.</p>'}<div class="paperwork-actions">${["Citation", "Arrest", "Note"].map((kind) => `<button class="button button-primary" data-leo-paper="${kind}">${kind}</button>`).join("")}<button class="button button-quiet" data-close-modal>Close</button></div></div>`);
  $("#leo-modal-content").querySelectorAll("[data-leo-paper]").forEach((button) => button.addEventListener("click", () => createLeoPaperwork(person, button.dataset.leoPaper)));
}
function openBoloForm(kind) {
 const vehicle=kind==="vehicle";
 openLeoModal(`<div class="paperwork"><div class="paperwork-head"><small>NEW YORK ROLEPLAY · FIELD ALERT</small><h2>${vehicle?"VEHICLE":"PERSON"} BOLO</h2><p>BE ON THE LOOKOUT · OFFICIAL ALERT</p></div><form id="bolo-form">${vehicle?'<label>License plate (optional)<input name="plate"></label><label>Vehicle color<input name="color" required></label><label>Make / model<input name="make" required></label>':'<label>CAD Name (optional)<input name="cadName"></label>'}<label>Description<textarea name="description" rows="5" required></textarea></label><label>Issuing officer<input name="officer" value="${escapeHtml(currentUser?.username||"Officer")}"></label><div class="paperwork-actions"><button type="button" class="button button-quiet" data-close-modal>Cancel</button><button class="button button-primary">Publish BOLO</button></div></form></div>`);
 $("#bolo-form").addEventListener("submit",e=>{e.preventDefault();const f=new FormData(e.currentTarget);const data=Object.fromEntries(f.entries());const summary=vehicle?[data.plate&&`Plate ${data.plate}`,data.color,data.make,data.description].filter(Boolean).join(" · "):[data.cadName,data.description].filter(Boolean).join(" · ");const list=readStore(boloKey);list.unshift({kind,summary,createdAt:new Date().toLocaleString(),officer:data.officer});writeStore(boloKey,list);$("#leo-modal").close();renderBolos();showToast("BOLO published.");});
}

async function initialize() {
  loadGuestData();
  const params = new URLSearchParams(window.location.search);
  if (params.has("authError")) {
    const errors = {
      missing_config: "Add Discord OAuth credentials to .env to enable sign-in.",
      oauth_failed: "Discord sign-in could not be completed. Please try again.",
      state_mismatch: "Sign-in expired. Please try connecting again."
    };
    showToast(errors[params.get("authError")] || "Discord sign-in failed.");
    history.replaceState(null, "", window.location.pathname);
  }

  try {
    const data = await requestJson("/api/me");
    currentUser = data.user || null;
    if (currentUser && data.profile) {
      profile = { ...defaultProfile, ...data.profile };
      vehicles = [];
      vehicleSyncStatus = "loading";
      vehicleRobloxUsername = currentUser.robloxUsername || "";
      portfolio = data.portfolio || { balance: 3325, holdings: [], transactions: [] };
    }
  } catch {
    currentUser = null;
    vehicles = [];
    vehicleSyncStatus = "error";
  }

  if (currentUser) {
    localStorage.removeItem(profileKey);
    localStorage.removeItem(marketKey);
  }
  updateProfileUI();
  if (currentUser) await loadDepartments();

  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    profile = {
      ...profile,
      name: String(formData.get("name") || "").trim() || "City Resident",
      dob: String(formData.get("dob") || "—"),
      pronouns: String(formData.get("pronouns") || "").trim() || "—",
      borough: String(formData.get("borough") || "Manhattan"),
      neighborhood: String(formData.get("neighborhood") || "").trim() || "New York",
      occupation: String(formData.get("occupation") || "").trim() || "City resident",
      eyes: String(formData.get("eyes") || "").trim() || "—",
      height: String(formData.get("height") || "").trim() || "—",
      idNo: profile.idNo || makeId()
    };
    try {
      await saveProfile();
      updateProfileUI();
      profileModal.close();
      showToast(currentUser ? "Profile saved to your account." : "Profile saved on this device.");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#refresh-market").addEventListener("click", () => fetchMarketData(true));
  $("#trade-quantity").addEventListener("input", updateTradePreview);
  $("#trade-quantity").addEventListener("change", updateTradePreview);
  $("#quantity-minus").addEventListener("click", () => {
    const quantity = Math.max(1, Math.floor(Number($("#trade-quantity").value) || 1) - 1);
    $("#trade-quantity").value = String(quantity);
    updateTradePreview();
  });
  $("#quantity-plus").addEventListener("click", () => {
    const quantity = Math.max(1, Math.floor(Number($("#trade-quantity").value) || 0) + 1);
    $("#trade-quantity").value = String(quantity);
    updateTradePreview();
  });
  document.querySelectorAll(".trade-tab").forEach((tab) => tab.addEventListener("click", () => setTradeSide(tab.dataset.side)));
  $("#trade-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitTrade();
  });

  $("#edit-profile").addEventListener("click", openProfileEditor);
  $("#edit-profile-top").addEventListener("click", openProfileEditor);
  $("#flip-card").addEventListener("click", () => $("#identity-card").classList.toggle("flipped"));
  $("#flip-action").addEventListener("click", () => $("#identity-card").classList.toggle("flipped"));
  $("#uv-action").addEventListener("click", () => {
    const card = $("#identity-card");
    card.classList.toggle("uv-on");
    $("#uv-action").classList.toggle("uv-active", card.classList.contains("uv-on"));
  });
  $("#download-card").addEventListener("click", downloadCard);
  $("#reset-profile").addEventListener("click", async () => {
    if (!confirm("Reset this profile to the sample New York resident?")) return;
    profile = { ...defaultProfile };
    try {
      await saveProfile();
      updateProfileUI();
      showToast("Profile reset to the sample resident.");
    } catch (error) {
      showToast(error.message);
    }
  });

  ["#sidebar-signin", "#account-button", "#top-avatar", "#connect-inline"].forEach((selector) => {
    $(selector).addEventListener("click", openConnect);
  });
  document.querySelectorAll("[data-toast]").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.toast)));
  $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  document.addEventListener("click", (event) => {
    if (window.innerWidth <= 900 && $("#sidebar").classList.contains("open") && !$("#sidebar").contains(event.target) && event.target !== $("#menu-toggle")) {
      $("#sidebar").classList.remove("open");
    }
  });
  [profileModal, connectModal].forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
  tradeModal.addEventListener("click", (event) => {
    if (event.target === tradeModal) tradeModal.close();
  });
  document.addEventListener("click", (event) => {
    const closeButton = event.target.closest?.("[data-close-modal]");
    if (!closeButton) return;
    const dialog = closeButton.closest("dialog");
    if (dialog) dialog.close();
    else if (event.target.closest?.("#leo-modal")) $("#leo-modal")?.close();
  });
  document.addEventListener("click", (event) => {
    const routeControl = event.target.closest?.("[data-route]");
    if (!routeControl) return;
    event.preventDefault();
    activatePage(routeControl.dataset.route, true);
  });
  document.addEventListener("click", async (event) => {
    const licenseClaim = event.target.closest?.("[data-license-claim]");
    if (licenseClaim) {
      event.preventDefault();
      licenseClaim.disabled = true;
      try {
        await requestJson("/api/licenses/" + encodeURIComponent(licenseClaim.dataset.licenseClaim) + "/claim", { method: "POST", body: JSON.stringify({}) });
        showToast("License issued to your resident record.");
      } catch (error) {
        showToast(error.message);
      }
      await loadLicenses(true);
      return;
    }
    if (event.target.closest?.("[data-license-refresh]")) {
      event.preventDefault();
      await loadLicenses();
      return;
    }
    const adminTab = event.target.closest?.("[data-admin-tab]");
    if (adminTab) {
      event.preventDefault();
      activeAdminTab = adminTab.dataset.adminTab;
      renderAdminPage();
      return;
    }
    const departmentTab = event.target.closest?.("[data-department-tab]");
    if (departmentTab) {
      event.preventDefault();
      activeDepartmentTab = departmentTab.dataset.departmentTab;
      renderDepartmentPage();
      return;
    }
    const departmentAction = event.target.closest?.("[data-department-action]");
    if (departmentAction && activeDepartment) {
      event.preventDefault();
      try {
        await handleDepartmentAction(departmentAction);
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const adminAction = event.target.closest?.("[data-admin-action]");
    if (adminAction?.dataset.adminAction === "delete-department") {
      event.preventDefault();
      if (!confirm("Remove this department and its roster, shifts, and leave requests?")) return;
      try {
        await requestJson("/api/admin/departments/" + encodeURIComponent(adminAction.dataset.departmentId), { method: "DELETE" });
        await loadDepartments();
        await loadAdminData();
        showToast("Department removed.");
      } catch (error) {
        showToast(error.message);
      }
    }
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target.closest?.("[data-department-form]");
    if (!form) return;
    event.preventDefault();
    try {
      await handleDepartmentForm(form);
    } catch (error) {
      showToast(error.message);
    }
  });
  document.addEventListener("change", async (event) => {
    const roleSelect = event.target.closest?.("[data-member-role]");
    if (!roleSelect || !activeDepartment) return;
    try {
      const base = "/api/departments/" + encodeURIComponent(activeDepartment.department.id);
      await requestJson(base + "/members/" + encodeURIComponent(roleSelect.dataset.memberRole), { method: "PUT", body: JSON.stringify({ roleId: roleSelect.value }) });
      await refreshDepartmentPage("Department role updated.");
    } catch (error) {
      showToast(error.message);
      await loadDepartmentPage(activeDepartment.department.id);
    }
  });
  document.addEventListener("click", e=>{const b=e.target.closest("[data-vehicle-status]");if(!b)return;const key=b.dataset.vehicleStatus;const current=vehicles.find(v=>String(v.plate||v.id)===key);if(!current)return;const statusOrder=["Valid","Stolen","Expired"];const currentStatus=normalizeVehicleStatus(current.status);const currentIndex=statusOrder.indexOf(currentStatus);const next=statusOrder[(currentIndex === -1 ? 0 : currentIndex + 1) % statusOrder.length];const statuses=readVehicleStatusMap();statuses[key]=next;writeVehicleStatusMap(statuses);current.status=next;persistVehicleList(vehicles);renderVehicles();showToast(`Vehicle status updated to ${next}.`);});
    $("#leo-search-form")?.addEventListener("submit", e=>{e.preventDefault();const f=new FormData(e.currentTarget);searchLeo(f.get("type"),f.get("query"));});
  $("#leo-results")?.addEventListener("click",e=>{const b=e.target.closest("[data-leo-open]");if(b){const rows=e.currentTarget._leoRows||[];showLeoResult(rows[Number(b.dataset.leoOpen)]);}});
  document.addEventListener("click",e=>{const b=e.target.closest("[data-leo-action]");if(b)openBoloForm(b.dataset.leoAction==="vehicle-bolo"?"vehicle":"person");});
  renderBolos();
  window.addEventListener("popstate", () => activatePage(currentPageFromHash()));
  window.addEventListener("hashchange", () => activatePage(currentPageFromHash()));
  activatePage(currentPageFromHash());
  if (currentUser) void refreshLiveVehicles();
  fetchMarketData();
  refreshErlcStatus();
  window.setInterval(() => fetchMarketData(), 60_000);
  window.setInterval(() => refreshErlcStatus(), 60_000);
  window.setInterval(() => { if (currentUser) void refreshLiveVehicles(); }, 30_000);
  window.setInterval(() => { if (currentUser && document.body.dataset.page === "licenses") void loadLicenses(true); }, 30_000);
  window.setInterval(updateLiveShiftCounters, 30_000);
}

initialize().catch((error) => {
  console.error("Application initialization failed:", error);
  setText("#market-status-label", "APP ERROR");
  showToast("The dashboard could not finish loading. Refresh the page to try again.");
});
