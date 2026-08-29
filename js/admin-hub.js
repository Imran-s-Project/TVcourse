// ==========================================================================
// admin-hub.js — Admin-side management for the Learning Hub:
//   • Flashcards: create/edit/delete spaced-repetition cards per course
//   • Discussion: moderate (view/delete) student-posted threads
// Imported into admin.js and wired into its sidebar section switcher.
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, orderBy, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { escapeHtml, toast, timeAgo, openModal, closeModal, confirmAction } from "./utils.js";

let cardsCache = [];

/* ---------- Flashcards ---------- */
export async function initFlashcardsSection(courses) {
  const filterSel = document.getElementById("fc-course-filter");
  if (filterSel && filterSel.options.length <= 1) {
    filterSel.innerHTML = `<option value="">All Cards</option><option value="__general">General</option>` +
      courses.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("");
    filterSel.addEventListener("change", () => renderFlashcardsList(filterSel.value));
  }
  document.getElementById("add-flashcard-btn-top")?.addEventListener("click", () => openFlashcardModal(null, courses), { once: false });
  await loadFlashcards();
  renderFlashcardsList(filterSel?.value || "");
}

async function loadFlashcards() {
  const snap = await getDocs(collection(db, "flashcards")).catch(() => ({ docs: [] }));
  cardsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderFlashcardsList(filter) {
  const wrap = document.getElementById("flashcards-list");
  if (!wrap) return;
  const list = !filter
    ? cardsCache
    : filter === "__general"
      ? cardsCache.filter((c) => !c.courseId)
      : cardsCache.filter((c) => c.courseId === filter);

  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-clone"></i></div><p>No flashcards yet — add your first one</p></div>`;
    return;
  }
  wrap.innerHTML = `<div class="admin-notif-list">${list.map((c) => `
    <button type="button" class="admin-notif-row" data-id="${c.id}">
      <div class="admin-notif-row-icon"><i class="fa-solid fa-clone"></i></div>
      <div class="admin-notif-row-main">
        <div class="admin-notif-row-title">${escapeHtml((c.front || "").slice(0, 70))}</div>
        <div class="admin-notif-row-meta">
          <span>${c.courseTitle ? escapeHtml(c.courseTitle) : "General"}</span>
        </div>
      </div>
      <i class="fa-solid fa-chevron-right admin-notif-row-chevron"></i>
    </button>`).join("")}</div>`;

  wrap.querySelectorAll(".admin-notif-row").forEach((row) => {
    row.addEventListener("click", () => {
      const card = cardsCache.find((c) => c.id === row.dataset.id);
      if (card) openFlashcardModal(card, window.__tvCourses || []);
    });
  });
}

function openFlashcardModal(card, courses) {
  window.__tvCourses = courses; // small cache so edit-clicks work without re-passing courses everywhere
  const overlay = openModal(`
    <div class="modal-head"><h3>${card ? "Edit Flashcard" : "New Flashcard"}</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <form id="fc-form">
      <div class="field">
        <label>Course</label>
        <select id="fc-course">
          <option value="">General (visible to everyone)</option>
          ${courses.map((c) => `<option value="${c.id}" ${card?.courseId === c.id ? "selected" : ""}>${escapeHtml(c.title)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Front (question/prompt)</label><textarea id="fc-front" rows="3" required>${card ? escapeHtml(card.front) : ""}</textarea></div>
      <div class="field"><label>Back (answer)</label><textarea id="fc-back" rows="3" required>${card ? escapeHtml(card.back) : ""}</textarea></div>
      <div class="form-error" id="fc-error"></div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary" style="flex:1">${card ? "Save Changes" : "Add Flashcard"}</button>
        ${card ? `<button type="button" class="btn btn-danger" id="fc-delete-btn"><i class="fa-solid fa-trash"></i></button>` : ""}
      </div>
    </form>
  `);

  overlay.querySelector("#fc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const courseId = document.getElementById("fc-course").value || null;
    const courseTitle = courseId ? courses.find((c) => c.id === courseId)?.title || "" : "";
    const front = document.getElementById("fc-front").value.trim();
    const back = document.getElementById("fc-back").value.trim();
    if (!front || !back) return;
    try {
      if (card) {
        await updateDoc(doc(db, "flashcards", card.id), { courseId, courseTitle, front, back });
        toast("Flashcard updated", "success");
      } else {
        await addDoc(collection(db, "flashcards"), { courseId, courseTitle, front, back, createdAt: serverTimestamp() });
        toast("Flashcard added", "success");
      }
      closeModal();
      await loadFlashcards();
      renderFlashcardsList(document.getElementById("fc-course-filter")?.value || "");
    } catch (err) {
      document.getElementById("fc-error").textContent = err.message || "Something went wrong.";
    }
  });

  overlay.querySelector("#fc-delete-btn")?.addEventListener("click", () => {
    confirmAction("Delete this flashcard? This can't be undone.", { title: "Delete Flashcard" }).then(async (ok) => {
      if (!ok) return;
      await deleteDoc(doc(db, "flashcards", card.id));
      closeModal();
      toast("Flashcard deleted", "success");
      await loadFlashcards();
      renderFlashcardsList(document.getElementById("fc-course-filter")?.value || "");
    });
  });
}

/* ---------- Discussion moderation ---------- */
export async function initDiscussionModerationSection() {
  const wrap = document.getElementById("discussion-mod-list");
  wrap.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  const snap = await getDocs(query(collection(db, "discussions"), orderBy("lastActivityAt", "desc"))).catch(() => ({ docs: [] }));
  const threads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!threads.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-comments"></i></div><p>No discussion threads yet</p></div>`;
    return;
  }

  wrap.innerHTML = `<div class="admin-notif-list">${threads.map((t) => `
    <div class="admin-notif-row" style="cursor:default">
      <div class="admin-notif-row-icon"><i class="fa-solid fa-comment"></i></div>
      <div class="admin-notif-row-main">
        <div class="admin-notif-row-title">${escapeHtml(t.title || "")}</div>
        <div class="admin-notif-row-meta">
          <span>${escapeHtml(t.name || "User")}</span>
          <span class="admin-notif-row-dot">•</span>
          <span>${t.courseTitle ? escapeHtml(t.courseTitle) : "General"}</span>
          <span class="admin-notif-row-dot">•</span>
          <span>${t.lastActivityAt ? timeAgo(t.lastActivityAt) : ""}</span>
          <span class="admin-notif-row-dot">•</span>
          <span>${t.replyCount || 0} replies</span>
        </div>
      </div>
      <button type="button" class="btn btn-danger btn-sm" data-id="${t.id}"><i class="fa-solid fa-trash"></i></button>
    </div>`).join("")}</div>`;

  wrap.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await confirmAction("Delete this discussion thread and all its replies? This can't be undone.", { title: "Delete Thread" });
      if (!ok) return;
      const threadId = btn.dataset.id;
      const repliesSnap = await getDocs(collection(db, "discussions", threadId, "replies")).catch(() => ({ docs: [] }));
      await Promise.all(repliesSnap.docs.map((r) => deleteDoc(r.ref)));
      await deleteDoc(doc(db, "discussions", threadId));
      toast("Thread deleted", "success");
      initDiscussionModerationSection();
    });
  });
}
