// ==========================================================================
// admin/users.js — User management (search/pagination list, presence,
// ban/delete) + User Detail page (course access, manual access codes,
// purchase history, devices) — kept together since they share state
// (allUsers, isUserOnline, showUserDetail, etc.)
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc,
  query, orderBy, where, serverTimestamp, Timestamp,
  limit, startAfter, getCountFromServer, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, escapeHtml, formatDate, formatDateTime, confirmAction } from "../utils.js";
import { me, courses } from "../admin.js";
import { generateUniqueAccessCode, formatAccessCodeForDisplay, sendAccessCodeEmail } from "./purchases.js";

/* ==========================================================================
   User management — search/pagination list, presence, ban/delete, course
   access, manual access codes, purchase history, devices
   ========================================================================== */
const ONLINE_WINDOW_MS = 2 * 60 * 1000; // "online now" = active in the last 2 minutes
const USERS_PAGE_SIZE = 20;

let allUsers = [];        // Users loaded so far across pages (search filters this loaded set)
let usersLastDoc = null;
let usersHasMore = true;
let usersSearchTerm = "";
let usersActiveFilter = "all";

export function isUserOnline(u) {
  const ms = u.lastActive?.toMillis ? u.lastActive.toMillis() : 0;
  return ms > 0 && Date.now() - ms < ONLINE_WINDOW_MS;
}

export function userAvatarHtml(u, sizeClass = "") {
  return u.photoURL
    ? `<img src="${u.photoURL}" alt="" class="${sizeClass}">`
    : `<span class="initials-sm ${sizeClass}">${escapeHtml((u.displayName || u.email || "?").trim().charAt(0).toUpperCase())}</span>`;
}

export async function loadUsersTable(reset = true) {
  if (reset) {
    allUsers = [];
    usersLastDoc = null;
    usersHasMore = true;
  }
  loadUsersStats();
  await fetchNextUsersPage();

  document.getElementById("user-search-input").addEventListener("input", (e) => {
    usersSearchTerm = e.target.value.trim().toLowerCase();
    renderUsersTable();
  });
  document.querySelectorAll("#user-filter-chips .chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      document.querySelectorAll("#user-filter-chips .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      usersActiveFilter = chip.dataset.filter;
      renderUsersTable();
    })
  );
  document.getElementById("users-load-more-btn").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.innerHTML = `<span class="spinner"></span>`;
    await fetchNextUsersPage();
    e.currentTarget.disabled = false;
    e.currentTarget.textContent = "Load More Users";
  });
}

async function fetchNextUsersPage() {
  if (!usersHasMore) return;
  const constraints = [orderBy("createdAt", "desc"), limit(USERS_PAGE_SIZE)];
  if (usersLastDoc) constraints.push(startAfter(usersLastDoc));
  const snap = await getDocs(query(collection(db, "users"), ...constraints));
  const page = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allUsers = allUsers.concat(page);
  usersLastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : usersLastDoc;
  usersHasMore = snap.docs.length === USERS_PAGE_SIZE;
  document.getElementById("users-load-more-btn").style.display = usersHasMore ? "" : "none";
  renderUsersTable();
}

/* ---------- Top stats: total users, online now, admins — via count aggregation
   (no need to download every document just to show a number) ---------- */
async function loadUsersStats() {
  const grid = document.getElementById("users-stat-grid");
  try {
    const [totalSnap, adminSnap] = await Promise.all([
      getCountFromServer(collection(db, "users")),
      getCountFromServer(query(collection(db, "users"), where("isAdmin", "==", true))),
    ]);
    grid.innerHTML = `
      <div class="stat-card-sm"><div><div class="n">${totalSnap.data().count}</div><div class="l">Total Users</div></div></div>
      <div class="stat-card-sm online"><div><div class="n" id="users-online-count-n">…</div><div class="l"><span class="online-dot"></span> Online Now</div></div></div>
      <div class="stat-card-sm"><div><div class="n">${adminSnap.data().count}</div><div class="l">Admins</div></div></div>
    `;
  } catch {
    grid.innerHTML = `<div class="empty-state">Could not load user stats</div>`;
  }
  loadOnlineUsers();
}

/* ---------- Who's on the site right now ---------- */
async function loadOnlineUsers() {
  try {
    const cutoff = Timestamp.fromMillis(Date.now() - ONLINE_WINDOW_MS);
    const snap = await getDocs(query(collection(db, "users"), where("lastActive", ">", cutoff), limit(60)));
    const online = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const countEl = document.getElementById("users-online-count-n");
    if (countEl) countEl.textContent = online.length + (online.length === 60 ? "+" : "");

    const card = document.getElementById("online-users-card");
    const list = document.getElementById("online-users-list");
    if (!online.length) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";
    list.innerHTML = online
      .map((u) => `
        <div class="online-user-chip" data-view-user="${u.id}">
          ${userAvatarHtml(u)}
          <span>${escapeHtml(u.displayName || u.email || "User")}</span>
        </div>`)
      .join("");
    list.querySelectorAll("[data-view-user]").forEach((el) => el.addEventListener("click", () => showUserDetail(el.dataset.viewUser)));
  } catch (err) {
    console.error("Could not load online users:", err);
  }
}
let onlineUsersPollStarted = false;
function startOnlineUsersPolling() {
  if (onlineUsersPollStarted) return;
  onlineUsersPollStarted = true;
  setInterval(loadOnlineUsers, 30000);
}

function renderUsersTable() {
  const tbody = document.querySelector("#users-table tbody");
  const term = usersSearchTerm;
  let list = term
    ? allUsers.filter((u) => (u.displayName || "").toLowerCase().includes(term) || (u.email || "").toLowerCase().includes(term))
    : allUsers;

  const filters = {
    all: () => true,
    online: (u) => isUserOnline(u),
    admin: (u) => !!u.isAdmin,
    banned: (u) => !!u.suspended,
    enrolled: (u) => (u.enrolledCourses || []).length > 0,
  };
  list = list.filter(filters[usersActiveFilter] || filters.all);

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="2"><div class="empty-state">No users found</div></td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((u) => {
      const deviceCount = u.deviceCount || 0;
      const multiDevice = deviceCount > 1;
      const online = isUserOnline(u);
      const courseCount = (u.enrolledCourses || []).length;
      return `
    <tr class="user-row" data-view-user="${u.id}">
      <td data-label="User"><div class="cell-title">${userAvatarHtml(u)}<div>
        <div class="t">${escapeHtml(u.displayName || "")}
          ${online ? `<span class="user-online-badge"><span class="online-dot"></span>Online</span>` : ""}
          ${u.suspended ? `<span class="user-suspended-badge"><i class="fa-solid fa-ban"></i> Banned</span>` : ""}
          ${u.isAdmin ? `<span class="user-admin-badge"><i class="fa-solid fa-star"></i> Admin</span>` : ""}
          ${multiDevice ? ` <span class="badge badge-coral device-warning-badge" title="Multiple different devices detected logging in/signing up"><i class="fa-solid fa-triangle-exclamation"></i> ${deviceCount} devices</span>` : ""}
        </div>
        <div class="s">${escapeHtml(u.email || "")} · <span class="user-course-count">${courseCount} course${courseCount === 1 ? "" : "s"}</span></div>
      </div></div></td>
      <td data-label=""><i class="fa-solid fa-chevron-right user-row-arrow"></i></td>
    </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-view-user]").forEach((row) =>
    row.addEventListener("click", () => showUserDetail(row.dataset.viewUser))
  );

  startOnlineUsersPolling();
}

/* ==========================================================================
   User Detail page — everything needed to manage one user in one place:
   admin toggle, suspend/ban, delete, course access grant/revoke, manual
   access code generation, purchase history, device/login info
   ========================================================================== */
function openUserDetailSection() {
  document.querySelectorAll(".admin-section").forEach((s) => s.classList.remove("active"));
  document.getElementById("section-user-detail").classList.add("active");
  document.querySelectorAll(".admin-nav-item").forEach((b) => b.classList.remove("active"));
  document.querySelector('.admin-nav-item[data-section="users"]')?.classList.add("active");
  const mobileTitle = document.getElementById("admin-mobile-topbar-title");
  if (mobileTitle) mobileTitle.textContent = "Manage User";
  document.getElementById("admin-sidebar")?.classList.remove("open");
  document.getElementById("admin-sidebar-backdrop")?.classList.remove("open");
  window.scrollTo(0, 0);
}

export async function showUserDetail(uid) {
  openUserDetailSection();
  const headEl = document.getElementById("user-detail-header");
  const bodyEl = document.getElementById("user-detail-body");
  headEl.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  bodyEl.innerHTML = "";

  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) {
    headEl.innerHTML = `<div class="empty-state">This user could not be found — they may have just been deleted</div>`;
    return;
  }
  const u = { id: snap.id, ...snap.data() };
  renderUserDetailHeader(u);
  renderUserDetailBody(u);
}

function renderUserDetailHeader(u) {
  const headEl = document.getElementById("user-detail-header");
  const isSelf = u.id === me.user.uid;
  const online = isUserOnline(u);
  headEl.innerHTML = `
    <div class="user-detail-head-card">
      <div class="user-detail-avatar">${userAvatarHtml(u)}</div>
      <div>
        <div class="user-detail-name">${escapeHtml(u.displayName || "")}
          ${online ? `<span class="user-online-badge"><span class="online-dot"></span>Online</span>` : ""}
          ${u.suspended ? `<span class="user-suspended-badge"><i class="fa-solid fa-ban"></i> Banned</span>` : ""}
        </div>
        <div class="user-detail-email">${escapeHtml(u.email || "")}</div>
        <div class="user-detail-meta">Joined ${formatDate(u.createdAt)} · ${(u.enrolledCourses || []).length} course(s) enrolled</div>
      </div>
      <div class="user-detail-actions">
        <label class="switch" title="Admin"><input type="checkbox" id="udp-admin-toggle" ${u.isAdmin ? "checked" : ""}><span class="knob"></span></label>
        <button type="button" class="btn btn-outline btn-sm" id="udp-suspend-btn">${u.suspended ? '<i class="fa-solid fa-lock-open"></i> Unban' : '<i class="fa-solid fa-ban"></i> Ban'}</button>
        <button type="button" class="btn btn-danger btn-sm" id="udp-delete-btn"><i class="fa-solid fa-trash"></i> Delete User</button>
      </div>
    </div>
  `;

  document.getElementById("udp-admin-toggle").addEventListener("change", async (e) => {
    const checked = e.target.checked;
    if (isSelf && !checked && !(await confirmAction("Revoke your own admin privileges? This will remove you from this panel."))) {
      e.target.checked = true;
      return;
    }
    try {
      await updateDoc(doc(db, "users", u.id), { isAdmin: checked });
      toast("Updated", "success");
      u.isAdmin = checked;
      if (isSelf && !checked) setTimeout(() => (window.location.href = "index.html"), 700);
    } catch {
      toast("Could not update", "error");
      e.target.checked = !checked;
    }
  });

  document.getElementById("udp-suspend-btn").addEventListener("click", () => toggleSuspendUser(u));
  document.getElementById("udp-delete-btn").addEventListener("click", () => deleteUserAccount(u));
}

async function toggleSuspendUser(u) {
  const suspending = !u.suspended;
  if (u.id === me.user.uid && suspending) {
    toast("You can't ban your own account", "error");
    return;
  }
  const ok = await confirmAction(
    suspending
      ? `Ban "${u.displayName || u.email}"? They'll be signed out immediately and blocked from the site until unbanned.`
      : `Unban "${u.displayName || u.email}"? They'll be able to log in and use the site again.`,
    { danger: suspending, confirmLabel: suspending ? "Yes, Ban" : "Yes, Unban" }
  );
  if (!ok) return;
  try {
    await updateDoc(doc(db, "users", u.id), suspending
      ? { suspended: true, suspendedAt: serverTimestamp() }
      : { suspended: false, suspendedAt: null }
    );
    toast(suspending ? "User banned" : "User unbanned", "success");
    u.suspended = suspending;
    renderUserDetailHeader(u);
    loadUsersTable();
  } catch {
    toast("Could not update", "error");
  }
}

async function deleteUserAccount(u) {
  if (u.id === me.user.uid) {
    toast("You can't delete your own account", "error");
    return;
  }
  const ok = await confirmAction(
    `Delete "${u.displayName || u.email}"? This removes their profile, enrollment, and device data from the site. This cannot be undone. (Note: their login itself isn't deleted — if they sign in again a fresh, empty profile is created. To fully block them from the site, use Ban instead.)`,
    { confirmLabel: "Yes, Delete User" }
  );
  if (!ok) return;
  try {
    const devicesSnap = await getDocs(collection(db, "users", u.id, "devices"));
    await Promise.all(devicesSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "users", u.id));
    toast("User deleted", "success");
    document.querySelector('.admin-nav-item[data-section="users"]')?.click();
    loadUsersTable();
  } catch {
    toast("Could not delete this user", "error");
  }
}

function renderUserDetailBody(u) {
  const bodyEl = document.getElementById("user-detail-body");
  bodyEl.innerHTML = `
    <div class="card udp-code-card">
      <h3 class="mb-12"><i class="fa-solid fa-key"></i> Generate Access Code</h3>
      <p class="muted" style="font-size:0.85rem; margin-bottom:10px;">This is the only way to give this user access to a course. Pick a course and issue a code locked to their account.</p>
      <div class="field" style="margin:0;">
        <label>Course</label>
        <select id="udp-code-course-select">${courses.map((c) => `<option value="${c.id}">${escapeHtml(c.title || "Untitled")}</option>`).join("")}</select>
      </div>
      <button type="button" class="btn btn-primary mt-16" id="udp-generate-code-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Code</button>
      <div id="udp-generated-code-box"></div>
    </div>

    <div class="udp-grid mt-16">
      <div class="card">
        <h3 class="mb-12"><i class="fa-solid fa-book-open-reader"></i> Enrolled Courses</h3>
        <p class="muted" style="font-size:0.85rem; margin-bottom:10px;">Courses this user currently has access to. Access can only be revoked here — to add a course, generate an access code above</p>
        <div id="udp-course-access-list"><div class="loading-screen"><span class="spinner"></span></div></div>
      </div>

      <div class="card">
        <h3 class="mb-12"><i class="fa-solid fa-clock-rotate-left"></i> Access Code History</h3>
        <p class="muted" style="font-size:0.85rem; margin-bottom:10px;">Every code ever issued to this user, used or not</p>
        <div id="udp-code-history"><div class="loading-screen"><span class="spinner"></span></div></div>
      </div>

      <div class="card">
        <h3 class="mb-12"><i class="fa-solid fa-money-bill-wave"></i> Purchase History</h3>
        <div id="udp-purchase-history"><div class="loading-screen"><span class="spinner"></span></div></div>
      </div>

      <div class="card">
        <h3 class="mb-12"><i class="fa-solid fa-mobile-screen"></i> Device & Login Info</h3>
        <div id="udp-devices"><div class="loading-screen"><span class="spinner"></span></div></div>
      </div>
    </div>
  `;

  renderEnrolledCoursesPanel(u);
  bindGenerateCodePanel(u);
  loadAccessCodeHistory(u);
  loadUserPurchaseHistory(u.id);
  loadUserDevicesPanel(u.id);
}

/* ---------- Enrolled courses: read-only, revoke-only. Granting access is only
   allowed through a redeemed access code — never a direct toggle here. ---------- */
function renderEnrolledCoursesPanel(u) {
  const el = document.getElementById("udp-course-access-list");
  const enrolled = courses.filter((c) => (u.enrolledCourses || []).includes(c.id));
  if (!enrolled.length) {
    el.innerHTML = `<div class="empty-state">Not enrolled in any course yet</div>`;
    return;
  }
  el.innerHTML = enrolled
    .map(
      (c) => `
      <div class="access-course-row">
        <div><div class="t">${escapeHtml(c.title || "Untitled")}</div><div class="s">${escapeHtml(c.category || "")}</div></div>
        <button type="button" class="btn btn-sm btn-danger" data-revoke-course="${c.id}">
          <i class="fa-solid fa-xmark"></i> Revoke
        </button>
      </div>`
    )
    .join("");

  el.querySelectorAll("[data-revoke-course]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const courseId = btn.dataset.revokeCourse;
      const course = courses.find((c) => c.id === courseId);
      const ok = await confirmAction(`Revoke access to "${course?.title || "this course"}" for "${u.displayName || u.email}"?`, { danger: true, confirmLabel: "Yes, Revoke" });
      if (!ok) return;
      btn.disabled = true;
      try {
        await updateDoc(doc(db, "users", u.id), { enrolledCourses: arrayRemove(courseId) });
        toast("Access revoked", "success");
        u.enrolledCourses = (u.enrolledCourses || []).filter((id) => id !== courseId);
        renderEnrolledCoursesPanel(u);
        renderUserDetailHeader(u);
      } catch {
        toast("Could not update access", "error");
        btn.disabled = false;
      }
    })
  );
}

/* ---------- Access code history: every code ever issued to this user, so the
   admin has full visibility even though codes are the only path to access ---------- */
async function loadAccessCodeHistory(u) {
  const el = document.getElementById("udp-code-history");
  try {
    const snap = await getDocs(query(collection(db, "accessCodes"), where("uid", "==", u.id)));
    const list = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (!list.length) {
      el.innerHTML = `<div class="empty-state">No access codes issued to this user yet</div>`;
      return;
    }
    el.innerHTML = `<div class="code-history-list">${list
      .map((code) => {
        const course = courses.find((c) => c.id === code.courseId);
        const statusBadge = code.used
          ? `<span class="badge badge-teal">Used</span>`
          : `<span class="badge badge-amber">Unused</span>`;
        return `
        <div class="code-history-row">
          <div class="code-history-main">
            <div class="t">${escapeHtml(course?.title || "Unknown course")} ${statusBadge}</div>
            <div class="s"><code>${formatAccessCodeForDisplay(code.id)}</code></div>
            <div class="s">Issued ${formatDate(code.createdAt)}${code.used ? ` · Used ${formatDate(code.usedAt)}` : ""}${code.manual ? " · Manual" : " · From purchase"}</div>
          </div>
          ${!code.used ? `<button type="button" class="icon-btn danger" data-revoke-code="${code.id}" title="Invalidate this code"><i class="fa-solid fa-trash"></i></button>` : ""}
        </div>`;
      })
      .join("")}</div>`;

    el.querySelectorAll("[data-revoke-code]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const codeId = btn.dataset.revokeCode;
        const ok = await confirmAction("Invalidate this unused access code? It can no longer be redeemed.", { danger: true, confirmLabel: "Yes, Invalidate" });
        if (!ok) return;
        btn.disabled = true;
        try {
          await deleteDoc(doc(db, "accessCodes", codeId));
          toast("Code invalidated", "success");
          loadAccessCodeHistory(u);
        } catch {
          toast("Could not invalidate the code", "error");
          btn.disabled = false;
        }
      })
    );
  } catch {
    el.innerHTML = `<div class="empty-state">Could not load access code history</div>`;
  }
}

/* ---------- Manual access-code generation, tied to this user + a chosen course ---------- */
function bindGenerateCodePanel(u) {
  document.getElementById("udp-generate-code-btn").addEventListener("click", async (e) => {
    const courseId = document.getElementById("udp-code-course-select").value;
    if (!courseId) { toast("Please select a course", "error"); return; }
    const course = courses.find((c) => c.id === courseId);
    const btn = e.currentTarget;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const code = await generateUniqueAccessCode();
      await setDoc(doc(db, "accessCodes", code), {
        uid: u.id,
        courseId,
        requestId: null,
        manual: true,
        issuedBy: me.user.uid,
        used: false,
        createdAt: serverTimestamp(),
      });
      const box = document.getElementById("udp-generated-code-box");
      box.innerHTML = `
        <div class="gen-code-result">
          <div><code>${formatAccessCodeForDisplay(code)}</code><div class="s" style="margin-top:2px;">For: ${escapeHtml(course?.title || "")}</div></div>
          <div class="row-actions">
            <button type="button" class="icon-btn" id="udp-copy-code-btn" title="Copy"><i class="fa-solid fa-copy"></i></button>
            <button type="button" class="btn btn-outline btn-sm" id="udp-email-code-btn"><i class="fa-solid fa-envelope"></i> Email It</button>
          </div>
        </div>`;
      document.getElementById("udp-copy-code-btn").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(formatAccessCodeForDisplay(code)); toast("Copied", "success"); } catch {}
      });
      document.getElementById("udp-email-code-btn").addEventListener("click", async (ev) => {
        ev.currentTarget.disabled = true;
        const sent = await sendAccessCodeEmail({ userName: u.displayName, userEmail: u.email, courseId, courseTitle: course?.title }, code);
        toast(sent ? "Email sent" : "Could not send the email", sent ? "success" : "error");
        ev.currentTarget.disabled = false;
      });
      toast("Access code generated", "success");
      loadAccessCodeHistory(u);
    } catch {
      toast("Could not generate a code, please try again", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });
}

/* ---------- This user's purchase request history ---------- */
async function loadUserPurchaseHistory(uid) {
  const el = document.getElementById("udp-purchase-history");
  try {
    const snap = await getDocs(query(collection(db, "purchaseRequests"), where("uid", "==", uid)));
    const list = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (!list.length) {
      el.innerHTML = `<div class="empty-state">No purchase requests from this user yet</div>`;
      return;
    }
    const statusBadge = (s) =>
      s === "approved" ? `<span class="badge badge-teal">Approved</span>` :
      s === "rejected" ? `<span class="badge badge-coral">Rejected</span>` :
      `<span class="badge badge-amber">Pending</span>`;
    el.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Course</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${list
      .map((p) => `<tr>
        <td data-label="Course">${escapeHtml(p.courseTitle || "")}</td>
        <td data-label="Amount">৳${p.amount || 0}</td>
        <td data-label="Status">${statusBadge(p.status)}</td>
        <td data-label="Date">${formatDate(p.createdAt)}</td>
      </tr>`)
      .join("")}</tbody></table></div>`;
  } catch {
    el.innerHTML = `<div class="empty-state">Could not load purchase history</div>`;
  }
}

/* ---------- This user's device/login list ---------- */
async function loadUserDevicesPanel(uid) {
  const el = document.getElementById("udp-devices");
  try {
    const snap = await getDocs(query(collection(db, "users", uid, "devices"), orderBy("lastSeen", "desc")));
    const devices = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!devices.length) {
      el.innerHTML = `<div class="empty-state">No device information recorded yet</div>`;
      return;
    }
    const deviceIcon = (type) =>
      type === "Mobile" ? "fa-mobile-screen-button" : type === "Tablet" ? "fa-tablet-screen-button" : "fa-desktop";
    const warningHtml =
      devices.length > 1
        ? `<div class="device-warning-banner"><i class="fa-solid fa-triangle-exclamation"></i> This user has logged in/signed up from ${devices.length} different devices — check whether the account is being shared</div>`
        : "";
    el.innerHTML =
      warningHtml +
      `<div class="device-list">` +
      devices
        .map(
          (d) => `
        <div class="device-item">
          <div class="device-item-icon"><i class="fa-solid ${deviceIcon(d.deviceType)}"></i></div>
          <div class="device-item-body">
            <div class="device-item-title">${escapeHtml(d.deviceType || "Unknown")} — ${escapeHtml(d.os || "")} · ${escapeHtml(d.browser || "")}</div>
            <div class="device-item-meta">First login: ${formatDateTime(d.firstSeen)}</div>
            <div class="device-item-meta">Last login: ${formatDateTime(d.lastSeen)} · ${d.loginCount || 1} times total</div>
          </div>
        </div>`
        )
        .join("") +
      `</div>`;
  } catch {
    el.innerHTML = `<div class="empty-state">Could not load device information</div>`;
  }
}

