// ==========================================================================
// discussion.js — Thread-based discussion/Q&A for the Learning Hub, styled
// as a proper post feed (composer prompt + post cards + comment thread).
// Facebook-style interaction model: like, edit, delete (own post/reply,
// admin can moderate any), pagination ("Load more"), and search — while
// staying deliberately flat/strong — no gradients, glows, or blur-shadows;
// see the "Discussion" block in css/hub.css for the design rationale.
//
// Firestore note: liking/replying updates fields on documents the current
// user does not own (likedBy, replyCount, lastActivityAt on someone else's
// post). Make sure the Firestore rules for "discussions" and its "replies"
// subcollection allow an authenticated user to update those specific
// fields on any document, not just documents they created — otherwise
// likes/replies from other users will fail with permission-denied.
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, getDoc, doc, updateDoc, deleteDoc, query,
  orderBy, limit, startAfter, where, serverTimestamp, increment,
  arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  escapeHtml, toast, timeAgo, openModal, closeModal, getUserProfile, confirmAction,
} from "./utils.js";

const PAGE_SIZE = 15;

let cachedCourses = null;
async function getCourses() {
  if (cachedCourses) return cachedCourses;
  const snap = await getDocs(collection(db, "courses"));
  cachedCourses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cachedCourses;
}

function avatarHtml(name, url, extraClass = "") {
  const initial = (name || "U").charAt(0).toUpperCase();
  return `<div class="dsc-avatar ${extraClass}">${url ? `<img src="${url}" alt="">` : `<span>${initial}</span>`}</div>`;
}

function topicTagHtml(t) {
  return t.courseTitle ? `<span class="badge badge-teal">${escapeHtml(t.courseTitle)}</span>` : `<span class="badge">General</span>`;
}

function editedTagHtml(item) {
  return item.editedAt ? `<span class="dsc-edited-tag">(edited)</span>` : "";
}

/* Always render a solid heart; "liked" state is a color toggle, not an
   icon-style swap, so it never depends on a regular-weight icon set being
   available. */
function likeButtonHtml(id, likedBy = [], uid, kind) {
  const liked = !!uid && likedBy.includes(uid);
  return `
    <button type="button" class="dsc-like-btn ${liked ? "is-liked" : ""}" data-action="like-${kind}" data-id="${id}">
      <i class="fa-solid fa-heart"></i>
      <span class="dsc-like-count">${likedBy.length}</span>
    </button>`;
}

function ownerActionsHtml(isOwner, isAdmin, kind, id) {
  if (!isOwner && !isAdmin) return "";
  return `
    <div class="dsc-owner-actions">
      ${isOwner ? `<button type="button" class="dsc-icon-btn" data-action="edit-${kind}" data-id="${id}" title="Edit"><i class="fa-solid fa-pen"></i></button>` : ""}
      <button type="button" class="dsc-icon-btn dsc-icon-btn--danger" data-action="delete-${kind}" data-id="${id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

/* ---------- One post card in the feed ---------- */
function postCardHtml(t, uid) {
  const preview = (t.body || "").trim();
  return `
    <div class="dsc-post-card" data-id="${t.id}" role="button" tabindex="0">
      <div class="dsc-post-head">
        ${avatarHtml(t.name, t.avatarURL)}
        <div class="dsc-post-headtext">
          <div class="dsc-post-name-row">
            <span class="dsc-post-name">${escapeHtml(t.name || "User")}</span>
            <span class="dsc-post-dot">•</span>
            <span class="dsc-post-time">${t.lastActivityAt ? timeAgo(t.lastActivityAt) : ""}</span>
            ${editedTagHtml(t)}
          </div>
          ${topicTagHtml(t)}
        </div>
      </div>
      <div class="dsc-post-title">${escapeHtml(t.title)}</div>
      <div class="dsc-post-body">${escapeHtml(preview)}</div>
      <div class="dsc-post-foot">
        <div class="dsc-post-foot-left">
          ${likeButtonHtml(t.id, t.likedBy || [], uid, "post")}
          <span class="dsc-post-stat"><i class="fa-solid fa-comment"></i> ${t.replyCount || 0} ${t.replyCount === 1 ? "reply" : "replies"}</span>
        </div>
        <span class="dsc-post-open">View discussion <i class="fa-solid fa-arrow-right"></i></span>
      </div>
    </div>`;
}

export async function renderDiscussionTab(container, user, profile) {
  container.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;

  const [courses, threadsSnap] = await Promise.all([
    getCourses(),
    getDocs(query(collection(db, "discussions"), orderBy("lastActivityAt", "desc"), limit(PAGE_SIZE))).catch(() => ({ docs: [] })),
  ]);
  const enrolledCourses = courses.filter((c) => (profile?.enrolledCourses || []).includes(c.id));
  const threads = threadsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let lastDocSnap = threadsSnap.docs.length ? threadsSnap.docs[threadsSnap.docs.length - 1] : null;
  let hasMore = threadsSnap.docs.length === PAGE_SIZE;
  let filterVal = "";
  let searchVal = "";

  const filterOptionsHtml = `<option value="">All Topics</option>` +
    enrolledCourses.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("") +
    `<option value="__general">General</option>`;

  container.innerHTML = `
    <div class="discussion-shell">
      <button type="button" class="dsc-composer" id="discussion-new-btn">
        ${avatarHtml(profile?.displayName || user.email, profile?.photoURL)}
        <span class="dsc-composer-text">Start a discussion, ask a question…</span>
        <span class="dsc-composer-cta"><i class="fa-solid fa-pen"></i> Post</span>
      </button>

      <div class="dsc-toolbar">
        <span class="dsc-toolbar-label"><i class="fa-solid fa-filter"></i> Filter</span>
        <select id="discussion-filter" class="dsc-filter-select">${filterOptionsHtml}</select>
        <input type="text" id="discussion-search" class="dsc-search-input" placeholder="Search discussions..." maxlength="80">
      </div>

      <div id="discussion-list" class="dsc-feed"></div>
      <button type="button" class="dsc-btn dsc-btn--ghost dsc-btn--block dsc-load-more" id="discussion-load-more" style="display:none">Load more</button>
    </div>
  `;

  const listEl = document.getElementById("discussion-list");
  const loadMoreBtn = document.getElementById("discussion-load-more");

  function visibleThreads() {
    return threads.filter((t) => {
      const matchesFilter = !filterVal || (filterVal === "__general" ? !t.courseId : t.courseId === filterVal);
      const matchesSearch = !searchVal || (t.title || "").toLowerCase().includes(searchVal) || (t.body || "").toLowerCase().includes(searchVal);
      return matchesFilter && matchesSearch;
    });
  }

  function renderList() {
    const filtered = visibleThreads();
    listEl.innerHTML = filtered.length
      ? filtered.map((t) => postCardHtml(t, user.uid)).join("")
      : `<div class="dsc-empty"><i class="fa-solid fa-comments"></i><p>${threads.length ? "No discussions match your search." : "No discussions yet — be the first to start one!"}</p></div>`;
    loadMoreBtn.style.display = hasMore && !searchVal && !filterVal ? "block" : "none";
  }
  renderList();

  async function refreshFeed() {
    const fetchCount = Math.max(PAGE_SIZE, threads.length);
    const snap = await getDocs(query(collection(db, "discussions"), orderBy("lastActivityAt", "desc"), limit(fetchCount))).catch(() => null);
    if (!snap) return;
    threads.length = 0;
    threads.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    lastDocSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    hasMore = snap.docs.length === fetchCount;
    renderList();
  }

  listEl.addEventListener("click", (e) => {
    const likeBtn = e.target.closest(".dsc-like-btn");
    if (likeBtn) {
      e.stopPropagation();
      const t = threads.find((x) => x.id === likeBtn.dataset.id);
      if (t) toggleLike(doc(db, "discussions", t.id), user.uid, t.likedBy || (t.likedBy = []), likeBtn);
      return;
    }
    const card = e.target.closest(".dsc-post-card");
    if (card) openThreadDetail(card.dataset.id, user, profile, refreshFeed);
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".dsc-post-card");
    if (card) { e.preventDefault(); openThreadDetail(card.dataset.id, user, profile, refreshFeed); }
  });

  document.getElementById("discussion-filter")?.addEventListener("change", (e) => {
    filterVal = e.target.value;
    renderList();
  });
  document.getElementById("discussion-search")?.addEventListener("input", (e) => {
    searchVal = e.target.value.trim().toLowerCase();
    renderList();
  });

  loadMoreBtn.addEventListener("click", async () => {
    if (!lastDocSnap) return;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "Loading...";
    try {
      const snap = await getDocs(query(collection(db, "discussions"), orderBy("lastActivityAt", "desc"), startAfter(lastDocSnap), limit(PAGE_SIZE)));
      threads.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      lastDocSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : lastDocSnap;
      hasMore = snap.docs.length === PAGE_SIZE;
      renderList();
    } catch {
      toast("Couldn't load more discussions.", "error");
    } finally {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Load more";
    }
  });

  document.getElementById("discussion-new-btn")?.addEventListener("click", () => openNewThreadModal(user, profile, enrolledCourses, refreshFeed));
}

/* ---------- Generic like toggle — works for post docs and reply docs ---------- */
async function toggleLike(docRef, uid, likedByArr, btnEl) {
  const wasLiked = likedByArr.includes(uid);
  btnEl.disabled = true;
  try {
    await updateDoc(docRef, { likedBy: wasLiked ? arrayRemove(uid) : arrayUnion(uid) });
    if (wasLiked) {
      const idx = likedByArr.indexOf(uid);
      if (idx > -1) likedByArr.splice(idx, 1);
    } else {
      likedByArr.push(uid);
    }
    btnEl.classList.toggle("is-liked", !wasLiked);
    const countEl = btnEl.querySelector(".dsc-like-count");
    if (countEl) countEl.textContent = likedByArr.length;
  } catch {
    toast("Couldn't update — please try again.", "error");
  } finally {
    btnEl.disabled = false;
  }
}

function openNewThreadModal(user, profile, enrolledCourses, refreshFeed) {
  const courseOptionsHtml = `<option value="">General (no specific course)</option>` +
    enrolledCourses.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("");

  openModal(`
    <div class="dsc-modal">
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
          <div class="dsc-char-count" id="thread-body-count">0 / 2000</div>
        </div>
        <div class="form-error" id="thread-error"></div>
        <button type="submit" class="dsc-btn dsc-btn--primary dsc-btn--block" id="thread-submit-btn">Post Discussion</button>
      </form>
    </div>
  `);

  const bodyEl = document.getElementById("thread-body");
  const countEl = document.getElementById("thread-body-count");
  bodyEl?.addEventListener("input", () => { countEl.textContent = `${bodyEl.value.length} / 2000`; });

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
        likedBy: [],
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
      });
      await bumpDiscussionCount(user.uid, profile);
      closeModal();
      toast("Discussion posted!", "success");
      await refreshFeed();
    } catch (err) {
      errEl.textContent = err.message || "Something went wrong — please try again.";
      btn.disabled = false;
      btn.textContent = "Post Discussion";
    }
  });
}

async function openThreadDetail(threadId, user, profile, refreshFeed) {
  openModal(`<div class="loading-screen"><span class="spinner"></span></div>`);
  const [threadSnap, repliesSnap] = await Promise.all([
    getDoc(doc(db, "discussions", threadId)),
    getDocs(query(collection(db, "discussions", threadId, "replies"), orderBy("createdAt", "asc"))).catch(() => ({ docs: [] })),
  ]);
  if (!threadSnap.exists()) { closeModal(); toast("This discussion no longer exists.", "error"); return; }

  const isAdmin = !!profile?.isAdmin;
  const t = { id: threadId, ...threadSnap.data() };
  if (!t.likedBy) t.likedBy = [];
  const replies = repliesSnap.docs.map((d) => ({ id: d.id, ...d.data(), likedBy: d.data().likedBy || [] }));

  function renderPostBlock() {
    const isOwner = t.uid === user.uid;
    return `
      <div class="dsc-detail-head">
        ${avatarHtml(t.name, t.avatarURL)}
        <div class="dsc-post-headtext">
          <div class="dsc-post-name-row">
            <span class="dsc-post-name">${escapeHtml(t.name || "User")}</span>
            <span class="dsc-post-dot">•</span>
            <span class="dsc-post-time">${t.createdAt ? timeAgo(t.createdAt) : ""}</span>
            ${editedTagHtml(t)}
          </div>
          ${topicTagHtml(t)}
        </div>
        ${ownerActionsHtml(isOwner, isAdmin, "post", t.id)}
      </div>
      <h3 class="dsc-detail-title">${escapeHtml(t.title)}</h3>
      <p class="dsc-detail-body">${escapeHtml(t.body)}</p>
      <div class="dsc-detail-actions">${likeButtonHtml(t.id, t.likedBy, user.uid, "post")}</div>`;
  }

  function renderPostEditBlock() {
    return `
      <div class="dsc-edit-block">
        <input type="text" class="dsc-edit-title" id="post-edit-title" maxlength="120" value="${escapeHtml(t.title)}">
        <textarea class="dsc-edit-body" id="post-edit-body" rows="4" maxlength="2000">${escapeHtml(t.body)}</textarea>
        <div class="dsc-edit-actions">
          <button type="button" class="dsc-btn dsc-btn--ghost" data-action="cancel-edit-post">Cancel</button>
          <button type="button" class="dsc-btn dsc-btn--primary" data-action="save-edit-post">Save</button>
        </div>
      </div>`;
  }

  function replyHtml(r) {
    const isOwner = r.uid === user.uid;
    return `
      <div class="dsc-comment" data-reply-id="${r.id}">
        ${avatarHtml(r.name, r.avatarURL, "sm")}
        <div class="dsc-comment-body-wrap">
          <div class="dsc-comment-head">
            <b>${escapeHtml(r.name || "User")}</b><span class="dsc-post-dot">•</span><span class="dsc-post-time">${r.createdAt ? timeAgo(r.createdAt) : ""}</span>${editedTagHtml(r)}
            ${ownerActionsHtml(isOwner, isAdmin, "reply", r.id)}
          </div>
          <div class="dsc-comment-body-row">
            <div class="dsc-comment-body">${escapeHtml(r.body)}</div>
          </div>
          ${likeButtonHtml(r.id, r.likedBy, user.uid, "reply")}
        </div>
      </div>`;
  }

  function replyEditHtml(r) {
    return `
      <div class="dsc-edit-block dsc-edit-block--reply">
        <textarea class="dsc-edit-body" id="reply-edit-body-${r.id}" rows="2" maxlength="1000">${escapeHtml(r.body)}</textarea>
        <div class="dsc-edit-actions">
          <button type="button" class="dsc-btn dsc-btn--ghost" data-action="cancel-edit-reply" data-id="${r.id}">Cancel</button>
          <button type="button" class="dsc-btn dsc-btn--primary" data-action="save-edit-reply" data-id="${r.id}">Save</button>
        </div>
      </div>`;
  }

  function renderReplies() {
    document.getElementById("dsc-replies-count").textContent = `${replies.length} ${replies.length === 1 ? "Reply" : "Replies"}`;
    const listWrap = document.getElementById("discussion-replies-list");
    listWrap.innerHTML = replies.length
      ? replies.map(replyHtml).join("")
      : `<p class="muted" style="padding:8px 0">No replies yet — add the first one.</p>`;
  }

  openModal(`
    <div class="dsc-modal">
      <div id="dsc-post-block">${renderPostBlock()}</div>

      <div class="dsc-divider"><i class="fa-solid fa-comment"></i> <span id="dsc-replies-count">${replies.length} ${replies.length === 1 ? "Reply" : "Replies"}</span></div>
      <div class="dsc-comments" id="discussion-replies-list">${replies.length ? replies.map(replyHtml).join("") : `<p class="muted" style="padding:8px 0">No replies yet — add the first one.</p>`}</div>

      <form id="reply-form" class="dsc-reply-form">
        <textarea id="reply-body" rows="2" required maxlength="1000" placeholder="Write a reply..."></textarea>
        <button type="submit" class="dsc-btn dsc-btn--primary dsc-btn--icon" id="reply-submit-btn"><i class="fa-solid fa-paper-plane"></i></button>
      </form>
    </div>
  `);

  const modalBox = document.querySelector(".modal-box");

  modalBox?.addEventListener("click", async (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    /* ---- Post like ---- */
    if (action === "like-post") {
      toggleLike(doc(db, "discussions", t.id), user.uid, t.likedBy, actionEl);
      return;
    }
    /* ---- Reply like ---- */
    if (action === "like-reply") {
      const r = replies.find((x) => x.id === id);
      if (r) toggleLike(doc(db, "discussions", t.id, "replies", id), user.uid, r.likedBy, actionEl);
      return;
    }
    /* ---- Edit post ---- */
    if (action === "edit-post") {
      document.getElementById("dsc-post-block").innerHTML = renderPostEditBlock();
      return;
    }
    if (action === "cancel-edit-post") {
      document.getElementById("dsc-post-block").innerHTML = renderPostBlock();
      return;
    }
    if (action === "save-edit-post") {
      const newTitle = document.getElementById("post-edit-title").value.trim();
      const newBody = document.getElementById("post-edit-body").value.trim();
      if (!newTitle || !newBody) { toast("Title and details can't be empty.", "error"); return; }
      actionEl.disabled = true;
      try {
        await updateDoc(doc(db, "discussions", t.id), { title: newTitle, body: newBody, editedAt: serverTimestamp() });
        t.title = newTitle; t.body = newBody; t.editedAt = true;
        document.getElementById("dsc-post-block").innerHTML = renderPostBlock();
        await refreshFeed();
        toast("Discussion updated.", "success");
      } catch {
        toast("Couldn't save changes — please try again.", "error");
        actionEl.disabled = false;
      }
      return;
    }
    /* ---- Delete post ---- */
    if (action === "delete-post") {
      const ok = await confirmAction("Delete this discussion and all its replies? This can't be undone.", { title: "Delete Discussion", confirmLabel: "Delete" });
      if (!ok) return;
      try {
        const repliesRefSnap = await getDocs(collection(db, "discussions", t.id, "replies"));
        await Promise.all(repliesRefSnap.docs.map((rd) => deleteDoc(rd.ref)));
        await deleteDoc(doc(db, "discussions", t.id));
        closeModal();
        toast("Discussion deleted.", "success");
        await refreshFeed();
      } catch {
        toast("Couldn't delete this discussion — please try again.", "error");
      }
      return;
    }
    /* ---- Edit reply ---- */
    if (action === "edit-reply") {
      const wrap = document.querySelector(`[data-reply-id="${id}"] .dsc-comment-body-row`);
      const r = replies.find((x) => x.id === id);
      if (wrap && r) wrap.innerHTML = replyEditHtml(r);
      return;
    }
    if (action === "cancel-edit-reply") {
      const wrap = document.querySelector(`[data-reply-id="${id}"] .dsc-comment-body-row`);
      const r = replies.find((x) => x.id === id);
      if (wrap && r) wrap.innerHTML = `<div class="dsc-comment-body">${escapeHtml(r.body)}</div>`;
      return;
    }
    if (action === "save-edit-reply") {
      const r = replies.find((x) => x.id === id);
      const newBody = document.getElementById(`reply-edit-body-${id}`).value.trim();
      if (!r || !newBody) { toast("Reply can't be empty.", "error"); return; }
      actionEl.disabled = true;
      try {
        await updateDoc(doc(db, "discussions", t.id, "replies", id), { body: newBody, editedAt: serverTimestamp() });
        r.body = newBody; r.editedAt = true;
        renderReplies();
        toast("Reply updated.", "success");
      } catch {
        toast("Couldn't save changes — please try again.", "error");
        actionEl.disabled = false;
      }
      return;
    }
    /* ---- Delete reply ---- */
    if (action === "delete-reply") {
      const ok = await confirmAction("Delete this reply? This can't be undone.", { title: "Delete Reply", confirmLabel: "Delete" });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "discussions", t.id, "replies", id));
        await updateDoc(doc(db, "discussions", t.id), { replyCount: increment(-1) });
        const idx = replies.findIndex((x) => x.id === id);
        if (idx > -1) replies.splice(idx, 1);
        t.replyCount = Math.max(0, (t.replyCount || 1) - 1);
        renderReplies();
        toast("Reply deleted.", "success");
      } catch {
        toast("Couldn't delete this reply — please try again.", "error");
      }
      return;
    }
  });

  document.getElementById("reply-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const textEl = document.getElementById("reply-body");
    const body = textEl.value.trim();
    if (!body) return;
    const btn = document.getElementById("reply-submit-btn");
    btn.disabled = true;
    try {
      const replyRef = await addDoc(collection(db, "discussions", t.id, "replies"), {
        uid: user.uid,
        name: profile?.displayName || user.email?.split("@")[0] || "User",
        avatarURL: profile?.photoURL || "",
        body,
        likedBy: [],
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "discussions", t.id), {
        replyCount: increment(1),
        lastActivityAt: serverTimestamp(),
      });
      await bumpDiscussionCount(user.uid, profile);
      replies.push({ id: replyRef.id, uid: user.uid, name: profile?.displayName || user.email?.split("@")[0] || "User", avatarURL: profile?.photoURL || "", body, likedBy: [], createdAt: { toDate: () => new Date() } });
      t.replyCount = (t.replyCount || 0) + 1;
      renderReplies();
      textEl.value = "";
      document.getElementById("discussion-replies-list").scrollTop = document.getElementById("discussion-replies-list").scrollHeight;
      refreshFeed();
    } catch {
      toast("Couldn't post your reply — please try again.", "error");
    } finally {
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
