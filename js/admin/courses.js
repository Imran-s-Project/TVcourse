// ==========================================================================
// admin/courses.js — Course management
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, updateDoc, doc, addDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  toast, escapeHtml, formatDate, openModal, closeModal, confirmAction, priceBadgeHtml,
} from "../utils.js";
import { initRichEditor } from "../rich-text.js";
import { courses, refreshCourses } from "../admin.js";
import { loadOverview } from "./overview.js";
import { homepageSettings, saveHomepageSettings, renderFeaturedVideoList } from "./homepage.js";
import { refreshLessonCourseSelect } from "./lessons.js";

/* ==========================================================================
   Course management
   ========================================================================== */
export async function loadCoursesTable() {
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

// দিন/সপ্তাহ/মাস — কোর্সের মেয়াদ সিলেক্টের অপশন। label বাংলায়, value ইংরেজিতে
// স্টোর হয় যাতে পরে course.js-এ সহজে ফরম্যাট করা যায়।
const DURATION_UNITS = [
  { value: "day", label: "দিন" },
  { value: "week", label: "সপ্তাহ" },
  { value: "month", label: "মাস" },
];

function openCourseModal(courseId) {
  const c = courseId ? courses.find((x) => x.id === courseId) : null;
  const durationUnit = c?.durationUnit || "month";
  const overlay = openModal(`
    <div class="modal-head"><h3>${c ? "Edit Course" : "Create New Course"}</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <form id="course-modal-form">

      <div class="modal-section">
        <div class="modal-section-head"><i class="fa-solid fa-circle-info"></i> মৌলিক তথ্য</div>
        <div class="field"><label>Course Name</label><input type="text" id="cm-title" required value="${c ? escapeHtml(c.title) : ""}"></div>
        <div class="field"><label>Description</label><textarea id="cm-desc" rows="4">${c ? escapeHtml(c.description || "") : ""}</textarea></div>
        <div class="admin-grid">
          <div class="field"><label>Category</label><input type="text" id="cm-category" placeholder="e.g. Web Development" value="${c ? escapeHtml(c.category || "") : ""}"></div>
          <div class="field"><label>Instructor Name</label><input type="text" id="cm-instructor" value="${c ? escapeHtml(c.instructor || "") : ""}"></div>
        </div>
        <div class="field"><label>Cover Image URL</label><input type="url" id="cm-cover" placeholder="https://..." value="${c ? escapeHtml(c.coverImage || "") : ""}"></div>
      </div>

      <div class="modal-section">
        <div class="modal-section-head"><i class="fa-solid fa-layer-group"></i> কোর্সের ব্যাপ্তি ও টার্গেট</div>
        <p class="form-hint" style="margin-bottom:12px;">কোর্স পেজে ডেসক্রিপশনের ঠিক উপরে শিক্ষার্থীরা এই তথ্যগুলো দেখতে পাবে — কতজন ভর্তি আছে (স্বয়ংক্রিয়), আর নিচের তিনটা আপনি নিজে ঠিক করে দেবেন যাতে কেনার আগেই তারা বুঝতে পারে কী কী পাচ্ছে।</p>
        <div class="admin-grid">
          <div class="field"><label>মেয়াদ (সংখ্যা)</label><input type="number" id="cm-duration-value" min="0" placeholder="যেমনঃ 3" value="${c && c.durationValue ? c.durationValue : ""}"></div>
          <div class="field"><label>মেয়াদের একক</label>
            <select id="cm-duration-unit">
              ${DURATION_UNITS.map((u) => `<option value="${u.value}" ${u.value === durationUnit ? "selected" : ""}>${u.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="admin-grid">
          <div class="field"><label>মোট লেকচার (টার্গেট)</label><input type="number" id="cm-target-lessons" min="0" placeholder="যেমনঃ 40" value="${c && c.targetLessonCount ? c.targetLessonCount : ""}"></div>
          <div class="field"><label>মোট পরীক্ষা (টার্গেট)</label><input type="number" id="cm-target-exams" min="0" placeholder="যেমনঃ 8" value="${c && c.targetExamCount ? c.targetExamCount : ""}"></div>
        </div>
        <p class="form-hint" style="margin-top:-6px;margin-bottom:12px;"><i class="fa-solid fa-circle-info" style="color:var(--accent-amber-soft);margin-inline-end:5px;"></i>এই দুইটা সংখ্যা হলো আপনার প্ল্যান/টার্গেট — এখনো সবগুলো লেকচার বা পরীক্ষা আপলোড না করা থাকলেও, শিক্ষার্থীরা কোর্স পেজে দেখতে পাবে সর্বমোট কতগুলো তারা পুরো কোর্স জুড়ে পাবে। খালি রাখলে যা এখন পর্যন্ত আপলোড করা আছে সেটাই দেখাবে।</p>
      </div>

      <div class="modal-section">
        <div class="modal-section-head"><i class="fa-solid fa-lock"></i> মূল্য ও অ্যাক্সেস কোড</div>
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
  initRichEditor(overlay.querySelector("#cm-desc"));
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
      durationValue: Number(overlay.querySelector("#cm-duration-value").value) || 0,
      durationUnit: overlay.querySelector("#cm-duration-unit").value || "month",
      targetLessonCount: Number(overlay.querySelector("#cm-target-lessons").value) || 0,
      targetExamCount: Number(overlay.querySelector("#cm-target-exams").value) || 0,
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

