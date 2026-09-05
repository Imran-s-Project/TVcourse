// ==========================================================================
// admin/notifications.js — Notifications tab: admin creates/manages, tagged
// to course(s), targeted at everyone or only students enrolled in the
// tagged course(s). Read/tap tracking + rendering lives in js/notifications.js
// (shared with the student-facing bell); this section is just the admin CRUD.
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  toast, escapeHtml, formatDate, formatDateTime, openModal, closeModal, confirmAction,
} from "../utils.js";
import { me, courses } from "../admin.js";

/* ==========================================================================
   Notifications — admin creates/manages, tagged to course(s), targeted at
   everyone or only students enrolled in the tagged course(s). Read/tap
   tracking + rendering lives in js/notifications.js (shared with the
   student-facing bell); this section is just the admin CRUD.
   ========================================================================== */
let currentNotifications = [];

const NOTIF_TYPE_ICON = {
  course_update: "fa-video",
  new_course: "fa-book-sparkles",
  exam: "fa-file-pen",
  announcement: "fa-bullhorn",
  general: "fa-circle-info",
};
const NOTIF_TYPE_LABEL = {
  course_update: "Course Update",
  new_course: "New Course",
  exam: "Exam",
  announcement: "Announcement",
  general: "General",
};

function notifAudienceLabel(n) {
  return n.audience === "enrolled" ? "Only enrolled students" : "Everyone";
}

function notifTimeAgo(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return formatDate(ts);
}

// Compact, single-line-per-notification list (icon + title + when) — tap a
// row to open the full detail sheet (openNotificationDetail) instead of
// dumping every field into the row itself.
export async function loadNotificationsList() {
  const wrap = document.getElementById("notifications-list");
  wrap.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "notifications"), orderBy("createdAt", "desc")));
    currentNotifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    currentNotifications = [];
  }

  if (!currentNotifications.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-bell"></i></div><p>No notifications sent yet</p></div>`;
    return;
  }

  wrap.innerHTML = `<div class="admin-notif-list">
    ${currentNotifications
      .map((n) => {
        const icon = NOTIF_TYPE_ICON[n.type] || "fa-circle-info";
        return `
        <button type="button" class="admin-notif-row" data-id="${n.id}">
          <div class="admin-notif-row-icon"><i class="fa-solid ${icon}"></i></div>
          <div class="admin-notif-row-main">
            <div class="admin-notif-row-title">${n.pinned ? `<i class="fa-solid fa-thumbtack" style="font-size:.7em;color:var(--accent-amber);margin-right:5px;" title="Pinned"></i>` : ""}${escapeHtml(n.title || "")}</div>
            <div class="admin-notif-row-meta">
              <span>${notifTimeAgo(n.createdAt)}</span>
              <span class="admin-notif-row-dot">•</span>
              <span>${escapeHtml(notifAudienceLabel(n))}</span>
              ${n.link ? `<span class="admin-notif-row-dot">•</span><span title="${escapeHtml(n.link)}"><i class="fa-solid fa-link"></i> Custom link</span>` : ""}
              ${n.active ? "" : `<span class="admin-notif-row-dot">•</span><span class="admin-notif-row-hidden">Hidden</span>`}
            </div>
          </div>
          <i class="fa-solid fa-chevron-right admin-notif-row-chevron"></i>
        </button>`;
      })
      .join("")}
  </div>`;

  wrap.querySelectorAll(".admin-notif-row").forEach((row) => row.addEventListener("click", () => openNotificationDetail(row.dataset.id)));
}

// Full detail sheet for one notification — everything the old stacked-card
// table row used to dump inline now lives here instead, opened on tap.
function openNotificationDetail(id) {
  const n = currentNotifications.find((x) => x.id === id);
  if (!n) return;
  const icon = NOTIF_TYPE_ICON[n.type] || "fa-circle-info";
  const typeLabel = NOTIF_TYPE_LABEL[n.type] || "General";

  const overlay = openModal(`
    <div class="modal-head"><h3>Notification Details</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <div class="notif-detail">
      <div class="notif-detail-head">
        <div class="notif-detail-icon"><i class="fa-solid ${icon}"></i></div>
        <div>
          <div class="notif-detail-title">${escapeHtml(n.title || "")}</div>
          <div class="notif-detail-sub">${escapeHtml(typeLabel)} · ${formatDateTime(n.createdAt)}</div>
        </div>
      </div>
      ${n.message ? `<p class="notif-detail-message">${escapeHtml(n.message)}</p>` : ""}
      <div class="notif-detail-rows">
        <div class="notif-detail-row"><span>Audience</span><b>${escapeHtml(notifAudienceLabel(n))}</b></div>
        <div class="notif-detail-row"><span>Status</span><b>${n.active ? `<span class="badge badge-teal">Active</span>` : `<span class="badge badge-coral">Hidden</span>`}</b></div>
        <div class="notif-detail-row"><span>Pinned</span><b>${n.pinned ? `<span class="badge badge-amber"><i class="fa-solid fa-thumbtack"></i> Pinned to top</span>` : "No"}</b></div>
        ${
          n.link
            ? `<div class="notif-detail-row"><span>Opens</span><b><a href="${escapeHtml(n.link)}" target="_blank" rel="noopener" style="word-break:break-all;">${escapeHtml(n.link)}</a></b></div>`
            : `<div class="notif-detail-row"><span>Tagged Course(s)</span><b>${
                (n.courseTitles || []).length
                  ? `<div class="settings-badges">${n.courseTitles.map((t) => `<span class="badge badge-teal">${escapeHtml(t)}</span>`).join("")}</div>`
                  : `<span class="badge badge-amber">General (no course)</span>`
              }</b></div>`
        }
      </div>
      <div class="notif-detail-actions">
        <button type="button" class="btn btn-outline btn-sm" id="nd-edit"><i class="fa-solid fa-pen"></i> Edit</button>
        <button type="button" class="btn btn-outline btn-sm" id="nd-toggle"><i class="fa-solid ${n.active ? "fa-eye-slash" : "fa-eye"}"></i> ${n.active ? "Hide" : "Unhide"}</button>
        <button type="button" class="btn btn-danger btn-sm" id="nd-delete"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>
  `);

  overlay.querySelector("#nd-edit").addEventListener("click", () => { closeModal(); openNotificationModal(n.id); });
  overlay.querySelector("#nd-toggle").addEventListener("click", () => { closeModal(); toggleNotificationActive(n.id); });
  overlay.querySelector("#nd-delete").addEventListener("click", () => { closeModal(); deleteNotification(n.id); });
}

document.getElementById("add-notification-btn-top")?.addEventListener("click", () => openNotificationModal(null));

function openNotificationModal(notifId) {
  const n = notifId ? currentNotifications.find((x) => x.id === notifId) : null;
  const overlay = openModal(`
    <div class="modal-head"><h3>${n ? "Edit Notification" : "New Notification"}</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <form id="notif-modal-form">
      <div class="field"><label>Title</label><input type="text" id="nm-title" required placeholder="e.g. New lecture uploaded!" value="${n ? escapeHtml(n.title) : ""}"></div>
      <div class="field"><label>Message</label><textarea id="nm-message" rows="3" placeholder="What's this update about?" required>${n ? escapeHtml(n.message || "") : ""}</textarea></div>

      <div class="field">
        <label>Type (controls the icon shown to students)</label>
        <select id="nm-type">
          <option value="course_update" ${!n || n.type === "course_update" ? "selected" : ""}>Course Update (new video/content)</option>
          <option value="new_course" ${n?.type === "new_course" ? "selected" : ""}>New Course Launched</option>
          <option value="exam" ${n?.type === "exam" ? "selected" : ""}>Exam</option>
          <option value="announcement" ${n?.type === "announcement" ? "selected" : ""}>General Announcement</option>
        </select>
      </div>

      <div class="field">
        <label>Custom Link (optional) <span class="form-hint" style="display:inline;">— overrides the course below</span></label>
        <input type="text" id="nm-link" placeholder="https://... or any.html page, e.g. a WhatsApp group, YouTube video, PDF, form..." value="${n?.link ? escapeHtml(n.link) : ""}">
        <span class="form-hint" id="nm-link-hint">Leave empty to open the tagged course instead. A full "https://..." link opens in a new tab automatically; an internal page (e.g. "admin.html") opens in the app.</span>
      </div>

      <div class="field" id="nm-course-field">
        <label>Tag Course(s) <span class="form-hint" style="display:inline;">— tapping the notification opens the first tagged course</span></label>
        <div class="lesson-picker" id="nm-course-picker">
          ${courses
            .map(
              (c) => `
            <label class="lesson-picker-item">
              <input type="checkbox" value="${c.id}" data-title="${escapeHtml(c.title)}" ${n?.courseIds?.includes(c.id) ? "checked" : ""}>
              <span>${escapeHtml(c.title)}</span>
            </label>`
            )
            .join("")}
        </div>
        <span class="form-hint">Leave everything unchecked for a general, non-course announcement</span>
      </div>

      <div class="field">
        <label>Who Should See This</label>
        <select id="nm-audience">
          <option value="all" ${!n || n.audience === "all" ? "selected" : ""}>Everyone (all logged-in students)</option>
          <option value="enrolled" ${n?.audience === "enrolled" ? "selected" : ""}>Only students enrolled in the tagged course(s)</option>
        </select>
        <span class="form-hint" id="nm-audience-hint" hidden>Pick at least one course above to target only its students</span>
      </div>

      <div class="field">
        <label class="lesson-picker-item" style="padding:10px 12px;">
          <input type="checkbox" id="nm-pinned" ${n?.pinned ? "checked" : ""}>
          <span><i class="fa-solid fa-thumbtack"></i> Pin to top of the notification list</span>
        </label>
        <span class="form-hint">Use for anything urgent — it stays above newer notifications until unpinned</span>
      </div>

      <button type="submit" class="btn btn-primary btn-block mt-16" id="notif-modal-save-btn">${n ? "Save Changes" : "Send Notification"}</button>
    </form>
  `);

  const audienceSelect = overlay.querySelector("#nm-audience");
  const audienceHint = overlay.querySelector("#nm-audience-hint");
  const linkInput = overlay.querySelector("#nm-link");
  const courseField = overlay.querySelector("#nm-course-field");
  function checkedCourseIds() {
    return Array.from(overlay.querySelectorAll("#nm-course-picker input:checked")).map((el) => el.value);
  }
  function refreshAudienceHint() {
    audienceHint.hidden = !(audienceSelect.value === "enrolled" && checkedCourseIds().length === 0);
  }
  // When a custom link is set, course-tagging only still matters for the
  // "enrolled students only" audience filter — dim the section rather than
  // hiding it outright so that use case still stays reachable.
  function refreshLinkState() {
    courseField.style.opacity = linkInput.value.trim() ? "0.55" : "1";
  }
  audienceSelect.addEventListener("change", refreshAudienceHint);
  overlay.querySelector("#nm-course-picker").addEventListener("change", refreshAudienceHint);
  linkInput.addEventListener("input", refreshLinkState);
  refreshAudienceHint();
  refreshLinkState();

  overlay.querySelector("#notif-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector("#notif-modal-save-btn");
    const checked = Array.from(overlay.querySelectorAll("#nm-course-picker input:checked"));
    const courseIds = checked.map((el) => el.value);
    const courseTitles = checked.map((el) => el.dataset.title);
    let audience = audienceSelect.value;
    if (audience === "enrolled" && !courseIds.length) audience = "all"; // nothing to target — fall back safely

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    const payload = {
      title: overlay.querySelector("#nm-title").value.trim(),
      message: overlay.querySelector("#nm-message").value.trim(),
      type: overlay.querySelector("#nm-type").value,
      link: overlay.querySelector("#nm-link").value.trim(),
      courseIds,
      courseTitles,
      audience,
      pinned: overlay.querySelector("#nm-pinned").checked,
    };
    try {
      if (n) {
        await updateDoc(doc(db, "notifications", n.id), payload);
        toast("Notification updated", "success");
      } else {
        await addDoc(collection(db, "notifications"), {
          ...payload,
          active: true,
          createdAt: serverTimestamp(),
          createdBy: me?.user?.email || me?.user?.uid || "admin",
        });
        toast("Notification sent", "success");
      }
      closeModal();
      loadNotificationsList();
    } catch (err) {
      toast("Could not save — make sure the notifications Firestore rule from README.md is deployed", "error");
      btn.disabled = false;
      btn.textContent = n ? "Save Changes" : "Send Notification";
    }
  });
}

async function toggleNotificationActive(id) {
  const n = currentNotifications.find((x) => x.id === id);
  if (!n) return;
  try {
    await updateDoc(doc(db, "notifications", id), { active: !n.active });
    loadNotificationsList();
  } catch {
    toast("Could not update", "error");
  }
}

async function deleteNotification(id) {
  if (!(await confirmAction("Delete this notification? Students will no longer see it."))) return;
  try {
    await deleteDoc(doc(db, "notifications", id));
    toast("Notification deleted", "success");
    loadNotificationsList();
  } catch {
    toast("Could not delete", "error");
  }
}

