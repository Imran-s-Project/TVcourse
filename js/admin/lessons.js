// ==========================================================================
// admin/lessons.js — Lesson / video management
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, orderBy, updateDoc, doc, addDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, escapeHtml, openModal, closeModal, confirmAction, videoThumbnail } from "../utils.js";
import { initRichEditor } from "../rich-text.js";
import { courses, refreshCourses } from "../admin.js";
import { loadCoursesTable } from "./courses.js";
import { loadOverview } from "./overview.js";
import { homepageSettings, saveHomepageSettings, renderFeaturedVideoList } from "./homepage.js";

/* ==========================================================================
   Lesson / video management
   ========================================================================== */
export function refreshLessonCourseSelect() {
  const sel = document.getElementById("lessons-course-select");
  const prev = sel.value;
  sel.innerHTML = courses.length
    ? courses.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("")
    : `<option value="">Please create a course first</option>`;
  if (prev && courses.some((c) => c.id === prev)) sel.value = prev;
  if (sel.value) loadLessonsTable(sel.value);
  else document.querySelector("#lessons-table tbody").innerHTML = `<tr><td colspan="4"><div class="empty-state">Please create a course first</div></td></tr>`;
}

export function bindLessonsSection() {
  document.getElementById("lessons-course-select").addEventListener("change", (e) => loadLessonsTable(e.target.value));
  document.getElementById("add-lesson-btn-top").addEventListener("click", () => {
    const courseId = document.getElementById("lessons-course-select").value;
    if (!courseId) { toast("Please create a course first", "error"); return; }
    openLessonModal(courseId, null);
  });
}

let currentLessons = [];
async function loadLessonsTable(courseId) {
  const tbody = document.querySelector("#lessons-table tbody");
  if (!courseId) { tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">Please select a course first</div></td></tr>`; return; }
  tbody.innerHTML = `<tr><td colspan="4"><div class="loading-screen"><span class="spinner"></span></div></td></tr>`;
  const snap = await getDocs(query(collection(db, "courses", courseId, "lessons"), orderBy("order")));
  currentLessons = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!currentLessons.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="icon"><i class="fa-solid fa-video"></i></div><p>No lessons added yet</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = currentLessons
    .map((l, i) => {
      const thumb = videoThumbnail(l.videoURL);
      return `
      <tr>
        <td data-label="Lesson"><div class="cell-title">${thumb ? `<img src="${thumb}" alt="">` : ""}<div><div class="t">${escapeHtml(l.title)}</div><div class="s">${(l.slides || []).length} slides${l.pdfURL ? ' · <i class="fa-solid fa-file-pdf"></i> PDF' : ""}</div></div></div></td>
        <td data-label="Duration">${l.duration || 0} min</td>
        <td data-label="Order">${i + 1}</td>
        <td data-label=""><div class="row-actions">
          <button class="icon-btn" data-edit-lesson="${l.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" data-del-lesson="${l.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll("[data-edit-lesson]").forEach((b) => b.addEventListener("click", () => openLessonModal(courseId, b.dataset.editLesson)));
  tbody.querySelectorAll("[data-del-lesson]").forEach((b) => b.addEventListener("click", () => deleteLesson(courseId, b.dataset.delLesson)));
}

function openLessonModal(courseId, lessonId) {
  const l = lessonId ? currentLessons.find((x) => x.id === lessonId) : null;
  const overlay = openModal(`
    <div class="modal-head"><h3>${l ? "Edit Lesson" : "Add New Lesson"}</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <form id="lesson-modal-form">
      <div class="field"><label>Lesson Title</label><input type="text" id="lm-title" required value="${l ? escapeHtml(l.title) : ""}"></div>
      <div class="field"><label>Description</label><textarea id="lm-desc" rows="4">${l ? escapeHtml(l.description || "") : ""}</textarea></div>
      <div class="field"><label>Video URL (YouTube or mp4)</label><input type="url" id="lm-video" placeholder="https://youtube.com/watch?v=..." required value="${l ? escapeHtml(l.videoURL || "") : ""}"></div>
      <div class="field"><label>Slide Image URLs (comma-separated)</label><textarea id="lm-slides" rows="2">${l ? escapeHtml((l.slides || []).join(", ")) : ""}</textarea></div>
      <div class="field"><label>Slide PDF — Google Drive Link (optional)</label><input type="url" id="lm-pdf" placeholder="https://drive.google.com/file/d/.../view?usp=sharing" value="${l ? escapeHtml(l.pdfURL || "") : ""}"><span class="form-hint">The Drive file's sharing must be set to "Anyone with the link can view"</span></div>
      <div class="field" style="max-width:200px"><label>Duration (minutes)</label><input type="number" id="lm-duration" min="0" value="${l ? l.duration || 0 : ""}"></div>
      <button type="submit" class="btn btn-primary btn-block" id="lesson-modal-save-btn">${l ? "Save Changes" : "Add Lesson"}</button>
    </form>
  `);
  initRichEditor(overlay.querySelector("#lm-desc"));

  overlay.querySelector("#lesson-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector("#lesson-modal-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    const slidesRaw = overlay.querySelector("#lm-slides").value.trim();
    const payload = {
      title: overlay.querySelector("#lm-title").value.trim(),
      description: overlay.querySelector("#lm-desc").value.trim(),
      videoURL: overlay.querySelector("#lm-video").value.trim(),
      duration: Number(overlay.querySelector("#lm-duration").value) || 0,
      slides: slidesRaw ? slidesRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
      pdfURL: overlay.querySelector("#lm-pdf").value.trim(),
    };
    try {
      if (l) {
        await updateDoc(doc(db, "courses", courseId, "lessons", l.id), payload);
        toast("Lesson updated", "success");
      } else {
        await addDoc(collection(db, "courses", courseId, "lessons"), { ...payload, order: currentLessons.length });
        await updateDoc(doc(db, "courses", courseId), { lessonCount: currentLessons.length + 1 });
        toast("Lesson added", "success");
      }
      closeModal();
      await refreshCourses();
      await loadLessonsTable(courseId);
      loadCoursesTable();
      loadOverview();
    } catch {
      toast("Could not save", "error");
      btn.disabled = false;
      btn.textContent = l ? "Save Changes" : "Add Lesson";
    }
  });
}

async function deleteLesson(courseId, lessonId) {
  if (!(await confirmAction("Do you want to delete this lesson?"))) return;
  try {
    await deleteDoc(doc(db, "courses", courseId, "lessons", lessonId));
    const course = courses.find((c) => c.id === courseId);
    await updateDoc(doc(db, "courses", courseId), { lessonCount: Math.max(0, (course?.lessonCount || 1) - 1) });
    if (homepageSettings?.featuredLessons?.length) {
      const before = homepageSettings.featuredLessons.length;
      homepageSettings.featuredLessons = homepageSettings.featuredLessons.filter((v) => v.lessonId !== lessonId);
      if (homepageSettings.featuredLessons.length !== before) await saveHomepageSettings();
    }
    toast("Lesson deleted", "success");
    await refreshCourses();
    await loadLessonsTable(courseId);
    loadCoursesTable();
    loadOverview();
    renderFeaturedVideoList();
  } catch {
    toast("Could not delete", "error");
  }
}

