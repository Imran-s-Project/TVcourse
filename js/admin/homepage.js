// ==========================================================================
// admin/homepage.js — Homepage settings + featured videos
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, doc, getDoc, setDoc, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, escapeHtml, openModal, videoThumbnail } from "../utils.js";
import { courses } from "../admin.js";

export let homepageSettings = null;

/* ==========================================================================
   Homepage settings + featured videos
   ========================================================================== */
export async function loadHomepageSettings() {
  const snap = await getDoc(doc(db, "settings", "homepage"));
  homepageSettings = snap.exists() ? snap.data() : { heroEyebrow: "", heroTitle: "", heroSubtitle: "", featuredLessons: [] };
  document.getElementById("hero-eyebrow-input").value = homepageSettings.heroEyebrow || "";
  document.getElementById("hero-title-input").value = homepageSettings.heroTitle || "";
  document.getElementById("hero-subtitle-input").value = homepageSettings.heroSubtitle || "";
  renderFeaturedVideoList();

  document.getElementById("hero-settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("hero-settings-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      homepageSettings.heroEyebrow = document.getElementById("hero-eyebrow-input").value.trim();
      homepageSettings.heroTitle = document.getElementById("hero-title-input").value.trim();
      homepageSettings.heroSubtitle = document.getElementById("hero-subtitle-input").value.trim();
      await saveHomepageSettings();
      toast("Homepage settings saved", "success");
    } catch {
      toast("Could not save", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });

  document.getElementById("add-featured-video-btn").addEventListener("click", openAddFeaturedVideoModal);
}

export async function saveHomepageSettings() {
  await setDoc(doc(db, "settings", "homepage"), { ...homepageSettings, updatedAt: serverTimestamp() }, { merge: true });
}

export function renderFeaturedVideoList() {
  const wrap = document.getElementById("featured-video-list");
  const list = homepageSettings.featuredLessons || [];
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-video"></i></div><p>No videos selected — the homepage is automatically showing the newest videos</p></div>`;
    return;
  }
  wrap.innerHTML = list
    .map((v, i) => {
      const thumb = videoThumbnail(v.videoURL) || "";
      return `
      <div class="fv-row">
        <img src="${thumb}" alt="" onerror="this.style.visibility='hidden'">
        <div class="info">
          <div class="t">${escapeHtml(v.title)}</div>
          <div class="s">${escapeHtml(v.courseTitle || "")}</div>
        </div>
        <div class="order-controls">
          <button data-move="up" data-i="${i}" title="Move up"><i class="fa-solid fa-chevron-up"></i></button>
          <button data-move="down" data-i="${i}" title="Move down"><i class="fa-solid fa-chevron-down"></i></button>
        </div>
        <button class="icon-btn danger" data-remove-fv="${i}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>`;
    })
    .join("");

  wrap.querySelectorAll("[data-remove-fv]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      homepageSettings.featuredLessons.splice(Number(btn.dataset.removeFv), 1);
      await saveHomepageSettings();
      renderFeaturedVideoList();
      toast("Removed", "success");
    })
  );
  wrap.querySelectorAll("[data-move]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.i);
      const dir = btn.dataset.move === "up" ? -1 : 1;
      const j = i + dir;
      const arr = homepageSettings.featuredLessons;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      await saveHomepageSettings();
      renderFeaturedVideoList();
    })
  );
}

async function openAddFeaturedVideoModal() {
  if (!courses.length) { toast("Please create a course and lesson first", "error"); return; }
  const overlay = openModal(`
    <div class="modal-head"><h3>Add Featured Video</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <div class="field"><label>Select Course</label><select id="fv-course-select"></select></div>
    <div class="field"><label>Select Lesson</label><select id="fv-lesson-select"><option>Loading...</option></select></div>
    <button class="btn btn-primary btn-block" id="fv-add-confirm-btn">Add</button>
  `);
  const courseSel = overlay.querySelector("#fv-course-select");
  const lessonSel = overlay.querySelector("#fv-lesson-select");
  courseSel.innerHTML = courses.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("");

  async function populateLessons() {
    lessonSel.innerHTML = `<option>Loading...</option>`;
    const snap = await getDocs(query(collection(db, "courses", courseSel.value, "lessons"), orderBy("order")));
    const lessons = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lessonSel.innerHTML = lessons.length
      ? lessons.map((l) => `<option value="${l.id}">${escapeHtml(l.title)}</option>`).join("")
      : `<option value="">No lessons in this course</option>`;
    lessonSel.dataset.lessons = JSON.stringify(lessons);
  }
  courseSel.addEventListener("change", populateLessons);
  await populateLessons();

  overlay.querySelector("#fv-add-confirm-btn").addEventListener("click", async () => {
    const lessons = JSON.parse(lessonSel.dataset.lessons || "[]");
    const lesson = lessons.find((l) => l.id === lessonSel.value);
    if (!lesson) { toast("Please select a lesson", "error"); return; }
    const course = courses.find((c) => c.id === courseSel.value);
    homepageSettings.featuredLessons = homepageSettings.featuredLessons || [];
    if (homepageSettings.featuredLessons.some((v) => v.lessonId === lesson.id)) {
      toast("This video has already been added", "error");
      return;
    }
    homepageSettings.featuredLessons.push({
      courseId: course.id, lessonId: lesson.id, title: lesson.title,
      courseTitle: course.title, videoURL: lesson.videoURL, duration: lesson.duration || 0,
    });
    await saveHomepageSettings();
    renderFeaturedVideoList();
    closeModal();
    toast("Video added", "success");
  });
}

