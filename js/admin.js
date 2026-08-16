// ==========================================================================
// admin.js — Full admin panel: courses, lessons/videos, exams, users, homepage
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc,
  query, orderBy, where, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  initNav, requireAdmin, toast, escapeHtml, toBnDigits, formatDate, formatDateTime, getExamAvailability,
  openModal, closeModal, confirmAction, youTubeId, videoThumbnail, isDirectVideo,
  getCoursePricing, priceBadgeHtml, formatScore, formatDuration,
} from "./utils.js";

initNav("admin");

let me = null;         // { user, profile }
let courses = [];      // Cached course list
let homepageSettings = null;

async function init() {
  me = await requireAdmin();
  if (!me) return;
  document.getElementById("admin-gate").classList.add("hidden");
  document.getElementById("admin-shell").classList.remove("hidden");

  bindSidebar();
  await refreshCourses();
  loadOverview();
  loadHomepageSettings();
  loadCoursesTable();
  loadExamsTable();
  loadUsersTable();
  loadPaymentSettings();
  loadPurchasesTable();
  bindLessonsSection();
}

/* ---------- Sidebar section switching + mobile drawer ---------- */
function bindSidebar() {
  const sidebar = document.getElementById("admin-sidebar");
  const backdrop = document.getElementById("admin-sidebar-backdrop");
  const drawerToggle = document.getElementById("admin-drawer-toggle");
  const drawerClose = document.getElementById("admin-drawer-close");
  const mobileTitle = document.getElementById("admin-mobile-topbar-title");

  const closeDrawer = () => {
    sidebar?.classList.remove("open");
    backdrop?.classList.remove("open");
  };

  drawerToggle?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
    backdrop?.classList.toggle("open");
  });
  backdrop?.addEventListener("click", closeDrawer);
  drawerClose?.addEventListener("click", closeDrawer);

  document.querySelectorAll(".admin-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".admin-section").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`section-${btn.dataset.section}`).classList.add("active");
      if (mobileTitle) mobileTitle.textContent = btn.dataset.label || btn.textContent.trim();
      if (btn.dataset.section === "leaderboard") initLeaderboardSection();
      closeDrawer();
    });
  });
}

async function refreshCourses() {
  // Fetched without orderBy() on purpose — see the note in exam.js loadExamList().
  const snap = await getDocs(collection(db, "courses"));
  courses = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return courses;
}

/* ==========================================================================
   Overview
   ========================================================================== */
async function loadOverview() {
  const grid = document.getElementById("stat-grid");
  try {
    const [lessonCounts, examsSnap, usersSnap, resultsSnap] = await Promise.all([
      Promise.resolve(courses.reduce((sum, c) => sum + (c.lessonCount || 0), 0)),
      getDocs(collection(db, "exams")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, "results")),
    ]);
    const stats = [
      { n: courses.length, l: "Courses" },
      { n: lessonCounts, l: "Videos" },
      { n: examsSnap.size, l: "Exams" },
      { n: usersSnap.size, l: "Registered Users" },
      { n: resultsSnap.size, l: "Exams Taken" },
    ];
    grid.innerHTML = stats.map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`).join("");

    const results = resultsSnap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
      .slice(0, 8);
    const usersMap = {};
    usersSnap.docs.forEach((d) => (usersMap[d.id] = d.data()));
    const tbody = document.querySelector("#recent-results-table tbody");
    if (!results.length) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No exam results yet</div></td></tr>`;
    } else {
      tbody.innerHTML = results
        .map((r) => `
        <tr>
          <td data-label="User">${escapeHtml(usersMap[r.uid]?.displayName || usersMap[r.uid]?.email || "Unknown")}</td>
          <td data-label="Exam">${escapeHtml(r.examTitle || "")}</td>
          <td data-label="Score">${r.score}/${r.total}</td>
          <td data-label="Date">${formatDate(r.submittedAt)}</td>
        </tr>`)
        .join("");
    }
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><p>Could not load</p></div>`;
  }
}

/* ==========================================================================
   Homepage settings + featured videos
   ========================================================================== */
async function loadHomepageSettings() {
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

async function saveHomepageSettings() {
  await setDoc(doc(db, "settings", "homepage"), { ...homepageSettings, updatedAt: serverTimestamp() }, { merge: true });
}

function renderFeaturedVideoList() {
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

/* ==========================================================================
   Course management
   ========================================================================== */
async function loadCoursesTable() {
  const tbody = document.querySelector("#courses-table tbody");
  await refreshCourses();
  if (!courses.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="icon"><i class="fa-solid fa-book"></i></div><p>No courses created yet</p></div></td></tr>`;
  } else {
    tbody.innerHTML = courses
      .map((c) => `
      <tr>
        <td data-label="Course"><div class="cell-title"><img src="${c.coverImage || ""}" alt=""><div><div class="t">${escapeHtml(c.title)}</div><div class="s">${escapeHtml(c.instructor || "")}</div></div></div></td>
        <td data-label="Category"><span class="badge badge-amber">${escapeHtml(c.category || "General")}</span> ${priceBadgeHtml(c)}</td>
        <td data-label="Lessons">${c.lessonCount || 0}</td>
        <td data-label="Created">${formatDate(c.createdAt)}</td>
        <td data-label=""><div class="row-actions">
          <button class="icon-btn" data-edit-course="${c.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" data-del-course="${c.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`)
      .join("");
  }
  tbody.querySelectorAll("[data-edit-course]").forEach((b) => b.addEventListener("click", () => openCourseModal(b.dataset.editCourse)));
  tbody.querySelectorAll("[data-del-course]").forEach((b) => b.addEventListener("click", () => deleteCourse(b.dataset.delCourse)));
  refreshLessonCourseSelect();
}

document.getElementById("add-course-btn-top")?.addEventListener("click", () => openCourseModal(null));

function openCourseModal(courseId) {
  const c = courseId ? courses.find((x) => x.id === courseId) : null;
  const overlay = openModal(`
    <div class="modal-head"><h3>${c ? "Edit Course" : "Create New Course"}</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <form id="course-modal-form">
      <div class="field"><label>Course Name</label><input type="text" id="cm-title" required value="${c ? escapeHtml(c.title) : ""}"></div>
      <div class="field"><label>Description</label><textarea id="cm-desc" rows="3">${c ? escapeHtml(c.description || "") : ""}</textarea></div>
      <div class="admin-grid">
        <div class="field"><label>Category</label><input type="text" id="cm-category" placeholder="e.g. Web Development" value="${c ? escapeHtml(c.category || "") : ""}"></div>
        <div class="field"><label>Instructor Name</label><input type="text" id="cm-instructor" value="${c ? escapeHtml(c.instructor || "") : ""}"></div>
      </div>
      <div class="field"><label>Cover Image URL</label><input type="url" id="cm-cover" placeholder="https://..." value="${c ? escapeHtml(c.coverImage || "") : ""}"></div>

      <div class="schedule-box">
        <div class="schedule-box-title"><i class="fa-solid fa-lock"></i> Price & Access Code Lock</div>
        <p class="form-hint" style="margin-bottom:10px;">Set price to 0 to keep the course free and viewable by everyone. Setting a price locks the course — it must be purchased and unlocked with an access code.</p>
        <div class="admin-grid">
          <div class="field"><label>Price (৳)</label><input type="number" id="cm-price" min="0" value="${c ? c.price || 0 : 0}"></div>
          <div class="field"><label>Discount Price (৳, optional)</label><input type="number" id="cm-discount" min="0" placeholder="Can be left empty" value="${c && c.discountPrice ? c.discountPrice : ""}"></div>
        </div>
        <div class="field"><label>How to Buy — Video Link (YouTube or direct mp4)</label><input type="url" id="cm-buy-video" placeholder="https://youtube.com/..." value="${c ? escapeHtml(c.buyVideoUrl || "") : ""}"></div>
      </div>

      <button type="submit" class="btn btn-primary btn-block" id="course-modal-save-btn">${c ? "Save Changes" : "Create Course"}</button>
    </form>
  `);
  overlay.querySelector("#course-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector("#course-modal-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    const payload = {
      title: overlay.querySelector("#cm-title").value.trim(),
      description: overlay.querySelector("#cm-desc").value.trim(),
      category: overlay.querySelector("#cm-category").value.trim() || "General",
      instructor: overlay.querySelector("#cm-instructor").value.trim(),
      coverImage: overlay.querySelector("#cm-cover").value.trim(),
      price: Number(overlay.querySelector("#cm-price").value) || 0,
      discountPrice: Number(overlay.querySelector("#cm-discount").value) || 0,
      buyVideoUrl: overlay.querySelector("#cm-buy-video").value.trim(),
    };
    try {
      if (c) {
        await updateDoc(doc(db, "courses", c.id), payload);
        toast("Course updated", "success");
      } else {
        await addDoc(collection(db, "courses"), { ...payload, lessonCount: 0, createdAt: serverTimestamp() });
        toast("Course created", "success");
      }
      closeModal();
      await loadCoursesTable();
      loadOverview();
    } catch {
      toast("Could not save", "error");
      btn.disabled = false;
      btn.textContent = c ? "Save Changes" : "Create Course";
    }
  });
}

async function deleteCourse(courseId) {
  const c = courses.find((x) => x.id === courseId);
  if (!(await confirmAction(`Do you want to permanently delete the course "${c?.title || ""}" and all its lessons?`))) return;
  try {
    const lessonsSnap = await getDocs(collection(db, "courses", courseId, "lessons"));
    await Promise.all(lessonsSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "courses", courseId));
    if (homepageSettings?.featuredLessons?.length) {
      const before = homepageSettings.featuredLessons.length;
      homepageSettings.featuredLessons = homepageSettings.featuredLessons.filter((v) => v.courseId !== courseId);
      if (homepageSettings.featuredLessons.length !== before) await saveHomepageSettings();
    }
    toast("Course deleted", "success");
    await loadCoursesTable();
    loadOverview();
    renderFeaturedVideoList();
  } catch {
    toast("Could not delete", "error");
  }
}

/* ==========================================================================
   Lesson / video management
   ========================================================================== */
function refreshLessonCourseSelect() {
  const sel = document.getElementById("lessons-course-select");
  const prev = sel.value;
  sel.innerHTML = courses.length
    ? courses.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("")
    : `<option value="">Please create a course first</option>`;
  if (prev && courses.some((c) => c.id === prev)) sel.value = prev;
  if (sel.value) loadLessonsTable(sel.value);
  else document.querySelector("#lessons-table tbody").innerHTML = `<tr><td colspan="4"><div class="empty-state">Please create a course first</div></td></tr>`;
}

function bindLessonsSection() {
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
      <div class="field"><label>Description</label><textarea id="lm-desc" rows="2">${l ? escapeHtml(l.description || "") : ""}</textarea></div>
      <div class="field"><label>Video URL (YouTube or mp4)</label><input type="url" id="lm-video" placeholder="https://youtube.com/watch?v=..." required value="${l ? escapeHtml(l.videoURL || "") : ""}"></div>
      <div class="field"><label>Slide Image URLs (comma-separated)</label><textarea id="lm-slides" rows="2">${l ? escapeHtml((l.slides || []).join(", ")) : ""}</textarea></div>
      <div class="field"><label>Slide PDF — Google Drive Link (optional)</label><input type="url" id="lm-pdf" placeholder="https://drive.google.com/file/d/.../view?usp=sharing" value="${l ? escapeHtml(l.pdfURL || "") : ""}"><span class="form-hint">The Drive file's sharing must be set to "Anyone with the link can view"</span></div>
      <div class="field" style="max-width:200px"><label>Duration (minutes)</label><input type="number" id="lm-duration" min="0" value="${l ? l.duration || 0 : ""}"></div>
      <button type="submit" class="btn btn-primary btn-block" id="lesson-modal-save-btn">${l ? "Save Changes" : "Add Lesson"}</button>
    </form>
  `);
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

/* ==========================================================================
   Exam management
   ========================================================================== */
let currentExams = [];
async function loadExamsTable() {
  const tbody = document.querySelector("#exams-table tbody");
  // Fetched without orderBy() on purpose — see the matching note in exam.js loadExamList().
  const snap = await getDocs(collection(db, "exams"));
  currentExams = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  if (!currentExams.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams created yet</p></div></td></tr>`;
  } else {
    tbody.innerHTML = currentExams
      .map((ex) => `
      <tr>
        <td data-label="Exam"><div class="cell-title"><div><div class="t">${escapeHtml(ex.title)}</div></div></div></td>
        <td data-label="Course Tag">${escapeHtml(ex.courseName || "—")}</td>
        <td data-label="Scope">${examScopeBadge(ex)}</td>
        <td data-label="Questions">${ex.questionCount || 0}</td>
        <td data-label="Time">${ex.duration || 0} min</td>
        <td data-label="Settings">${examSettingsBadges(ex)}</td>
        <td data-label="Schedule">${scheduleBadge(ex)}</td>
        <td data-label=""><div class="row-actions">
          <button class="icon-btn" data-edit-exam="${ex.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" data-del-exam="${ex.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`)
      .join("");
  }
  tbody.querySelectorAll("[data-edit-exam]").forEach((b) => b.addEventListener("click", () => openExamModal(b.dataset.editExam)));
  tbody.querySelectorAll("[data-del-exam]").forEach((b) => b.addEventListener("click", () => deleteExam(b.dataset.delExam)));
}

/* ---------- What this exam actually covers — whole course vs specific lesson(s) ---------- */
function examScopeBadge(ex) {
  if (!ex.courseId) return `<span class="badge">Open to Everyone</span>`;
  if (ex.lessonIds?.length) {
    const names = (ex.lessonNames || []).join(", ");
    return `<span class="badge badge-teal" title="${escapeHtml(names)}"><i class="fa-solid fa-list-check"></i> ${ex.lessonIds.length === 1 ? "1 Lesson" : `${ex.lessonIds.length} Lessons`}</span>`;
  }
  return `<span class="badge badge-amber"><i class="fa-solid fa-graduation-cap"></i> Whole Course</span>`;
}

function examSettingsBadges(ex) {
  const attemptsBadge = ex.maxAttempts > 0
    ? `<span class="badge badge-amber" title="Maximum ${ex.maxAttempts} attempts allowed"><i class="fa-solid fa-rotate"></i> ${ex.maxAttempts}x</span>`
    : `<span class="badge badge-teal" title="Unlimited attempts"><i class="fa-solid fa-infinity"></i> Unlimited</span>`;
  const layoutBadge = ex.layout === "all"
    ? `<span class="badge" title="All questions on one page"><i class="fa-solid fa-list"></i> All at once</span>`
    : `<span class="badge" title="One question at a time"><i class="fa-solid fa-layer-group"></i> One by one</span>`;
  const shuffleBadge = ex.shuffle !== false
    ? `<span class="badge" title="Questions and options are shuffled"><i class="fa-solid fa-shuffle"></i> Shuffle</span>`
    : "";
  const negBadge = Number(ex.negativeMarking) > 0
    ? `<span class="badge badge-coral" title="Deducted per wrong answer"><i class="fa-solid fa-triangle-exclamation"></i> −${formatScore(ex.negativeMarking)}/wrong</span>`
    : "";
  return `<div class="settings-badges">${attemptsBadge}${layoutBadge}${shuffleBadge}${negBadge}</div>`;
}

function scheduleBadge(ex) {
  const { state, publishAt, closesAt } = getExamAvailability(ex);
  if (state === "upcoming") return `<span class="badge badge-amber" title="${formatDateTime(publishAt)}"><i class="fa-solid fa-lock"></i> Scheduled</span>`;
  if (state === "closed") return `<span class="badge badge-coral" title="${formatDateTime(closesAt)}"><i class="fa-solid fa-stopwatch"></i> Closed</span>`;
  if (closesAt) return `<span class="badge badge-teal" title="${formatDateTime(closesAt)}"><i class="fa-solid fa-circle" style="color:#22c55e"></i> Open</span>`;
  return `<span class="badge badge-teal"><i class="fa-solid fa-circle" style="color:#22c55e"></i> Always Open</span>`;
}

/* ---------- Firestore Timestamp → <input type="datetime-local"> value ---------- */
function toDatetimeLocalValue(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

document.getElementById("add-exam-btn-top")?.addEventListener("click", () => openExamModal(null));

async function openExamModal(examId) {
  const ex = examId ? currentExams.find((x) => x.id === examId) : null;
  let questionDrafts = [];
  if (ex) {
    const qSnap = await getDocs(query(collection(db, "exams", ex.id, "questions"), orderBy("order")));
    questionDrafts = qSnap.docs.map((d) => ({ text: d.data().text, options: d.data().options, correctIndex: d.data().correctIndex }));
  }

  const overlay = openModal(`
    <div class="modal-head"><h3>${ex ? "Edit Exam" : "Create New Exam"}</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <form id="exam-modal-form">
      <div class="exam-tabs">
        <button type="button" class="exam-tab-btn active" data-tab="settings" id="em-tab-btn-settings"><i class="fa-solid fa-sliders"></i> Info & Settings</button>
        <button type="button" class="exam-tab-btn" data-tab="questions" id="em-tab-btn-questions"><i class="fa-solid fa-list-check"></i> Questions <span class="exam-tab-count" id="em-tab-q-count">0</span></button>
      </div>

      <div class="exam-tab-panel" id="em-panel-settings">
        <div class="admin-grid">
          <div class="field"><label>Exam Title</label><input type="text" id="em-title" required value="${ex ? escapeHtml(ex.title) : ""}"></div>
          <div class="field"><label>Course Name (as tag)</label><input type="text" id="em-course" value="${ex ? escapeHtml(ex.courseName || "") : ""}"></div>
        </div>
        <div class="field">
          <label>Linked Course (if paid, this exam will also be locked)</label>
          <select id="em-course-id">
            <option value="">— Not linked to any course (open to everyone) —</option>
            ${courses.map((cc) => `<option value="${cc.id}" ${ex && ex.courseId === cc.id ? "selected" : ""}>${escapeHtml(cc.title)}${getCoursePricing(cc).isPaid ? " (Paid)" : ""}</option>`).join("")}
          </select>
          <span class="form-hint">If you pick a course and it's paid, only users who've unlocked that course can take this exam</span>
        </div>

        <div class="field" id="em-scope-field" hidden>
          <label>Exam Covers</label>
          <select id="em-scope">
            <option value="course">Whole Course (every lesson)</option>
            <option value="lessons">Specific Lesson(s) only</option>
          </select>
          <span class="form-hint">"Specific Lesson(s)" lets you build one exam for a single lesson, or pick several lessons at once</span>
        </div>
        <div class="field" id="em-lessons-field" hidden>
          <label>Select Lesson(s)</label>
          <div class="lesson-picker" id="em-lesson-picker"><div class="empty-state" style="padding:14px;">Loading lessons...</div></div>
        </div>

        <div class="field"><label>Description</label><textarea id="em-desc" rows="2">${ex ? escapeHtml(ex.description || "") : ""}</textarea></div>
        <div class="admin-grid">
          <div class="field"><label>Time Limit (minutes, during the exam)</label><input type="number" id="em-duration" min="1" value="${ex ? ex.duration || 10 : 10}"></div>
          <div class="field"><label>Maximum Attempts Allowed</label><input type="number" id="em-max-attempts" min="0" placeholder="Leave empty or 0 for unlimited" value="${ex && ex.maxAttempts ? ex.maxAttempts : ""}"><span class="form-hint">Leave empty to let users attempt as many times as they like</span></div>
        </div>
        <div class="field">
          <label>Negative Marking (marks deducted per wrong answer)</label>
          <input type="number" id="em-negative-marking" min="0" step="0.25" placeholder="0" value="${ex && ex.negativeMarking ? ex.negativeMarking : ""}">
          <span class="form-hint">e.g. 0.25 deducts a quarter mark for every wrong answer — unanswered questions are never penalized. Leave empty or 0 to turn negative marking off. This also feeds the Leaderboard's ranking.</span>
        </div>

        <div class="schedule-box">
          <div class="schedule-box-title"><i class="fa-solid fa-sliders"></i> Exam Behavior</div>
          <div class="admin-grid">
            <div class="field">
              <label>Question Display Style</label>
              <select id="em-layout">
                <option value="one" ${!ex || (ex.layout || "one") === "one" ? "selected" : ""}>One at a time (one question / page)</option>
                <option value="all" ${ex && ex.layout === "all" ? "selected" : ""}>All questions on one page</option>
              </select>
            </div>
            <div class="field">
              <label>Question & Option Order</label>
              <label class="switch-row">
                <input type="checkbox" id="em-shuffle" ${!ex || ex.shuffle !== false ? "checked" : ""}>
                <span>Shuffle each time it's shown</span>
              </label>
              <span class="form-hint">When enabled, the question and option order changes on every attempt — makes cheating/memorizing harder</span>
            </div>
          </div>
        </div>

        <div class="schedule-box">
          <div class="schedule-box-title"><i class="fa-solid fa-calendar-days"></i> Publish Schedule</div>
          <div class="admin-grid">
            <div class="field">
              <label>When to Publish</label>
              <input type="datetime-local" id="em-publish-at" value="${ex ? toDatetimeLocalValue(ex.publishAt) : ""}">
              <span class="form-hint">Leave empty to publish immediately</span>
            </div>
            <div class="field">
              <label>Hours to Stay Open</label>
              <input type="number" id="em-available-hours" min="0" step="1" placeholder="e.g. 48" value="${ex && ex.availableHours ? ex.availableHours : ""}">
              <span class="form-hint">Leave empty or 0 to stay open indefinitely</span>
            </div>
          </div>
        </div>

        <button type="button" class="btn btn-teal btn-block mt-16" id="em-goto-questions-btn">Add Questions <i class="fa-solid fa-arrow-right"></i></button>
      </div>

      <div class="exam-tab-panel" id="em-panel-questions" hidden>
        <div class="qb-section">
          <button type="button" class="btn btn-outline btn-block mb-16" id="em-back-settings-btn"><i class="fa-solid fa-arrow-left"></i> Back to Settings</button>
          <div class="qb-toolbar">
            <div class="qb-count">Total Questions: <span id="em-q-count">0</span></div>
            <button type="button" class="btn btn-outline btn-sm" id="em-bulk-toggle-btn"><i class="fa-solid fa-bolt"></i> Bulk Import</button>
          </div>
          <div class="qb-bulk-panel" id="em-bulk-panel" hidden>
            <span class="form-hint">Paste each question separated by a blank line. First line is the question, then one option per line. Mark the correct option with a leading <b>*</b> —</span>
            <pre class="qb-bulk-example">What is the capital of France?
*Paris
London
Berlin
Rome</pre>
            <textarea id="em-bulk-text" rows="8" placeholder="Paste multiple questions here..."></textarea>
            <div class="qb-bulk-actions">
              <button type="button" class="btn btn-outline btn-sm" id="em-bulk-cancel-btn">Cancel</button>
              <button type="button" class="btn btn-teal btn-sm" id="em-bulk-import-btn"><i class="fa-solid fa-file-import"></i> Import</button>
            </div>
          </div>
          <div id="em-question-list"></div>
          <button type="button" class="btn btn-outline btn-block mt-8" id="em-add-question-btn"><i class="fa-solid fa-plus"></i> Add Question</button>
        </div>
      </div>

      <button type="submit" class="btn btn-teal btn-block mt-24" id="exam-modal-save-btn">${ex ? "Save Changes" : "Publish Exam"}</button>
    </form>
  `);

  /* ---------- Exam scope: whole course vs specific lesson(s) ----------
     The lesson picker only makes sense once a course is chosen (lessons live
     under a course), so it stays hidden until #em-course-id has a value. ---------- */
  const scopeField = overlay.querySelector("#em-scope-field");
  const lessonsField = overlay.querySelector("#em-lessons-field");
  const scopeSelect = overlay.querySelector("#em-scope");
  const lessonPicker = overlay.querySelector("#em-lesson-picker");
  const courseSelectEl = overlay.querySelector("#em-course-id");
  const examLessonsCache = {};

  async function loadLessonPicker(courseId, checkedIds) {
    lessonPicker.innerHTML = `<div class="empty-state" style="padding:14px;">Loading lessons...</div>`;
    if (!examLessonsCache[courseId]) {
      const snap = await getDocs(query(collection(db, "courses", courseId, "lessons"), orderBy("order")));
      examLessonsCache[courseId] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    const courseLessons = examLessonsCache[courseId];
    if (!courseLessons.length) {
      lessonPicker.innerHTML = `<div class="empty-state" style="padding:14px;">This course has no lessons yet — add lessons first</div>`;
      return;
    }
    lessonPicker.innerHTML = courseLessons
      .map(
        (l) => `
      <label class="lesson-picker-item">
        <input type="checkbox" value="${l.id}" data-title="${escapeHtml(l.title)}" ${checkedIds?.includes(l.id) ? "checked" : ""}>
        <span>${escapeHtml(l.title)}</span>
      </label>`
      )
      .join("");
  }

  function refreshScopeVisibility() {
    const cId = courseSelectEl.value;
    scopeField.hidden = !cId;
    lessonsField.hidden = !cId || scopeSelect.value !== "lessons";
  }

  courseSelectEl.addEventListener("change", () => {
    refreshScopeVisibility();
    if (courseSelectEl.value && scopeSelect.value === "lessons") loadLessonPicker(courseSelectEl.value, ex?.lessonIds);
  });
  scopeSelect.addEventListener("change", () => {
    refreshScopeVisibility();
    if (courseSelectEl.value && scopeSelect.value === "lessons") loadLessonPicker(courseSelectEl.value, ex?.lessonIds);
  });

  if (ex && ex.courseId) scopeSelect.value = ex.lessonIds?.length ? "lessons" : "course";
  refreshScopeVisibility();
  if (courseSelectEl.value && scopeSelect.value === "lessons") loadLessonPicker(courseSelectEl.value, ex?.lessonIds);

  /* ---------- Settings ⇄ Questions tab switching ---------- */
  function switchExamTab(tab) {
    const isSettings = tab === "settings";
    overlay.querySelector("#em-panel-settings").hidden = !isSettings;
    overlay.querySelector("#em-panel-questions").hidden = isSettings;
    overlay.querySelector("#em-tab-btn-settings").classList.toggle("active", isSettings);
    overlay.querySelector("#em-tab-btn-questions").classList.toggle("active", !isSettings);
  }
  overlay.querySelectorAll(".exam-tab-btn").forEach((btn) => btn.addEventListener("click", () => switchExamTab(btn.dataset.tab)));
  overlay.querySelector("#em-goto-questions-btn").addEventListener("click", () => switchExamTab("questions"));
  overlay.querySelector("#em-back-settings-btn").addEventListener("click", () => switchExamTab("settings"));

  const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];
  const MAX_OPTIONS = 6;

  function renderQ() {
    const wrap = overlay.querySelector("#em-question-list");
    const countEl = overlay.querySelector("#em-q-count");
    if (countEl) countEl.textContent = questionDrafts.length;
    const tabCountEl = overlay.querySelector("#em-tab-q-count");
    if (tabCountEl) tabCountEl.textContent = questionDrafts.length;

    if (!questionDrafts.length) {
      wrap.innerHTML = `<div class="qb-empty">No questions added yet — click the button below or use bulk import</div>`;
      return;
    }

    wrap.innerHTML = questionDrafts
      .map((q, qi) => `
      <div class="q-card" data-qi="${qi}">
        <div class="q-card-head">
          <span class="q-badge"><i class="fa-solid fa-circle-question"></i> Question ${qi + 1}</span>
          <div class="q-card-actions">
            <button type="button" class="icon-btn q-move-up" data-qi="${qi}" title="Move up" ${qi === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" class="icon-btn q-move-down" data-qi="${qi}" title="Move down" ${qi === questionDrafts.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" class="icon-btn q-duplicate" data-qi="${qi}" title="Duplicate question"><i class="fa-solid fa-copy"></i></button>
            <button type="button" class="icon-btn danger q-remove" data-qi="${qi}" title="Delete question"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <textarea class="q-text-input" data-qi="${qi}" rows="2" placeholder="Enter question" required>${escapeHtml(q.text)}</textarea>
        <div class="q-options">
          ${q.options.map((opt, oi) => `
            <div class="option-row ${q.correctIndex === oi ? "is-correct" : ""}">
              <span class="option-letter">${OPTION_LETTERS[oi] || oi + 1}</span>
              <input type="text" class="q-option-input" data-qi="${qi}" data-oi="${oi}" value="${escapeHtml(opt)}" placeholder="Option ${oi + 1}" required>
              <div class="option-controls">
                <button type="button" class="opt-correct-btn ${q.correctIndex === oi ? "active" : ""}" data-qi="${qi}" data-oi="${oi}" title="Mark as correct answer"><i class="fa-solid fa-check"></i></button>
                <button type="button" class="opt-remove-btn" data-qi="${qi}" data-oi="${oi}" title="Remove option" ${q.options.length <= 2 ? "disabled" : ""}><i class="fa-solid fa-xmark"></i></button>
              </div>
            </div>`).join("")}
        </div>
        <button type="button" class="add-option-btn" data-qi="${qi}" ${q.options.length >= MAX_OPTIONS ? "disabled" : ""}><i class="fa-solid fa-plus"></i> Add Option</button>
      </div>`)
      .join("");

    wrap.querySelectorAll(".q-text-input").forEach((el) => el.addEventListener("input", () => (questionDrafts[el.dataset.qi].text = el.value)));
    wrap.querySelectorAll(".q-option-input").forEach((el) => el.addEventListener("input", () => (questionDrafts[el.dataset.qi].options[el.dataset.oi] = el.value)));

    wrap.querySelectorAll(".opt-correct-btn").forEach((el) => el.addEventListener("click", () => {
      questionDrafts[el.dataset.qi].correctIndex = Number(el.dataset.oi);
      renderQ();
    }));
    wrap.querySelectorAll(".opt-remove-btn").forEach((el) => el.addEventListener("click", () => {
      const qi = Number(el.dataset.qi), oi = Number(el.dataset.oi);
      const q = questionDrafts[qi];
      if (q.options.length <= 2) return;
      q.options.splice(oi, 1);
      if (q.correctIndex === oi) q.correctIndex = 0;
      else if (q.correctIndex > oi) q.correctIndex -= 1;
      renderQ();
    }));
    wrap.querySelectorAll(".add-option-btn").forEach((el) => el.addEventListener("click", () => {
      const q = questionDrafts[Number(el.dataset.qi)];
      if (q.options.length < MAX_OPTIONS) q.options.push("");
      renderQ();
    }));
    wrap.querySelectorAll(".q-move-up").forEach((el) => el.addEventListener("click", () => {
      const qi = Number(el.dataset.qi);
      if (qi === 0) return;
      [questionDrafts[qi - 1], questionDrafts[qi]] = [questionDrafts[qi], questionDrafts[qi - 1]];
      renderQ();
    }));
    wrap.querySelectorAll(".q-move-down").forEach((el) => el.addEventListener("click", () => {
      const qi = Number(el.dataset.qi);
      if (qi === questionDrafts.length - 1) return;
      [questionDrafts[qi + 1], questionDrafts[qi]] = [questionDrafts[qi], questionDrafts[qi + 1]];
      renderQ();
    }));
    wrap.querySelectorAll(".q-duplicate").forEach((el) => el.addEventListener("click", () => {
      const qi = Number(el.dataset.qi);
      const clone = JSON.parse(JSON.stringify(questionDrafts[qi]));
      questionDrafts.splice(qi + 1, 0, clone);
      renderQ();
    }));
    wrap.querySelectorAll(".q-remove").forEach((el) => el.addEventListener("click", () => { questionDrafts.splice(Number(el.dataset.qi), 1); renderQ(); }));
  }
  renderQ();

  overlay.querySelector("#em-course-id").addEventListener("change", (e) => {
    const courseInput = overlay.querySelector("#em-course");
    if (!courseInput.value.trim() && e.target.value) {
      const picked = courses.find((cc) => cc.id === e.target.value);
      if (picked) courseInput.value = picked.title;
    }
  });
  overlay.querySelector("#em-add-question-btn").addEventListener("click", () => {
    questionDrafts.push({ text: "", options: ["", "", "", ""], correctIndex: 0 });
    renderQ();
    const cards = overlay.querySelectorAll(".q-card");
    cards[cards.length - 1]?.querySelector(".q-text-input")?.focus();
  });

  /* ---------- Bulk import: paste text to add many questions at once ---------- */
  function parseBulkQuestions(raw) {
    const blocks = raw.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const parsed = [];
    blocks.forEach((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 3) return;
      const qText = lines[0].replace(/^(question\s*[:\-]\s*)/i, "").replace(/^\d+[).]\s*/, "").trim();
      const options = [];
      let correctIndex = 0;
      lines.slice(1).forEach((line) => {
        let isCorrect = false;
        let opt = line;
        if (opt.startsWith("*")) { isCorrect = true; opt = opt.slice(1).trim(); }
        opt = opt.replace(/^[A-Fa-f]\)\s*/, "").replace(/^\d+[).]\s*/, "").replace(/^[-•]\s*/, "").trim();
        if (!opt) return;
        if (isCorrect) correctIndex = options.length;
        options.push(opt);
      });
      if (qText && options.length >= 2) parsed.push({ text: qText, options: options.slice(0, MAX_OPTIONS), correctIndex: Math.min(correctIndex, options.length - 1) });
    });
    return parsed;
  }

  const bulkPanel = overlay.querySelector("#em-bulk-panel");
  overlay.querySelector("#em-bulk-toggle-btn").addEventListener("click", () => { bulkPanel.hidden = !bulkPanel.hidden; });
  overlay.querySelector("#em-bulk-cancel-btn").addEventListener("click", () => { bulkPanel.hidden = true; overlay.querySelector("#em-bulk-text").value = ""; });
  overlay.querySelector("#em-bulk-import-btn").addEventListener("click", () => {
    const raw = overlay.querySelector("#em-bulk-text").value.trim();
    if (!raw) { toast("Please paste the questions first", "error"); return; }
    const parsed = parseBulkQuestions(raw);
    if (!parsed.length) { toast("No questions found in the correct format, please follow the example", "error"); return; }
    questionDrafts.push(...parsed);
    renderQ();
    bulkPanel.hidden = true;
    overlay.querySelector("#em-bulk-text").value = "";
    toast(`${parsed.length} question(s) added`, "success");
  });

  overlay.querySelector("#exam-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleInput = overlay.querySelector("#em-title");
    if (!titleInput.value.trim()) {
      switchExamTab("settings");
      toast("Please enter an exam title", "error");
      titleInput.focus();
      return;
    }
    if (!questionDrafts.length) { switchExamTab("questions"); toast("Please add at least one question", "error"); return; }
    if (questionDrafts.some((q) => !q.text.trim() || q.options.some((o) => !o.trim()))) { switchExamTab("questions"); toast("Please fill in all questions and options", "error"); return; }

    const courseIdVal = overlay.querySelector("#em-course-id").value || "";
    const scopeVal = courseIdVal ? overlay.querySelector("#em-scope").value : "course";
    const checkedLessons = scopeVal === "lessons"
      ? Array.from(overlay.querySelectorAll("#em-lesson-picker input[type=checkbox]:checked"))
      : [];
    if (courseIdVal && scopeVal === "lessons" && !checkedLessons.length) {
      switchExamTab("settings");
      toast("Please select at least one lesson, or switch to Whole Course", "error");
      return;
    }

    const btn = overlay.querySelector("#exam-modal-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const payload = {
        title: overlay.querySelector("#em-title").value.trim(),
        description: overlay.querySelector("#em-desc").value.trim(),
        courseName: overlay.querySelector("#em-course").value.trim(),
        courseId: courseIdVal,
        lessonIds: checkedLessons.map((cb) => cb.value),
        lessonNames: checkedLessons.map((cb) => cb.dataset.title),
        duration: Number(overlay.querySelector("#em-duration").value) || 10,
        questionCount: questionDrafts.length,
        maxAttempts: Math.max(0, Number(overlay.querySelector("#em-max-attempts").value) || 0),
        negativeMarking: Math.max(0, Number(overlay.querySelector("#em-negative-marking").value) || 0),
        layout: overlay.querySelector("#em-layout").value === "all" ? "all" : "one",
        shuffle: overlay.querySelector("#em-shuffle").checked,
      };

      // Publish schedule — leave empty for "publish now", leave hours empty/0 for "unlimited"
      const publishRaw = overlay.querySelector("#em-publish-at").value;
      const hoursRaw = overlay.querySelector("#em-available-hours").value.trim();
      const publishDate = publishRaw ? new Date(publishRaw) : new Date();
      const availableHours = hoursRaw ? Math.max(0, Number(hoursRaw)) : 0;
      payload.publishAt = Timestamp.fromDate(publishDate);
      payload.availableHours = availableHours;
      payload.closesAt = availableHours > 0 ? Timestamp.fromDate(new Date(publishDate.getTime() + availableHours * 3600000)) : null;

      let examRef;
      if (ex) {
        examRef = doc(db, "exams", ex.id);
        await updateDoc(examRef, payload);
        const oldQ = await getDocs(collection(db, "exams", ex.id, "questions"));
        await Promise.all(oldQ.docs.map((d) => deleteDoc(d.ref)));
      } else {
        examRef = await addDoc(collection(db, "exams"), { ...payload, createdAt: serverTimestamp() });
      }
      await Promise.all(
        questionDrafts.map((q, i) => addDoc(collection(db, "exams", examRef.id, "questions"), { text: q.text, options: q.options, correctIndex: q.correctIndex, order: i }))
      );
      toast(ex ? "Exam updated" : "Exam created", "success");
      closeModal();
      loadExamsTable();
      loadOverview();
    } catch {
      toast("Could not save", "error");
      btn.disabled = false;
      btn.textContent = ex ? "Save Changes" : "Publish Exam";
    }
  });
}

async function deleteExam(examId) {
  const ex = currentExams.find((x) => x.id === examId);
  if (!(await confirmAction(`Do you want to delete the exam "${ex?.title || ""}"?`))) return;
  try {
    const qSnap = await getDocs(collection(db, "exams", examId, "questions"));
    await Promise.all(qSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "exams", examId));
    toast("Exam deleted", "success");
    loadExamsTable();
    loadOverview();
  } catch {
    toast("Could not delete", "error");
  }
}

/* ==========================================================================
   User management
   ========================================================================== */
let allUsers = [];
async function loadUsersTable() {
  const tbody = document.querySelector("#users-table tbody");
  const snap = await getDocs(collection(db, "users"));
  allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderUsersTable(allUsers);
  document.getElementById("user-search-input").addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
    const filtered = allUsers.filter(
      (u) => (u.displayName || "").toLowerCase().includes(term) || (u.email || "").toLowerCase().includes(term)
    );
    renderUsersTable(filtered);
  });
}

function renderUsersTable(list) {
  const tbody = document.querySelector("#users-table tbody");
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No users found</div></td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((u) => {
      const deviceCount = u.deviceCount || 0;
      const multiDevice = deviceCount > 1;
      return `
    <tr class="user-row" data-view-user="${u.id}">
      <td data-label="User"><div class="cell-title">${u.photoURL ? `<img src="${u.photoURL}" alt="">` : ""}<div><div class="t">${escapeHtml(u.displayName || "")}${multiDevice ? ` <span class="badge badge-coral device-warning-badge" title="Multiple different devices detected logging in/signing up"><i class="fa-solid fa-triangle-exclamation"></i> ${deviceCount} devices</span>` : ""}</div><div class="s">${escapeHtml(u.email || "")}</div></div></div></td>
      <td data-label="Enrolled">${(u.enrolledCourses || []).length}</td>
      <td data-label="Joined">${formatDate(u.createdAt)}</td>
      <td data-label="Admin">
        <label class="switch" onclick="event.stopPropagation()"><input type="checkbox" data-toggle-admin="${u.id}" ${u.isAdmin ? "checked" : ""}><span class="knob"></span></label>
      </td>
    </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-view-user]").forEach((row) =>
    row.addEventListener("click", () => viewUserDevices(row.dataset.viewUser))
  );

  tbody.querySelectorAll("[data-toggle-admin]").forEach((cb) =>
    cb.addEventListener("change", async () => {
      const uid = cb.dataset.toggleAdmin;
      const isSelf = uid === me.user.uid;
      if (isSelf && !cb.checked && !(await confirmAction("Revoke your own admin privileges? This will remove you from this panel."))) {
        cb.checked = true;
        return;
      }
      try {
        await updateDoc(doc(db, "users", uid), { isAdmin: cb.checked });
        toast("Updated", "success");
        if (isSelf && !cb.checked) {
          setTimeout(() => (window.location.href = "index.html"), 700);
        }
      } catch {
        toast("Could not update", "error");
        cb.checked = !cb.checked;
      }
    })
  );
}

/* ---------- User's device list (which phones/browsers were used to log in/sign up) ---------- */
async function viewUserDevices(uid) {
  const u = allUsers.find((x) => x.id === uid);
  if (!u) return;

  openModal(`
    <div class="modal-head"><h3>Device & Login Info</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <div class="cell-title mb-16">${u.photoURL ? `<img src="${u.photoURL}" alt="">` : ""}<div><div class="t">${escapeHtml(u.displayName || "")}</div><div class="s">${escapeHtml(u.email || "")}</div></div></div>
    <div id="user-devices-list"><div class="loading-screen"><span class="spinner"></span></div></div>
  `);

  try {
    const snap = await getDocs(query(collection(db, "users", uid, "devices"), orderBy("lastSeen", "desc")));
    const devices = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUserDevicesList(devices);
  } catch {
    const el = document.getElementById("user-devices-list");
    if (el) el.innerHTML = `<div class="empty-state">Could not load device information</div>`;
  }
}

function renderUserDevicesList(devices) {
  const el = document.getElementById("user-devices-list");
  if (!el) return;
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
}

/* ==========================================================================
   Purchase Requests + payment settings + access code email
   ========================================================================== */
let currentPurchases = [];

async function loadPaymentSettings() {
  const snap = await getDoc(doc(db, "settings", "payment"));
  const s = snap.exists() ? snap.data() : {};
  document.getElementById("ps-bkash").value = s.bkashNumber || "";
  document.getElementById("ps-nagad").value = s.nagadNumber || "";
  document.getElementById("ps-rocket").value = s.rocketNumber || "";
  document.getElementById("ps-type").value = s.paymentType || "Send Money";

  document.getElementById("payment-settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("payment-settings-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await setDoc(doc(db, "settings", "payment"), {
        bkashNumber: document.getElementById("ps-bkash").value.trim(),
        nagadNumber: document.getElementById("ps-nagad").value.trim(),
        rocketNumber: document.getElementById("ps-rocket").value.trim(),
        paymentType: document.getElementById("ps-type").value.trim() || "Send Money",
      }, { merge: true });
      toast("Payment settings saved", "success");
    } catch {
      toast("Could not save", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
}

async function loadPurchasesTable() {
  const tbody = document.querySelector("#purchases-table tbody");
  try {
    // Fetched without orderBy() on purpose — see the note in exam.js loadExamList().
    const snap = await getDocs(collection(db, "purchaseRequests"));
    currentPurchases = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  } catch {
    currentPurchases = [];
  }

  const pendingCount = currentPurchases.filter((p) => p.status === "pending").length;
  const badge = document.getElementById("nav-pending-badge");
  if (badge) {
    badge.textContent = pendingCount;
    badge.classList.toggle("hidden", pendingCount === 0);
  }

  if (!currentPurchases.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon"><i class="fa-solid fa-money-bill-wave"></i></div><p>No purchase requests yet</p></div></td></tr>`;
    return;
  }

  const statusBadge = (s) =>
    s === "approved" ? `<span class="badge badge-teal">Approved</span>` :
    s === "rejected" ? `<span class="badge badge-coral">Rejected</span>` :
    `<span class="badge badge-amber">Pending</span>`;

  tbody.innerHTML = currentPurchases
    .map((p) => `
    <tr>
      <td data-label="User"><div class="cell-title"><div><div class="t">${escapeHtml(p.userName || "")}</div><div class="s">${escapeHtml(p.userEmail || "")}${p.phone ? " · " + escapeHtml(p.phone) : ""}</div></div></div></td>
      <td data-label="Course">${escapeHtml(p.courseTitle || "")}</td>
      <td data-label="Payment">${escapeHtml(p.paymentMethod || "")}${p.senderNumber ? `<div class="s" style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(p.senderNumber)}${p.transactionId ? " · TxnID: " + escapeHtml(p.transactionId) : ""}</div>` : ""}</td>
      <td data-label="Amount">৳${p.amount || 0}</td>
      <td data-label="Status">${statusBadge(p.status)}</td>
      <td data-label=""><div class="row-actions">
        ${p.status === "pending" ? `
          <button class="icon-btn" data-approve="${p.id}" title="Approve"><i class="fa-solid fa-check"></i></button>
          <button class="icon-btn danger" data-reject="${p.id}" title="Reject"><i class="fa-solid fa-xmark"></i></button>
        ` : `<button class="icon-btn" data-view="${p.id}" title="Details"><i class="fa-solid fa-eye"></i></button>`}
        <button class="icon-btn" data-pdf="${p.id}" title="Download PDF"><i class="fa-solid fa-file-pdf"></i></button>
      </div></td>
    </tr>`)
    .join("");

  tbody.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => approvePurchase(b.dataset.approve)));
  tbody.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => rejectPurchase(b.dataset.reject)));
  tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewPurchaseDetail(b.dataset.view)));
  tbody.querySelectorAll("[data-pdf]").forEach((b) => b.addEventListener("click", () => downloadPurchasePdf(b.dataset.pdf, b)));
}

function viewPurchaseDetail(id) {
  const p = currentPurchases.find((x) => x.id === id);
  if (!p) return;
  const overlay = openModal(`
    <div class="modal-head"><h3>Purchase Request Details</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <div class="purchase-detail-list">
      <div><b>User:</b> ${escapeHtml(p.userName || "")} (${escapeHtml(p.userEmail || "")})</div>
      <div><b>Phone:</b> ${escapeHtml(p.phone || "")}</div>
      <div><b>Course:</b> ${escapeHtml(p.courseTitle || "")}</div>
      <div><b>Method:</b> ${escapeHtml(p.paymentMethod || "")} — ${escapeHtml(p.senderNumber || "")}</div>
      <div><b>Amount:</b> ৳${p.amount || 0}</div>
      ${p.transactionId ? `<div><b>Transaction ID:</b> ${escapeHtml(p.transactionId)}</div>` : ""}
      <div><b>Status:</b> ${escapeHtml(p.status)}</div>
      ${p.accessCode ? `<div><b>Access Code:</b> ${escapeHtml(formatAccessCodeForDisplay(p.accessCode))}</div>` : ""}
    </div>
    <button type="button" class="btn btn-primary btn-block mt-16" id="purchase-detail-pdf-btn"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
  `);
  overlay.querySelector("#purchase-detail-pdf-btn")?.addEventListener("click", (e) => downloadPurchasePdf(p.id, e.currentTarget));
}

/* ---------- Export a single purchase/order as a PDF receipt — one course,
   one user, one order. Card-style box layout with colour-coded status badge. ---------- */
async function downloadPurchasePdf(id, triggerBtn) {
  const p = currentPurchases.find((x) => x.id === id);
  if (!p) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast("Couldn't load the PDF engine. Check your connection and try again.", "error"); return; }

  const originalHtml = triggerBtn?.innerHTML;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  }

  try {
    const logoImg = await loadLeaderboardLogo();

    /* ── Canvas size: compact card, not A4 ── */
    const W = 440, H = 620;
    const doc = new jsPDF({ unit: "pt", format: [W, H], orientation: "portrait" });

    /* ── Helpers ── */
    const hex = (h) => {
      h = h.replace("#", "");
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    };
    const setFill  = (c) => { const [r,g,b]=hex(c); doc.setFillColor(r,g,b); };
    const setDraw  = (c) => { const [r,g,b]=hex(c); doc.setDrawColor(r,g,b); };
    const setTxt   = (c) => { const [r,g,b]=hex(c); doc.setTextColor(r,g,b); };

    /* ── Palette ── */
    const BG       = "#f4f6fb";
    const CARD     = "#ffffff";
    const ACCENT   = "#4f46e5";   // indigo
    const LABEL_C  = "#6b7280";
    const VAL_C    = "#111827";
    const DIV_C    = "#e5e7eb";
    const STATUS_COLORS = {
      approved : { bg: "#d1fae5", text: "#065f46", dot: "#10b981" },
      rejected : { bg: "#fee2e2", text: "#991b1b", dot: "#ef4444" },
      pending  : { bg: "#fef3c7", text: "#92400e", dot: "#f59e0b" },
    };

    /* ── Background ── */
    setFill(BG);
    doc.rect(0, 0, W, H, "F");

    /* ── Main card ── */
    const pad = 24, cardX = pad, cardY = 16, cardW = W - pad*2, cardH = H - 32;
    setFill(CARD);
    setDraw(DIV_C);
    doc.setLineWidth(0.5);
    doc.roundedRect(cardX, cardY, cardW, cardH, 10, 10, "FD");

    /* ── Header band ── */
    setFill(ACCENT);
    doc.roundedRect(cardX, cardY, cardW, 72, 10, 10, "F");
    // cover bottom-rounded corners of header band
    setFill(ACCENT);
    doc.rect(cardX, cardY + 52, cardW, 20, "F");

    /* logo + brand */
    if (logoImg) {
      doc.addImage(logoImg, "PNG", cardX + 16, cardY + 16, 34, 34);
    }
    doc.setFont(undefined, "bold");
    doc.setFontSize(15);
    setTxt("#ffffff");
    doc.text("Tech Verse Course", cardX + (logoImg ? 58 : 16), cardY + 34);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(200, 200, 240);
    doc.text("Course Purchase Receipt", cardX + (logoImg ? 58 : 16), cardY + 48);

    /* ── Status badge (top-right of card) ── */
    const statusKey = (p.status === "approved" || p.status === "rejected") ? p.status : "pending";
    const sc = STATUS_COLORS[statusKey];
    const statusLabel = statusKey.charAt(0).toUpperCase() + statusKey.slice(1);
    const badgeW = 72, badgeH = 20, badgeX = cardX + cardW - badgeW - 14, badgeY = cardY + 26;
    const [bR,bG,bB] = hex(sc.bg);
    doc.setFillColor(bR, bG, bB);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 4, 4, "F");
    const [tR,tG,tB] = hex(sc.text);
    doc.setTextColor(tR, tG, tB);
    const [dR,dG,dB] = hex(sc.dot);
    doc.setFillColor(dR, dG, dB);
    doc.circle(badgeX + 10, badgeY + 10, 3.5, "F");
    doc.setFont(undefined, "bold");
    doc.setFontSize(8.5);
    doc.text(statusLabel, badgeX + 17, badgeY + 13.5);

    /* ── Course title block ── */
    let y = cardY + 88;
    setTxt(ACCENT);
    doc.setFont(undefined, "bold");
    doc.setFontSize(13);
    const courseName = p.courseTitle || "Course";
    const courseLines = doc.splitTextToSize(courseName, cardW - 32);
    doc.text(courseLines, cardX + 16, y);
    y += courseLines.length * 17 + 6;

    /* Order ID pill */
    setFill("#eef2ff");
    doc.roundedRect(cardX + 16, y, cardW - 32, 18, 4, 4, "F");
    setTxt("#4338ca");
    doc.setFont(undefined, "normal");
    doc.setFontSize(7.5);
    doc.text(`ORDER ID: ${p.id}`, cardX + 22, y + 12);
    y += 28;

    /* ── Divider ── */
    setDraw(DIV_C);
    doc.setLineWidth(0.5);
    doc.line(cardX + 16, y, cardX + cardW - 16, y);
    y += 16;

    /* ── Info rows in two columns ── */
    const col1X = cardX + 16;
    const col2X = cardX + cardW / 2 + 4;
    const colW  = cardW / 2 - 24;

    const infoCell = (label, value, x, cy) => {
      doc.setFont(undefined, "normal");
      doc.setFontSize(7.5);
      setTxt(LABEL_C);
      doc.text(label.toUpperCase(), x, cy);
      cy += 12;
      doc.setFont(undefined, "bold");
      doc.setFontSize(9.5);
      setTxt(VAL_C);
      const vLines = doc.splitTextToSize(String(value || "—"), colW);
      doc.text(vLines, x, cy);
      return cy + vLines.length * 12 + 10;
    };

    /* Row 1: Name | Email */
    const r1L = infoCell("Student Name", p.userName, col1X, y);
    const r1R = infoCell("Email", p.userEmail, col2X, y);
    y = Math.max(r1L, r1R);

    /* Row 2: Phone | Payment Method */
    const payVal = `${p.paymentMethod || "—"}${p.senderNumber ? ` (${p.senderNumber})` : ""}`;
    const r2L = infoCell("Phone", p.phone, col1X, y);
    const r2R = infoCell("Payment Method", payVal, col2X, y);
    y = Math.max(r2L, r2R);

    /* Row 3: Transaction ID | Amount */
    if (p.transactionId) {
      const r3L = infoCell("Transaction ID", p.transactionId, col1X, y);
      const r3R = infoCell("Amount Paid", `\u09F3${p.amount || 0}`, col2X, y);
      y = Math.max(r3L, r3R);
    } else {
      y = infoCell("Amount Paid", `\u09F3${p.amount || 0}`, col1X, y);
    }

    /* Row 4: Requested On | Reviewed On */
    const r4L = infoCell("Requested On", formatDateTime(p.createdAt), col1X, y);
    const r4R = p.reviewedAt ? infoCell("Reviewed On", formatDateTime(p.reviewedAt), col2X, y) : y;
    y = Math.max(r4L, typeof r4R === "number" ? r4R : y);

    /* ── Access Code highlighted box (if approved) ── */
    if (p.status === "approved" && p.accessCode) {
      y += 4;
      setDraw(DIV_C);
      doc.line(cardX + 16, y, cardX + cardW - 16, y);
      y += 14;

      setFill("#f0fdf4");
      const [acR,acG,acB] = hex("#bbf7d0");
      doc.setDrawColor(acR, acG, acB);
      doc.setLineWidth(1);
      doc.roundedRect(cardX + 16, y, cardW - 32, 44, 6, 6, "FD");

      doc.setFont(undefined, "normal");
      doc.setFontSize(7.5);
      setTxt("#166534");
      doc.text("ACCESS CODE", cardX + 26, y + 14);

      doc.setFont(undefined, "bold");
      doc.setFontSize(14);
      setTxt("#15803d");
      doc.text(formatAccessCodeForDisplay(p.accessCode), cardX + 26, y + 33);
      y += 56;
    }

    /* ── Footer ── */
    y = cardY + cardH - 30;
    setDraw(DIV_C);
    doc.line(cardX + 16, y, cardX + cardW - 16, y);
    y += 14;
    setTxt(LABEL_C);
    doc.setFont(undefined, "normal");
    doc.setFontSize(7.5);
    doc.text("Thank you for your purchase · Tech Verse Course", cardX + 16, y);
    doc.setFontSize(7);
    doc.text(`Generated ${new Date().toLocaleDateString("en-GB")}`, cardX + cardW - 16, y, { align: "right" });

    /* ── Watermark ── */
    if (logoImg) {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.04 }));
      const wmS = 220;
      doc.addImage(logoImg, "PNG", (W - wmS)/2, (H - wmS)/2, wmS, wmS, undefined, undefined, 30);
      doc.restoreGraphicsState();
    }

    const safeName   = (p.userName   || "user"  ).replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 40);
    const safeCourse = (p.courseTitle || "course").replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 40);
    doc.save(`${safeName}_${safeCourse}_receipt.pdf`);
  } catch (err) {
    console.error(err);
    toast("Failed to generate the PDF. Please try again.", "error");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = originalHtml;
    }
  }
}

/* Generate a random 25-character access code — retries if the code is already taken */
async function generateUniqueAccessCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Easy to read — excludes confusing characters (0,O,1,I)
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "";
    for (let i = 0; i < 25; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const snap = await getDoc(doc(db, "accessCodes", code));
    if (!snap.exists()) return code;
  }
  throw new Error("Could not generate code");
}

/* Insert a dash every 5 characters, purely for display/email — e.g. XXXXX-XXXXX-XXXXX-XXXXX-XXXXX */
function formatAccessCodeForDisplay(code) {
  return code.replace(/(.{5})(?=.)/g, "$1-");
}

async function approvePurchase(id) {
  const p = currentPurchases.find((x) => x.id === id);
  if (!p) return;
  if (!(await confirmAction(`Approve "${p.userName}"'s request to purchase "${p.courseTitle}"? An access code will be sent to their email.`, { danger: false, confirmLabel: "Yes, Approve" }))) return;

  try {
    const code = await generateUniqueAccessCode();
    await setDoc(doc(db, "accessCodes", code), {
      uid: p.uid,
      courseId: p.courseId,
      requestId: p.id,
      used: false,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "purchaseRequests", p.id), {
      status: "approved",
      accessCode: code,
      reviewedAt: serverTimestamp(),
    });

    const emailSent = await sendAccessCodeEmail(p, code);
    toast(emailSent ? "Approved and email sent" : "Approved, but the email could not be sent — please send the code manually", emailSent ? "success" : "error");
    loadPurchasesTable();
  } catch (err) {
    toast("Could not approve, please try again", "error");
  }
}

async function rejectPurchase(id) {
  const p = currentPurchases.find((x) => x.id === id);
  if (!p) return;
  if (!(await confirmAction(`Reject "${p.userName}"'s request?`))) return;
  try {
    await updateDoc(doc(db, "purchaseRequests", p.id), { status: "rejected", reviewedAt: serverTimestamp() });
    toast("Request rejected", "success");
    loadPurchasesTable();
  } catch {
    toast("Could not reject", "error");
  }
}

/* ---------- Send the access-code email via EmailJS ----------
   Create a Service and Template in the EmailJS dashboard and put the two IDs below.
   Use these variables in your template:
   {{to_name}}, {{to_email}}, {{course_title}}, {{access_code}}, {{site_url}} */
const EMAILJS_SERVICE_ID = "service_z81iazm";
const EMAILJS_TEMPLATE_ID = "template_ubim59m";

async function sendAccessCodeEmail(purchase, code) {
  if (typeof emailjs === "undefined") return false;
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_name: purchase.userName || "",
      to_email: purchase.userEmail || "",
      course_title: purchase.courseTitle || "",
      access_code: formatAccessCodeForDisplay(code),
      site_url: window.location.origin + "/#/course?id=" + purchase.courseId,
    });
    return true;
  } catch (err) {
    console.error("EmailJS send failed:", err);
    return false;
  }
}

/* ==========================================================================
   Leaderboard — every user's exam results, ranked, for gift/reward decisions
   ========================================================================== */
let allResults = [];
let resultsLoaded = false;

async function initLeaderboardSection() {
  if (!currentExams.length) await loadExamsTable();
  if (!allUsers.length) await loadUsersTable();
  populateLeaderboardExamSelect();
  // Re-fetched every time this tab is opened (rather than cached forever) since new
  // submissions can come in at any time and the admin relies on this being current.
  const list = document.getElementById("leaderboard-list");
  list.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(collection(db, "results"));
    allResults = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    resultsLoaded = true;
  } catch {
    list.innerHTML = `<div class="empty-state"><p>Could not load results — make sure the Firestore rule for "results" includes <code>|| isAdmin()</code> on read (see README)</p></div>`;
    return;
  }
  renderLeaderboard();
}

function populateLeaderboardExamSelect() {
  const sel = document.getElementById("lb-exam-select");
  const prevValue = sel.value;
  sel.innerHTML =
    `<option value="">All Exams (Combined)</option>` +
    currentExams.map((ex) => `<option value="${ex.id}">${escapeHtml(ex.title)}</option>`).join("");
  if (prevValue && currentExams.some((ex) => ex.id === prevValue)) sel.value = prevValue;
}

function usersMapCache() {
  const map = {};
  allUsers.forEach((u) => (map[u.id] = u));
  return map;
}

function lbRankBadge(rank) {
  if (rank === 1) return `<span class="lb-rank lb-rank-1"><i class="fa-solid fa-trophy"></i> 1</span>`;
  if (rank === 2) return `<span class="lb-rank lb-rank-2"><i class="fa-solid fa-medal"></i> 2</span>`;
  if (rank === 3) return `<span class="lb-rank lb-rank-3"><i class="fa-solid fa-medal"></i> 3</span>`;
  return `<span class="lb-rank">${rank}</span>`;
}

// A small pill showing just the score — the one thing worth seeing at a
// glance in the collapsed row, alongside name/email/photo/rank.
function lbScoreBadge(r, mode) {
  if (mode === "exam") {
    const pct = Math.max(0, Math.min(100, r.percent));
    return `<span class="lb-score-badge"><b>${formatScore(r.score)}</b>/${r.total} <span class="pct">${pct}%</span></span>`;
  }
  const avgPct = r.totalMax > 0 ? Math.max(0, Math.min(100, Math.round((r.totalScore / r.totalMax) * 100))) : 0;
  return `<span class="lb-score-badge"><b>${formatScore(r.totalScore)}</b>/${r.totalMax} <span class="pct">${avgPct}%</span></span>`;
}

// Full breakdown shown only once a row is tapped open.
function lbDetailHtml(r, mode) {
  const items =
    mode === "exam"
      ? [
          { l: "Correct", v: r.correctCount ?? "—" },
          { l: "Wrong", v: r.wrongCount ?? "—" },
          { l: "Unanswered", v: r.unansweredCount ?? "—" },
          { l: "Time Taken", v: r.timeTakenSeconds != null ? formatDuration(r.timeTakenSeconds) : "—" },
          { l: "Attempt", v: r.attemptNumber },
          { l: "Submitted", v: formatDateTime(r.submittedAt) },
        ]
      : [
          { l: "Exams Taken", v: r.examsTaken },
          { l: "Avg Score", v: `${r.totalMax > 0 ? Math.max(0, Math.min(100, Math.round((r.totalScore / r.totalMax) * 100))) : 0}%` },
          { l: "Total Time", v: formatDuration(r.totalTime) },
          { l: "Last Activity", v: r.lastSubmittedTs ? formatDateTime(r.lastSubmittedTs) : "—" },
        ];
  return `<div class="lb-detail-grid">${items.map((it) => `<div class="lb-detail-item"><span class="l">${it.l}</span><span class="v">${it.v}</span></div>`).join("")}</div>`;
}

function renderLeaderboard() {
  const examId = document.getElementById("lb-exam-select").value;
  const sortMode = document.getElementById("lb-sort-select").value;
  const searchTerm = document.getElementById("lb-search-input").value.trim().toLowerCase();
  const usersMap = usersMapCache();
  const statGrid = document.getElementById("lb-stat-grid");
  const mode = examId ? "exam" : "combined";

  let rows;
  if (mode === "exam") {
    rows = allResults
      .filter((r) => r.examId === examId)
      .map((r) => ({
        uid: r.uid,
        score: Number(r.score) || 0,
        total: r.total || 0,
        percent: r.percent ?? Math.round(((Number(r.score) || 0) / (r.total || 1)) * 100),
        correctCount: r.correctCount,
        wrongCount: r.wrongCount,
        unansweredCount: r.unansweredCount,
        timeTakenSeconds: r.timeTakenSeconds,
        attemptNumber: r.attemptNumber || 1,
        submittedAt: r.submittedAt,
      }));
  } else {
    const byUser = {};
    allResults.forEach((r) => {
      if (!byUser[r.uid]) byUser[r.uid] = { uid: r.uid, totalScore: 0, totalMax: 0, examsTaken: 0, totalTime: 0, lastSubmittedSec: 0, lastSubmittedTs: null };
      const agg = byUser[r.uid];
      agg.totalScore += Number(r.score) || 0;
      agg.totalMax += r.total || 0;
      agg.examsTaken += 1;
      agg.totalTime += Number(r.timeTakenSeconds) || 0;
      const sec = r.submittedAt?.seconds || 0;
      if (sec >= agg.lastSubmittedSec) { agg.lastSubmittedSec = sec; agg.lastSubmittedTs = r.submittedAt; }
    });
    rows = Object.values(byUser);
  }

  // ---------- Search filter (by user's display name or email) ----------
  if (searchTerm) {
    rows = rows.filter((r) => {
      const u = usersMap[r.uid];
      return (u?.displayName || "").toLowerCase().includes(searchTerm) || (u?.email || "").toLowerCase().includes(searchTerm);
    });
  }

  // ---------- Sort — "smart" considers score first, then speed as the tiebreaker, exactly
  // like a real exam leaderboard (whoever scored highest wins; if tied, whoever finished
  // faster wins; if still tied, whoever submitted first wins) ----------
  if (mode === "exam") {
    if (sortMode === "recent") rows.sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    else if (sortMode === "fastest") rows.sort((a, b) => (a.timeTakenSeconds ?? Infinity) - (b.timeTakenSeconds ?? Infinity) || b.score - a.score);
    else rows.sort((a, b) => b.score - a.score || (a.timeTakenSeconds ?? Infinity) - (b.timeTakenSeconds ?? Infinity) || (a.submittedAt?.seconds || 0) - (b.submittedAt?.seconds || 0));
  } else {
    if (sortMode === "recent") rows.sort((a, b) => b.lastSubmittedSec - a.lastSubmittedSec);
    else if (sortMode === "fastest") rows.sort((a, b) => a.totalTime - b.totalTime || b.totalScore - a.totalScore);
    else rows.sort((a, b) => b.totalScore - a.totalScore || a.totalTime - b.totalTime);
  }

  // ---------- Stat summary cards ----------
  if (!rows.length) {
    statGrid.innerHTML = "";
  } else if (mode === "exam") {
    const avgScore = rows.reduce((s, r) => s + r.score, 0) / rows.length;
    const topScore = rows[0]?.score ?? 0;
    const timesKnown = rows.filter((r) => r.timeTakenSeconds != null);
    const avgTime = timesKnown.length ? timesKnown.reduce((s, r) => s + r.timeTakenSeconds, 0) / timesKnown.length : null;
    statGrid.innerHTML = [
      { n: rows.length, l: "Participants" },
      { n: formatScore(topScore), l: "Top Score" },
      { n: formatScore(Math.round(avgScore * 100) / 100), l: "Average Score" },
      { n: avgTime != null ? formatDuration(avgTime) : "—", l: "Average Time" },
    ].map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`).join("");
  } else {
    const avgTotal = rows.reduce((s, r) => s + r.totalScore, 0) / rows.length;
    statGrid.innerHTML = [
      { n: rows.length, l: "Active Users" },
      { n: formatScore(rows[0]?.totalScore ?? 0), l: "Top Total Score" },
      { n: formatScore(Math.round(avgTotal * 100) / 100), l: "Average Total Score" },
    ].map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`).join("");
  }

  // ---------- Compact tap-to-expand rows (thin, so the whole board fits without side-scrolling;
  // tapping a row reveals the full breakdown that used to live in extra table columns) ----------
  const list = document.getElementById("leaderboard-list");
  if (!rows.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-trophy"></i></div><p>${mode === "exam" ? "No one has taken this exam yet" : "No exam results yet"}</p></div>`;
  } else {
    list.innerHTML = rows
      .map((r, i) => {
        const u = usersMap[r.uid];
        const name = u?.displayName || u?.email || "Unknown User";
        const initial = (u?.displayName || u?.email || "?").trim().charAt(0).toUpperCase();
        const avatar = u?.photoURL ? `<img src="${u.photoURL}" alt="">` : `<span>${escapeHtml(initial)}</span>`;
        return `
        <div class="lb-row">
          <button type="button" class="lb-row-main" aria-expanded="false">
            ${lbRankBadge(i + 1)}
            <span class="lb-avatar">${avatar}</span>
            <span class="lb-row-id">
              <span class="lb-row-name">${escapeHtml(name)}</span>
              <span class="lb-row-email">${escapeHtml(u?.email || "")}</span>
            </span>
            ${lbScoreBadge(r, mode)}
            <i class="fa-solid fa-chevron-down lb-row-caret"></i>
          </button>
          <div class="lb-row-detail hidden">${lbDetailHtml(r, mode)}</div>
        </div>`;
      })
      .join("");
  }

  document.getElementById("lb-export-btn").onclick = () => exportLeaderboardCsv(mode, rows, usersMap, examId);
  document.getElementById("lb-export-pdf-btn").onclick = () => exportLeaderboardPdf(mode, rows, usersMap, examId);
}

// Event delegation — the list is fully re-rendered on every filter/sort/search
// change, so a single listener on the container (bound once, below) handles
// taps for whichever rows currently exist rather than rebinding per-row.
function handleLeaderboardListClick(e) {
  const btn = e.target.closest(".lb-row-main");
  if (!btn) return;
  const row = btn.closest(".lb-row");
  const detail = row?.querySelector(".lb-row-detail");
  if (!detail) return;
  const isOpen = !detail.classList.contains("hidden");
  detail.classList.toggle("hidden", isOpen);
  btn.setAttribute("aria-expanded", String(!isOpen));
  row.classList.toggle("open", !isOpen);
}
document.getElementById("leaderboard-list")?.addEventListener("click", handleLeaderboardListClick);

/* ---------- Export the currently-shown leaderboard as a CSV file (client-side, no backend needed) ---------- */
function exportLeaderboardCsv(mode, rows, usersMap, examId) {
  if (!rows.length) { toast("Nothing to export", "error"); return; }
  const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  let header, lines;
  if (mode === "exam") {
    header = ["Rank", "Name", "Email", "Score", "Total", "Percent", "Correct", "Wrong", "Unanswered", "Time Taken (s)", "Attempt", "Submitted"];
    lines = rows.map((r, i) => {
      const u = usersMap[r.uid];
      return [i + 1, u?.displayName || "", u?.email || "", formatScore(r.score), r.total, r.percent, r.correctCount ?? "", r.wrongCount ?? "", r.unansweredCount ?? "", r.timeTakenSeconds ?? "", r.attemptNumber, formatDateTime(r.submittedAt)].map(csvCell).join(",");
    });
  } else {
    header = ["Rank", "Name", "Email", "Total Score", "Total Max", "Exams Taken", "Total Time (s)", "Last Activity"];
    lines = rows.map((r, i) => {
      const u = usersMap[r.uid];
      return [i + 1, u?.displayName || "", u?.email || "", formatScore(r.totalScore), r.totalMax, r.examsTaken, r.totalTime, r.lastSubmittedTs ? formatDateTime(r.lastSubmittedTs) : ""].map(csvCell).join(",");
    });
  }
  const csv = [header.map(csvCell).join(","), ...lines].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const examLabel = examId ? (currentExams.find((e) => e.id === examId)?.title || "exam") : "all-exams";
  a.href = url;
  a.download = `leaderboard-${examLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById("lb-exam-select")?.addEventListener("change", renderLeaderboard);
document.getElementById("lb-sort-select")?.addEventListener("change", renderLeaderboard);
document.getElementById("lb-search-input")?.addEventListener("input", renderLeaderboard);

/* ---------- Export the currently-shown leaderboard as a PDF, with the site
   logo as a faint rotated watermark on every page (uses jsPDF + autoTable,
   loaded via CDN in admin.html). ---------- */
let lbLogoImgCache = null;
function loadLeaderboardLogo() {
  if (lbLogoImgCache !== null) return Promise.resolve(lbLogoImgCache);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { lbLogoImgCache = img; resolve(img); };
    img.onerror = () => { lbLogoImgCache = false; resolve(false); };
    img.src = "assets/logo.png";
  });
}

async function exportLeaderboardPdf(mode, rows, usersMap, examId) {
  if (!rows.length) { toast("Nothing to export", "error"); return; }
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast("Couldn't load the PDF engine. Check your connection and try again.", "error"); return; }

  const pdfBtn = document.getElementById("lb-export-pdf-btn");
  pdfBtn.disabled = true;
  pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing...';

  try {
    const logoImg = await loadLeaderboardLogo();
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const examLabel = examId ? (currentExams.find((e) => e.id === examId)?.title || "Exam") : "All Exams (Combined)";

    const drawWatermark = () => {
      if (!logoImg) return;
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.07 }));
      const wmSize = 260;
      doc.addImage(logoImg, "PNG", (pageWidth - wmSize) / 2, (pageHeight - wmSize) / 2, wmSize, wmSize, undefined, undefined, 30);
      doc.restoreGraphicsState();
    };

    const drawHeader = () => {
      if (logoImg) doc.addImage(logoImg, "PNG", 30, 20, 30, 30);
      doc.setFontSize(15);
      doc.setFont(undefined, "bold");
      doc.setTextColor(0, 0, 0);
      doc.text("Tech Verse Course — Leaderboard", logoImg ? 68 : 30, 38);
      doc.setFontSize(9);
      doc.setFont(undefined, "normal");
      doc.setTextColor(110, 110, 110);
      doc.text(`${examLabel}  •  Generated ${new Date().toLocaleString()}`, logoImg ? 68 : 30, 52);
      doc.setTextColor(0, 0, 0);
    };

    let head, body;
    if (mode === "exam") {
      head = [["Rank", "Name", "Email", "Score", "Percent", "Correct", "Wrong", "Unanswered", "Time Taken", "Attempt", "Submitted"]];
      body = rows.map((r, i) => {
        const u = usersMap[r.uid];
        return [
          i + 1,
          u?.displayName || "—",
          u?.email || "—",
          `${formatScore(r.score)}/${r.total}`,
          `${Math.max(0, Math.min(100, r.percent))}%`,
          r.correctCount ?? "—",
          r.wrongCount ?? "—",
          r.unansweredCount ?? "—",
          r.timeTakenSeconds != null ? formatDuration(r.timeTakenSeconds) : "—",
          r.attemptNumber,
          formatDateTime(r.submittedAt),
        ];
      });
    } else {
      head = [["Rank", "Name", "Email", "Total Score", "Exams Taken", "Avg Score", "Total Time", "Last Activity"]];
      body = rows.map((r, i) => {
        const u = usersMap[r.uid];
        const avgPct = r.totalMax > 0 ? Math.max(0, Math.min(100, Math.round((r.totalScore / r.totalMax) * 100))) : 0;
        return [
          i + 1,
          u?.displayName || "—",
          u?.email || "—",
          `${formatScore(r.totalScore)}/${r.totalMax}`,
          r.examsTaken,
          `${avgPct}%`,
          formatDuration(r.totalTime),
          r.lastSubmittedTs ? formatDateTime(r.lastSubmittedTs) : "—",
        ];
      });
    }

    doc.autoTable({
      head,
      body,
      startY: 66,
      margin: { left: 30, right: 30 },
      styles: { fontSize: 8.5, cellPadding: 5 },
      headStyles: { fillColor: [124, 92, 252], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 246, 250] },
      didDrawPage: () => {
        drawWatermark();
        drawHeader();
      },
    });

    const safeLabel = examLabel.replace(/[^a-z0-9\u0980-\u09FF]+/gi, "-").toLowerCase().slice(0, 60);
    doc.save(`leaderboard-${safeLabel || "results"}.pdf`);
  } catch (err) {
    toast("Failed to generate the PDF. Please try again.", "error");
  } finally {
    pdfBtn.disabled = false;
    pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
  }
}

init();
