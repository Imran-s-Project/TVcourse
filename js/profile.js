// ==========================================================================
// profile.js — Profile, my courses, purchase history, results, settings, account security
// Exported as initProfilePage() for the SPA router (app.js). Previously ran
// automatically as this page's own top-level script when profile.html was a
// standalone file; now the router calls it once, after js/page-profile.js's
// markup has been mounted into index.html.
// ==========================================================================
import { auth, db, storage } from "./firebase-config.js";
import {
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  GoogleAuthProvider,
  updatePassword,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { requireAuth, getUserProfile, toast, escapeHtml, toBnDigits, formatDate, confirmAction, openModal, closeModal } from "./utils.js";

let currentUser = null;
let profile = null;
let allCourses = [];
let allResults = [];

// ── Public entry point — called once by app.js on the first #/profile visit ────
export async function initProfilePage() {
  await init();
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  profile = await getUserProfile(currentUser.uid);
  renderHeader();
  bindTabs();
  loadMyCourses();
  loadPurchases();
  loadResults();
  bindSettingsForm();
  bindPasswordForm();
  bindDeleteAccount();
  if (profile?.isAdmin) {
    document.getElementById("admin-shortcut-btn")?.classList.remove("hidden");
  }
}

function renderHeader() {
  document.getElementById("profile-name").textContent = profile?.displayName || currentUser.email.split("@")[0];
  document.getElementById("profile-email").textContent = currentUser.email;
  const avatarBox = document.getElementById("profile-avatar");
  avatarBox.innerHTML = profile?.photoURL
    ? `<img src="${profile.photoURL}" alt="Profile picture">`
    : `<span>${(profile?.displayName || currentUser.email).charAt(0).toUpperCase()}</span>`;
  document.getElementById("settings-name").value = profile?.displayName || "";

  const metaBox = document.getElementById("profile-meta");
  const joined = profile?.createdAt ? formatDate(profile.createdAt) : "";
  const provider = currentUser.providerData?.[0]?.providerId === "google.com" ? "Google Account" : "Email Account";
  metaBox.innerHTML = `
    ${joined ? `<span><i class="fa-regular fa-calendar"></i> Joined ${joined}</span>` : ""}
    <span><i class="fa-solid fa-user-shield"></i> ${provider}</span>
    ${profile?.isAdmin ? `<span class="badge badge-amber">Admin</span>` : ""}
  `;
}

/* ---------- Quick stats strip ---------- */
function renderStats() {
  const box = document.getElementById("profile-stats");
  const enrolledCount = (profile?.enrolledCourses || []).length;
  const examCount = allResults.length;
  const avgScore = examCount
    ? Math.round((allResults.reduce((sum, r) => sum + (r.total ? r.score / r.total : 0), 0) / examCount) * 100)
    : 0;
  box.innerHTML = `
    <div class="stat-card card">
      <i class="fa-solid fa-book-open"></i>
      <div><b>${enrolledCount}</b><span>Enrolled Courses</span></div>
    </div>
    <div class="stat-card card">
      <i class="fa-solid fa-file-pen"></i>
      <div><b>${examCount}</b><span>Exams Taken</span></div>
    </div>
    <div class="stat-card card">
      <i class="fa-solid fa-chart-line"></i>
      <div><b>${avgScore}%</b><span>Average Score</span></div>
    </div>
  `;
}

/* ---------- Tab switching ---------- */
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.remove("hidden");
    });
  });
}

// Lets the router (app.js) force a specific tab open — used by the navbar's
// "My Courses" link (index.html#/profile?tab=courses) so it always lands on
// that tab even if the user was previously viewing a different one.
export function activateTab(tabKey) {
  if (!tabKey) return;
  const btn = document.querySelector(`.tab-btn[data-tab="tab-${tabKey}"]`);
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  btn.classList.add("active");
  document.getElementById(btn.dataset.tab)?.classList.remove("hidden");
}

/* ---------- My courses ---------- */
async function loadMyCourses() {
  const wrap = document.getElementById("my-courses-list");
  const enrolled = profile?.enrolledCourses || [];
  if (!enrolled.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-book-open"></i></div><p>Not enrolled in any courses yet</p></div>`;
    return;
  }
  const snap = await getDocs(collection(db, "courses"));
  allCourses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const mine = allCourses.filter((c) => enrolled.includes(c.id));
  wrap.innerHTML = mine
    .map((c) => {
      const doneMap = profile?.progress?.[c.id] || {};
      const doneCount = Object.values(doneMap).filter(Boolean).length;
      const pct = c.lessonCount ? Math.round((doneCount / c.lessonCount) * 100) : 0;
      return `
      <a href="index.html#/course?id=${c.id}" class="my-course-row card">
        <img src="${c.coverImage || ""}" alt="">
        <div class="info">
          <h4>${escapeHtml(c.title)}</h4>
          <div class="progress-track" style="background:var(--bg-elevated-2)"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
        <span class="badge badge-amber">${pct}%</span>
      </a>`;
    })
    .join("");
}

/* ---------- Exam results ---------- */
async function loadResults() {
  const wrap = document.getElementById("results-list");
  wrap.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "results"), where("uid", "==", currentUser.uid)));
    allResults = snap.docs.map((d) => d.data()).sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    renderStats();
    if (!allResults.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams taken yet</p></div>`;
      return;
    }
    wrap.innerHTML = allResults
      .map(
        (r) => `
      <div class="result-row card">
        <div>
          <h4>${escapeHtml(r.examTitle || "Exam")}</h4>
          <span class="muted" style="font-size:0.82rem">${formatDate(r.submittedAt)}</span>
        </div>
        <div class="score">${r.score}/${r.total}</div>
      </div>`
      )
      .join("");
  } catch {
    wrap.innerHTML = `<div class="empty-state"><p>Could not load results</p></div>`;
    renderStats();
  }
}

/* ---------- Purchase history (all purchaseRequests together) ---------- */
async function loadPurchases() {
  const wrap = document.getElementById("purchases-list");
  wrap.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "purchaseRequests"), where("uid", "==", currentUser.uid)));
    const purchases = snap.docs.map((d) => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (!purchases.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-receipt"></i></div><p>No course purchase requests made yet</p></div>`;
      return;
    }
    const statusInfo = (s) =>
      s === "approved" ? { label: "Approved", cls: "badge-teal", icon: "fa-circle-check" } :
      s === "rejected" ? { label: "Rejected", cls: "badge-coral", icon: "fa-circle-xmark" } :
      { label: "Under Review", cls: "badge-amber", icon: "fa-clock" };
    wrap.innerHTML = purchases
      .map((p) => {
        const s = statusInfo(p.status);
        return `
      <div class="purchase-row card">
        <div class="info">
          <h4>${escapeHtml(p.courseTitle || "")}</h4>
          <span class="muted" style="font-size:0.82rem">${escapeHtml(p.paymentMethod || "")} · ৳${p.amount || 0} ${p.createdAt ? "· " + formatDate(p.createdAt) : ""}</span>
        </div>
        <span class="badge ${s.cls}"><i class="fa-solid ${s.icon}"></i> ${s.label}</span>
      </div>`;
      })
      .join("");
  } catch {
    wrap.innerHTML = `<div class="empty-state"><p>Could not load purchase information</p></div>`;
  }
}

/* ---------- Settings: name and profile picture ---------- */
function bindSettingsForm() {
  document.getElementById("settings-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("settings-name").value.trim();
    const fileInput = document.getElementById("settings-avatar");
    const btn = document.getElementById("settings-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      let photoURL = profile?.photoURL || "";
      if (fileInput.files[0]) {
        const fileRef = ref(storage, `avatars/${currentUser.uid}`);
        await uploadBytes(fileRef, fileInput.files[0]);
        photoURL = await getDownloadURL(fileRef);
      }
      await updateDoc(doc(db, "users", currentUser.uid), { displayName: name, photoURL });
      await updateProfile(currentUser, { displayName: name, photoURL });
      profile.displayName = name;
      profile.photoURL = photoURL;
      renderHeader();
      toast("Profile updated", "success");
    } catch (err) {
      toast("Could not update", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
}

/* ---------- Re-authenticate before sensitive actions (Firebase security requirement) ----------
   For a password account, re-verify with the current password; for a Google account, via a Google popup */
async function reauthenticate({ passwordFromForm } = {}) {
  const isGoogle = currentUser.providerData?.[0]?.providerId === "google.com";
  if (isGoogle) {
    await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
    return;
  }
  const password = passwordFromForm || (await askPasswordModal());
  if (!password) throw new Error("password-cancelled");
  const cred = EmailAuthProvider.credential(currentUser.email, password);
  await reauthenticateWithCredential(currentUser, cred);
}

/* ---------- Custom password-request box before delete (not the native prompt()) ---------- */
function askPasswordModal() {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <div class="modal-head"><h3>Confirmation Required</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
      <p class="muted" style="font-size:0.9rem;margin-bottom:14px;">For security, please enter your current password</p>
      <form id="reauth-form">
        <div class="field"><label>Password</label><input type="password" id="reauth-password" required autocomplete="current-password"></div>
        <button type="submit" class="btn btn-primary btn-block">Confirm</button>
      </form>
    `, { onClose: () => resolve(null) });
    overlay.querySelector("#reauth-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const val = overlay.querySelector("#reauth-password").value;
      overlay._onClose = null;
      closeModal();
      resolve(val);
    });
  });
}

/* ---------- Change password ---------- */
function bindPasswordForm() {
  const form = document.getElementById("password-form");
  const isGoogle = currentUser.providerData?.[0]?.providerId === "google.com";
  if (isGoogle) {
    form.innerHTML = `
      <h3 class="panel-title"><i class="fa-solid fa-key"></i> Change Password</h3>
      <p class="muted panel-desc">You signed in with Google — there's no need to change this account's password from Tech Verse Course, it's controlled by your Google account.</p>`;
    return;
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("password-error");
    const btn = document.getElementById("password-save-btn");
    errorEl.textContent = "";
    const current = document.getElementById("current-password").value;
    const next = document.getElementById("new-password").value;
    const confirm = document.getElementById("confirm-password").value;
    if (next !== confirm) {
      errorEl.textContent = "The new passwords don't match";
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await reauthenticate({ passwordFromForm: current });
      await updatePassword(currentUser, next);
      toast("Password changed", "success");
      form.reset();
    } catch (err) {
      errorEl.textContent = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
        ? "Current password is incorrect"
        : "Could not change password, please try again";
    } finally {
      btn.disabled = false;
      btn.textContent = "Update Password";
    }
  });
}

/* ---------- Permanently delete account ---------- */
function bindDeleteAccount() {
  document.getElementById("delete-account-btn")?.addEventListener("click", async () => {
    const ok = await confirmAction(
      "Your account, profile picture, and login information will be permanently deleted. This action cannot be undone. Are you sure?",
      { title: "Delete Account?", confirmLabel: "Yes, Delete", danger: true }
    );
    if (!ok) return;
    try {
      await reauthenticate();
      await deleteObject(ref(storage, `avatars/${currentUser.uid}`)).catch(() => {});
      await deleteDoc(doc(db, "users", currentUser.uid)).catch(() => {});
      await deleteUser(currentUser);
      toast("Your account has been deleted", "success");
      setTimeout(() => (window.location.href = "index.html"), 800);
    } catch (err) {
      if (err.message === "password-cancelled") return;
      toast("Could not delete account, please try again", "error");
    }
  });
}

