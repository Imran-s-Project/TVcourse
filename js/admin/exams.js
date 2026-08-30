// ==========================================================================
// admin/exams.js — Exam management
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, orderBy, updateDoc, doc, addDoc, deleteDoc, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  toast, escapeHtml, formatDateTime, openModal, closeModal, confirmAction,
  getExamAvailability, getCoursePricing, formatScore,
} from "../utils.js";
import { courses } from "../admin.js";
import { loadOverview } from "./overview.js";

/* ==========================================================================
   Exam management
   ========================================================================== */
export let currentExams = [];
export async function loadExamsTable() {
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
        <td data-label="Questions">${
          ex.questionsPerAttempt > 0 && ex.questionsPerAttempt < (ex.questionCount || 0)
            ? `${ex.questionsPerAttempt} <span class="muted" style="font-size:0.82em">/ ${ex.questionCount} bank</span>`
            : (ex.questionCount || 0)
        }</td>
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
  const poolBadge = ex.questionsPerAttempt > 0 && ex.questionsPerAttempt < (ex.questionCount || 0)
    ? `<span class="badge badge-teal" title="A random ${ex.questionsPerAttempt} of ${ex.questionCount} questions is drawn on every attempt"><i class="fa-solid fa-dice"></i> Random Pool</span>`
    : "";
  return `<div class="settings-badges">${attemptsBadge}${layoutBadge}${shuffleBadge}${negBadge}${poolBadge}</div>`;
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
    questionDrafts = qSnap.docs.map((d) => ({ text: d.data().text, options: d.data().options, correctIndex: d.data().correctIndex, explanation: d.data().explanation || "" }));
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
          <div class="schedule-box-title"><i class="fa-solid fa-shuffle"></i> Random Question Pool</div>
          <div class="field">
            <label>Questions Per Attempt (leave empty to show every question)</label>
            <input type="number" id="em-pool-size" min="0" placeholder="e.g. 25" value="${ex && ex.questionsPerAttempt ? ex.questionsPerAttempt : ""}">
            <span class="form-hint">
              Add as many questions as you like below (even 1000+) as your full question bank. If you set a number
              here, every attempt — for every student, every time — a fresh random set of that many questions is
              drawn from the full bank, so no two students (and no two attempts) are guaranteed to see the same
              questions. Leave empty to show the full bank to everyone, every time.
            </span>
          </div>
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
            <span class="form-hint">Paste each question separated by a blank line. First line is the question, then one option per line. Mark the correct option with a leading <b>*</b>. Optionally add a last line starting with <b>Explanation:</b> —</span>
            <pre class="qb-bulk-example">What is the capital of France?
*Paris
London
Berlin
Rome
Explanation: Paris has been the capital of France since the 12th century.</pre>
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
        <div class="field q-explanation-field">
          <label><i class="fa-solid fa-lightbulb"></i> Explanation <span class="form-hint" style="font-weight:400;">(optional — shown to students after they submit, explains why the correct answer is correct)</span></label>
          <textarea class="q-explanation-input" data-qi="${qi}" rows="2" placeholder="e.g. Paris has been the capital of France since...">${escapeHtml(q.explanation || "")}</textarea>
        </div>
      </div>`)
      .join("");

    wrap.querySelectorAll(".q-text-input").forEach((el) => el.addEventListener("input", () => (questionDrafts[el.dataset.qi].text = el.value)));
    wrap.querySelectorAll(".q-option-input").forEach((el) => el.addEventListener("input", () => (questionDrafts[el.dataset.qi].options[el.dataset.oi] = el.value)));
    wrap.querySelectorAll(".q-explanation-input").forEach((el) => el.addEventListener("input", () => (questionDrafts[el.dataset.qi].explanation = el.value)));

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
    questionDrafts.push({ text: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" });
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
      let explanation = "";
      lines.slice(1).forEach((line) => {
        const expMatch = line.match(/^explanation\s*[:\-]\s*(.*)$/i);
        if (expMatch) { explanation = expMatch[1].trim(); return; }
        let isCorrect = false;
        let opt = line;
        if (opt.startsWith("*")) { isCorrect = true; opt = opt.slice(1).trim(); }
        opt = opt.replace(/^[A-Fa-f]\)\s*/, "").replace(/^\d+[).]\s*/, "").replace(/^[-•]\s*/, "").trim();
        if (!opt) return;
        if (isCorrect) correctIndex = options.length;
        options.push(opt);
      });
      if (qText && options.length >= 2) parsed.push({ text: qText, options: options.slice(0, MAX_OPTIONS), correctIndex: Math.min(correctIndex, options.length - 1), explanation });
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

    const poolSizeVal = Math.max(0, Number(overlay.querySelector("#em-pool-size").value) || 0);
    if (poolSizeVal > 0 && poolSizeVal > questionDrafts.length) {
      switchExamTab("questions");
      toast(`You set ${poolSizeVal} questions per attempt, but the question bank only has ${questionDrafts.length}. Add more questions or lower that number.`, "error");
      return;
    }

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
        questionsPerAttempt: poolSizeVal,
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
        questionDrafts.map((q, i) => addDoc(collection(db, "exams", examRef.id, "questions"), { text: q.text, options: q.options, correctIndex: q.correctIndex, explanation: (q.explanation || "").trim(), order: i }))
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

