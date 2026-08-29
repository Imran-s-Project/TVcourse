// ==========================================================================
// discussion.js — Thread-based discussion/Q&A for the Learning Hub
// Separate from the per-lesson comment wall in engagement.js: this is for
// broader questions/discussion tied to a course (or general), with replies,
// not a reaction-driven comment feed under one video.
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, getDoc, doc, updateDoc, query, orderBy, limit,
  where, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  escapeHtml, toast, timeAgo, openModal, closeModal, getUserProfile,
} from "./utils.js";

let cachedCourses = null;
async function getCourses() {
  if (cachedCourses) return cachedCourses;
  const snap = await getDocs(collection(db, "courses"));
  cachedCourses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cachedCourses;
}

function initials(name = "") {
  return `<span>${(name || "U").charAt(0).toUpperCase()}</span>`;
}

function threadCardHtml(t) {
  return `
    <button type="button" class="discussion-thread-card" data-id="${t.id}">
      <div class="discussion-thread-avatar">${t.avatarURL ? `<img src="${t.avatarURL}" alt="">` : initials(t.name)}</div>
      <div class="discussion-thread-main">
        <div class="discussion-thread-top">
          <span class="discussion-thread-title">${escapeHtml(t.title)}</span>
          ${t.courseTitle ? `<span class="badge badge-teal">${escapeHtml(t.courseTitle)}</span>` : `<span class="badge">General</span>`}
        </div>
        <div class="discussion-thread-preview">${escapeHtml((t.body || "").slice(0, 110))}${t.body?.length > 110 ? "…" : ""}</div>
        <div class="discussion-thread-meta">
          <span>${escapeHtml(t.name || "User")}</span>
          <span>•</span>
          <span>${t.lastActivityAt ? timeAgo(t.lastActivityAt) : ""}</span>
          <span>•</span>
          <span><i class="fa-solid fa-reply"></i> ${t.replyCount || 0} replies</span>
        </div>
      </div>
    </button>`;
}

export async function renderDiscussionTab(container, user, profile) {
  container.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;

  const [courses, threadsSnap] = await Promise.all([
    getCourses(),
    getDocs(query(collection(db, "discussions"), orderBy("lastActivityAt", "desc"), limit(40))).catch(() => ({ docs: [] })),
  ]);
  const enrolledCourses = courses.filter((c) => (profile?.enrolledCourses || []).includes(c.id));
  const threads = threadsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const filterOptionsHtml = `<option value="">All Topics</option>` +
    enrolledCourses.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("") +
    `<option value="__general">General</option>`;

  container.innerHTML = `
    <div class="discussion-toolbar">
      <select id="discussion-filter" class="discussion-filter-select">${filterOptionsHtml}</select>
      <button type="button" class="btn btn-primary" id="discussion-new-btn"><i class="fa-solid fa-plus"></i> New Thread</button>
    </div>
    <div id="discussion-list" class="discussion-list">
      ${threads.length ? threads.map(threadCardHtml).join("") : `<p class="muted" style="padding:20px 0">No discussions yet — be the first to start one!</p>`}
    </div>
  `;

  const listEl = document.getElementById("discussion-list");
  listEl.addEventListener("click", (e) => {
    const card = e.target.closest(".discussion-thread-card");
    if (card) openThreadDetail(card.dataset.id, user, profile);
  });

  document.getElementById("discussion-filter")?.addEventListener("change", (e) => {
    const val = e.target.value;
    const filtered = !val
      ? threads
      : val === "__general"
        ? threads.filter((t) => !t.courseId)
        : threads.filter((t) => t.courseId === val);
    listEl.innerHTML = filtered.length
      ? filtered.map(threadCardHtml).join("")
      : `<p class="muted" style="padding:20px 0">No discussions in this topic yet.</p>`;
  });

  document.getElementById("discussion-new-btn")?.addEventListener("click", () => openNewThreadModal(user, profile, enrolledCourses));
}

function openNewThreadModal(user, profile, enrolledCourses) {
  const courseOptionsHtml = `<option value="">General (no specific course)</option>` +
    enrolledCourses.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("");

  openModal(`
    <h3 class="panel-title"><i class="fa-solid fa-comments"></i> Start a Discussion</h3>
    <form id="new-thread-form">
      <div class="field">
        <label for="thread-course">Topic</label>
        <select id="thread-course">${courseOptionsHtml}</select>
      </div>
      <div class="field">
        <label for="thread-title">Title</label>
        <input type="text" id="thread-title" required maxlength="120" placeholder="What's your question or topic?">
      </div>
      <div class="field">
        <label for="thread-body">Details</label>
        <textarea id="thread-body" rows="4" required maxlength="2000" placeholder="Add more context so others can help..."></textarea>
      </div>
      <div class="form-error" id="thread-error"></div>
      <button type="submit" class="btn btn-primary btn-block" id="thread-submit-btn">Post Discussion</button>
    </form>
  `);

  document.getElementById("new-thread-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("thread-submit-btn");
    const errEl = document.getElementById("thread-error");
    const courseId = document.getElementById("thread-course").value || null;
    const courseTitle = courseId ? enrolledCourses.find((c) => c.id === courseId)?.title || "" : "";
    const title = document.getElementById("thread-title").value.trim();
    const body = document.getElementById("thread-body").value.trim();
    if (!title || !body) return;

    btn.disabled = true;
    btn.textContent = "Posting...";
    try {
      await addDoc(collection(db, "discussions"), {
        uid: user.uid,
        name: profile?.displayName || user.email?.split("@")[0] || "User",
        avatarURL: profile?.photoURL || "",
        courseId, courseTitle,
        title, body,
        replyCount: 0,
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
      });
      await bumpDiscussionCount(user.uid, profile);
      closeModal();
      toast("Discussion posted!", "success");
      const container = document.getElementById("hub-tab-discussion");
      if (container) renderDiscussionTab(container, user, profile);
    } catch (err) {
      errEl.textContent = err.message || "Something went wrong — please try again.";
      btn.disabled = false;
      btn.textContent = "Post Discussion";
    }
  });
}

async function openThreadDetail(threadId, user, profile) {
  openModal(`<div class="loading-screen"><span class="spinner"></span></div>`);
  const [threadSnap, repliesSnap] = await Promise.all([
    getDoc(doc(db, "discussions", threadId)),
    getDocs(query(collection(db, "discussions", threadId, "replies"), orderBy("createdAt", "asc"))).catch(() => ({ docs: [] })),
  ]);
  if (!threadSnap.exists()) { closeModal(); toast("This discussion no longer exists.", "error"); return; }
  const t = threadSnap.data();
  const replies = repliesSnap.docs.map((d) => d.data());

  const repliesHtml = replies.length
    ? replies.map((r) => `
        <div class="discussion-reply">
          <div class="discussion-thread-avatar sm">${r.avatarURL ? `<img src="${r.avatarURL}" alt="">` : initials(r.name)}</div>
          <div>
            <div class="discussion-reply-head"><b>${escapeHtml(r.name || "User")}</b><span class="muted">${r.createdAt ? timeAgo(r.createdAt) : ""}</span></div>
            <div class="discussion-reply-body">${escapeHtml(r.body)}</div>
          </div>
        </div>`).join("")
    : `<p class="muted" style="padding:8px 0">No replies yet — add the first one.</p>`;

  openModal(`
    <div class="discussion-detail-head">
      ${t.courseTitle ? `<span class="badge badge-teal">${escapeHtml(t.courseTitle)}</span>` : `<span class="badge">General</span>`}
      <h3 class="panel-title" style="margin-top:8px">${escapeHtml(t.title)}</h3>
      <div class="discussion-thread-meta"><span>${escapeHtml(t.name || "User")}</span><span>•</span><span>${t.createdAt ? timeAgo(t.createdAt) : ""}</span></div>
      <p style="margin-top:10px">${escapeHtml(t.body)}</p>
    </div>
    <div class="discussion-replies" id="discussion-replies-list">${repliesHtml}</div>
    <form id="reply-form" class="discussion-reply-form">
      <textarea id="reply-body" rows="2" required maxlength="1000" placeholder="Write a reply..."></textarea>
      <button type="submit" class="btn btn-primary" id="reply-submit-btn"><i class="fa-solid fa-paper-plane"></i></button>
    </form>
  `);

  document.getElementById("reply-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const textEl = document.getElementById("reply-body");
    const body = textEl.value.trim();
    if (!body) return;
    const btn = document.getElementById("reply-submit-btn");
    btn.disabled = true;
    try {
      await addDoc(collection(db, "discussions", threadId, "replies"), {
        uid: user.uid,
        name: profile?.displayName || user.email?.split("@")[0] || "User",
        avatarURL: profile?.photoURL || "",
        body,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "discussions", threadId), {
        replyCount: increment(1),
        lastActivityAt: serverTimestamp(),
      });
      await bumpDiscussionCount(user.uid, profile);
      openThreadDetail(threadId, user, profile); // re-render with the new reply
    } catch {
      toast("Couldn't post your reply — please try again.", "error");
      btn.disabled = false;
    }
  });
}

async function bumpDiscussionCount(uid, profile) {
  try {
    await updateDoc(doc(db, "users", uid), { discussionPostCount: increment(1) });
    const { computeAndSyncBadges } = await import("./badges.js");
    await computeAndSyncBadges(uid, { ...(profile || {}), discussionPostCount: (profile?.discussionPostCount || 0) + 1 });
  } catch { /* badge sync is best-effort */ }
}
