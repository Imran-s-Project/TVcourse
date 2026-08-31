// ==========================================================================
// exam-render.js — every piece of markup the exam section draws to the DOM.
// No Firestore calls live here (exam-data.js) and no scoring/shuffle rules
// live here (exam-engine.js) — this file only turns already-fetched data
// into HTML and wires up the click handlers on it.
// ==========================================================================
import { escapeHtml, formatScore, formatDuration, getExamAvailability, formatDateTime, getExamQuestionCount } from "../js/utils.js";
import { fetchAllExams, fetchResult, getCourseLockInfo } from "./exam-data.js";
import { startCountdowns } from "./exam-timer.js";
import { state } from "./exam-engine.js";

function lessonTagHtml(ex) {
  return ex.lessonNames?.length
    ? `<span class="exs-chip exs-chip-tag"><i class="fa-solid fa-list-check"></i> ${escapeHtml(ex.lessonNames.join(", "))}</span>`
    : "";
}

/* ---------- Section header (title/subtitle/back-button) above the grid ----------
   #exam-section-title / #exam-section-sub / #exam-back-btn live permanently in
   index.html's #page-exam shell (same static-markup pattern as #q-prev etc.),
   so this just writes into them — no re-render of the shell itself. ---------- */
export function setExamSectionHeader({ title, sub, showBack }) {
  const titleEl = document.getElementById("exam-section-title");
  const subEl = document.getElementById("exam-section-sub");
  const backBtn = document.getElementById("exam-back-btn");
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub || "";
  if (backBtn) backBtn.classList.toggle("hidden", !showBack);
}

/* ---------- Groups exams by course ----------
   Key is the exam's courseId, or the sentinel "general" for exams with no
   courseId at all (admin's "Open to Everyone" option) — "general" is also
   the #/exam?course= value used for that bucket in the URL. ---------- */
function groupExamsByCourse(exams) {
  const groups = new Map();
  for (const ex of exams) {
    const key = ex.courseId || "general";
    if (!groups.has(key)) {
      groups.set(key, { key, courseId: ex.courseId || null, courseName: ex.courseName || "General", exams: [] });
    }
    groups.get(key).exams.push(ex);
  }
  return groups;
}

/* ---------- Course picker — the exam section's landing view ----------
   One card per course that has at least one exam the user can actually see
   (free courses, or paid courses already purchased — locked courses are
   skipped entirely, same rule the flat list always applied per-exam).
   Tapping a card goes to #/exam?course=<key>, which renderExamList below
   turns into that course's own exam grid. ---------- */
export async function renderExamCourseList(grid) {
  setExamSectionHeader({
    title: "নিজেকে যাচাই করুন",
    sub: "আপনার কোর্স বেছে নিন, তারপর সেই কোর্সের সব এক্সাম দেখুন",
    showBack: false,
  });
  grid.classList.add("exam-grid--courses");
  grid.innerHTML = `<div class="exs-loading"><span class="exs-spinner"></span> Loading...</div>`;
  const myToken = state.navToken;
  try {
    const exams = await fetchAllExams();
    if (state.navToken !== myToken) return;

    if (!exams.length) {
      grid.innerHTML = `<div class="exs-empty"><i class="fa-solid fa-file-pen"></i><p>No exams have been added yet</p></div>`;
      return;
    }

    const groups = groupExamsByCourse(exams);

    const results = await Promise.all(
      Array.from(groups.values()).map(async (g) => {
        const info = g.courseId ? await getCourseLockInfo(g.courseId, state.userProfile) : { locked: false };
        if (info.locked) return null;

        const total = g.exams.length;
        let openCount = 0;
        let upcomingCount = 0;
        g.exams.forEach((ex) => {
          const { state: availState } = getExamAvailability(ex);
          if (availState === "open") openCount++;
          else if (availState === "upcoming") upcomingCount++;
        });

        const title = g.courseId ? (info.title || g.courseName) : "সাধারণ এক্সাম (সবার জন্য)";
        const cover = g.courseId ? info.coverImage || "" : "";
        const latestCreated = Math.max(0, ...g.exams.map((ex) => ex.createdAt?.seconds || 0));

        const html = `
        <a href="#/exam?course=${encodeURIComponent(g.key)}" class="exs-course-card">
          <div class="exs-course-cover" ${cover ? `style="background-image:url('${cover}')"` : ""}>
            ${!cover ? `<i class="fa-solid ${g.courseId ? "fa-graduation-cap" : "fa-layer-group"}"></i>` : ""}
          </div>
          <div class="exs-course-body">
            <h3>${escapeHtml(title)}</h3>
            <div class="exs-meta-row">
              <span><i class="fa-solid fa-file-pen"></i> ${total} Exam${total > 1 ? "s" : ""}</span>
              ${openCount > 0
                ? `<span class="exs-course-open-tag"><i class="fa-solid fa-circle-check"></i> ${openCount} open now</span>`
                : upcomingCount > 0
                  ? `<span class="exs-muted exs-small"><i class="fa-solid fa-hourglass-half"></i> ${upcomingCount} upcoming</span>`
                  : ""}
            </div>
          </div>
          <i class="fa-solid fa-chevron-right exs-course-arrow"></i>
        </a>`;
        return { html, sortKey: latestCreated };
      })
    );

    if (state.navToken !== myToken) return;

    const cards = results.filter(Boolean);
    if (!cards.length) {
      grid.innerHTML = `<div class="exs-empty"><i class="fa-solid fa-file-pen"></i><p>No exams available yet — exams for the courses you've purchased will appear here</p></div>`;
      return;
    }

    cards.sort((a, b) => b.sortKey - a.sortKey);
    grid.innerHTML = cards.map((c) => c.html).join("");
  } catch {
    if (state.navToken !== myToken) return;
    grid.innerHTML = `<div class="exs-empty"><p>Couldn't load exams</p></div>`;
  }
}

/* ---------- Exam list — either all exams (courseKey omitted) or one
   course's exams (courseKey = a courseId, or "general" for the no-course
   bucket). Re-checks the course lock itself (not just trusting the picker)
   so a direct/typed #/exam?course=xxx URL to a paid, unpurchased course
   can't be used to see its exam titles. ---------- */
export async function renderExamList(grid, courseKey = null) {
  grid.classList.remove("exam-grid--courses");
  grid.innerHTML = `<div class="exs-loading"><span class="exs-spinner"></span> Loading...</div>`;
  const myToken = state.navToken;
  try {
    if (courseKey && courseKey !== "general") {
      const info = await getCourseLockInfo(courseKey, state.userProfile);
      if (state.navToken !== myToken) return;
      if (info.locked) {
        setExamSectionHeader({ title: info.title || "Locked Course", sub: "", showBack: true });
        grid.innerHTML = `<div class="exs-empty"><i class="fa-solid fa-lock"></i><p>This course's exams are locked — purchase the course to unlock them</p></div>`;
        return;
      }
    }

    const allExams = await fetchAllExams();
    if (state.navToken !== myToken) return;
    const exams = courseKey ? allExams.filter((ex) => (ex.courseId || "general") === courseKey) : allExams;

    if (courseKey) {
      let title = "Course Exams";
      if (courseKey === "general") {
        title = "সাধারণ এক্সাম (সবার জন্য)";
      } else {
        const info = await getCourseLockInfo(courseKey, state.userProfile); // cached above, no extra read
        title = info.title || exams[0]?.courseName || "Course Exams";
      }
      setExamSectionHeader({
        title,
        sub: exams.length ? `এই কোর্সে মোট ${exams.length} টি এক্সাম রয়েছে` : "এই কোর্সে এখনো কোনো এক্সাম যোগ করা হয়নি",
        showBack: true,
      });
    }

    if (!exams.length) {
      grid.innerHTML = `<div class="exs-empty"><i class="fa-solid fa-file-pen"></i><p>No exams found for this course yet</p></div>`;
      return;
    }

    const cards = (
      await Promise.all(
        exams.map(async (ex) => {
          const { state: availState, publishAt, closesAt } = getExamAvailability(ex);
          const { locked } = await getCourseLockInfo(ex.courseId, state.userProfile);
          if (locked) return "";

          if (availState === "upcoming") {
            return `
            <div class="exs-card exs-card--locked">
              <div class="exs-card-top">
                <div><span class="exs-chip exs-chip-course">${escapeHtml(ex.courseName || "General")}</span> ${lessonTagHtml(ex)}</div>
                <span class="exs-countdown" data-countdown="${publishAt.getTime()}"><i class="fa-solid fa-hourglass-half"></i> <span class="countdown-val">...</span></span>
              </div>
              <h3>${escapeHtml(ex.title)}</h3>
              <p class="exs-muted">${escapeHtml(ex.description || "")}</p>
              <div class="exs-meta-row">
                <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
                <span><i class="fa-solid fa-circle-question"></i> ${getExamQuestionCount(ex)} Questions</span>
              </div>
              <span class="exs-tag exs-tag--amber"><i class="fa-solid fa-lock"></i> Opens: ${formatDateTime(publishAt)}</span>
            </div>`;
          }

          const result = await fetchResult(state.currentUser.uid, ex.id);
          const maxAttempts = Number(ex.maxAttempts || 0);
          const attemptsUsed = maxAttempts > 0 ? Number(result?.attemptNumber || 0) : 0;
          const attemptsExhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts;
          const attemptsMeta = maxAttempts > 0
            ? `<span><i class="fa-solid fa-rotate"></i> Attempts: ${attemptsUsed}/${maxAttempts}</span>`
            : `<span><i class="fa-solid fa-infinity"></i> Unlimited attempts</span>`;

          if (availState === "closed") {
            return `
            <div class="exs-card exs-card--locked">
              <div><span class="exs-chip exs-chip-course">${escapeHtml(ex.courseName || "General")}</span> ${lessonTagHtml(ex)}</div>
              <h3>${escapeHtml(ex.title)}</h3>
              <p class="exs-muted">${escapeHtml(ex.description || "")}</p>
              <div class="exs-meta-row">
                <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
                <span><i class="fa-solid fa-circle-question"></i> ${getExamQuestionCount(ex)} Questions</span>
              </div>
              ${result ? `<span class="exs-tag exs-tag--amber">Previous score: ${formatScore(result.score)}/${result.total}</span>` : ""}
              <span class="exs-tag exs-tag--coral"><i class="fa-solid fa-stopwatch"></i> Time's up (was open until ${formatDateTime(closesAt)})</span>
            </div>`;
          }

          if (attemptsExhausted) {
            return `
            <div class="exs-card exs-card--locked">
              <div><span class="exs-chip exs-chip-course">${escapeHtml(ex.courseName || "General")}</span> ${lessonTagHtml(ex)}</div>
              <h3>${escapeHtml(ex.title)}</h3>
              <p class="exs-muted">${escapeHtml(ex.description || "")}</p>
              <div class="exs-meta-row">
                <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
                <span><i class="fa-solid fa-circle-question"></i> ${getExamQuestionCount(ex)} Questions</span>
              </div>
              ${result ? `<span class="exs-tag exs-tag--amber">Last score: ${formatScore(result.score)}/${result.total}</span>` : ""}
              <span class="exs-tag exs-tag--coral"><i class="fa-solid fa-ban"></i> You've already taken this exam</span>
            </div>`;
          }

          return `
          <div class="exs-card">
            <div><span class="exs-chip exs-chip-course">${escapeHtml(ex.courseName || "General")}</span> ${lessonTagHtml(ex)}</div>
            <h3>${escapeHtml(ex.title)}</h3>
            <p class="exs-muted">${escapeHtml(ex.description || "")}</p>
            <div class="exs-meta-row">
              <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
              <span><i class="fa-solid fa-circle-question"></i> ${getExamQuestionCount(ex)} Questions</span>
            </div>
            <div class="exs-meta-row">${attemptsMeta}</div>
            ${result ? `<span class="exs-tag exs-tag--amber">Previous score: ${formatScore(result.score)}/${result.total}</span>` : ""}
            ${closesAt ? `<span class="exs-muted exs-small">Open until ${formatDateTime(closesAt)}</span>` : ""}
            <a href="#/exam?id=${ex.id}" class="btn btn-primary btn-block">${result ? "Retake" : "Start Exam"}</a>
          </div>`;
        })
      )
    ).filter(Boolean);

    if (state.navToken !== myToken) return;

    grid.innerHTML = cards.length
      ? cards.join("")
      : `<div class="exs-empty"><i class="fa-solid fa-file-pen"></i><p>No exams available right now${courseKey ? " for this course" : " — exams for the courses you've purchased will appear here"}</p></div>`;
    startCountdowns(grid);
  } catch {
    if (state.navToken !== myToken) return;
    grid.innerHTML = `<div class="exs-empty"><p>Couldn't load exams</p></div>`;
  }
}

/* ---------- Option list for one question ---------- */
function renderOptionsHtml(q) {
  const isLocked = state.lockedQuestions.has(q.id);
  return `
    <div class="exs-options ${isLocked ? "is-locked" : ""}" data-qid="${q.id}">
      ${q.options
        .map(
          (opt, i) => `
        <div class="exs-option ${state.answers[q.id] === i ? "is-selected" : ""} ${isLocked ? "is-disabled" : ""}" data-qid="${q.id}" data-i="${i}">
          <span class="exs-option-letter">${String.fromCharCode(65 + i)}</span>
          <span class="exs-option-text">${escapeHtml(opt)}</span>
          ${state.answers[q.id] === i && isLocked ? '<i class="fa-solid fa-lock exs-option-lock"></i>' : ""}
        </div>`
        )
        .join("")}
    </div>
    ${isLocked ? `<div class="exs-locked-hint"><i class="fa-solid fa-circle-info"></i> Showing your answer</div>` : ""}
  `;
}

function bindOptionClicks(container, onAfterLock) {
  container.querySelectorAll(".exs-option").forEach((el) => {
    el.addEventListener("click", () => {
      const qid = el.dataset.qid;
      if (state.lockedQuestions.has(qid)) return;
      state.answers[qid] = Number(el.dataset.i);
      state.lockedQuestions.add(qid);
      onAfterLock();
    });
  });
}

export function renderQuestion(refs) {
  const q = state.questions[state.currentIndex];
  refs.progressFill.style.width = `${((state.currentIndex + 1) / state.questions.length) * 100}%`;
  refs.questionArea.innerHTML = `
    <div class="exs-question-card">
      <div class="exs-q-index">Question ${state.currentIndex + 1} / ${state.questions.length}</div>
      <h2>${escapeHtml(q.text)}</h2>
      ${renderOptionsHtml(q)}
    </div>`;
  bindOptionClicks(refs.questionArea, () => renderQuestion(refs));

  const isLast = state.currentIndex === state.questions.length - 1;
  refs.prevBtn.disabled = state.currentIndex === 0;
  refs.nextBtn.classList.toggle("hidden", isLast);
  refs.submitBtn.classList.toggle("hidden", !isLast);
}

export function renderAllQuestions(refs) {
  refs.questionArea.innerHTML = state.questions
    .map(
      (q, i) => `
    <div class="exs-question-card exs-mb">
      <div class="exs-q-index">Question ${i + 1} / ${state.questions.length}</div>
      <h2>${escapeHtml(q.text)}</h2>
      ${renderOptionsHtml(q)}
    </div>`
    )
    .join("");
  bindOptionClicks(refs.questionArea, () => renderAllQuestions(refs));
}

export function renderResult(resultView, { score, total, percent, examTitle, breakdown, onDownloadPdf }) {
  const { correctCount = 0, wrongCount = 0, unansweredCount = 0, negativeMarking = 0, timeTakenSeconds = 0 } = breakdown;
  resultView.innerHTML = `
    <div class="exs-result-hero">
      <div class="exs-result-ring" style="--pct:${percent}"><b>${percent}%</b></div>
      <h2>${percent >= 60 ? "Great job! 🎉" : "A little more practice and you'll get there 💪"}</h2>
      <p class="exs-muted exs-mt-8">Your score: <b>${formatScore(score)} / ${total}</b></p>
      <div class="exs-result-badges">
        <span class="exs-tag exs-tag--teal"><i class="fa-solid fa-check"></i> Correct: ${correctCount}</span>
        <span class="exs-tag exs-tag--coral"><i class="fa-solid fa-xmark"></i> Wrong: ${wrongCount}</span>
        <span class="exs-tag exs-tag--amber"><i class="fa-solid fa-circle-minus"></i> Unanswered: ${unansweredCount}</span>
        <span class="exs-tag exs-tag--amber"><i class="fa-solid fa-stopwatch"></i> Time taken: ${formatDuration(timeTakenSeconds)}</span>
      </div>
      ${negativeMarking > 0 ? `<p class="exs-muted exs-small exs-mt-8"><i class="fa-solid fa-circle-info"></i> Negative marking was active for this exam — ${formatScore(negativeMarking)} marks were deducted per wrong answer</p>` : ""}
      <div class="exs-result-actions">
        <a href="#/exam?course=${encodeURIComponent(state.exam?.courseId || "general")}" class="exs-action-box"><i class="fa-solid fa-list"></i><span>Course Exams</span></a>
        <a href="#/exam?id=${state.examId}" class="exs-action-box exs-action-box--primary"><i class="fa-solid fa-rotate-right"></i><span>Retake</span></a>
        <button type="button" class="exs-action-box exs-action-box--teal" id="exs-download-pdf"><i class="fa-solid fa-file-pdf"></i><span>PDF</span></button>
      </div>
    </div>
    <div class="exs-review-list">
      ${state.questions
        .map((q, i) => {
          const userAns = state.answers[q.id];
          const correct = userAns === q.correctIndex;
          return `
        <div class="exs-review-item">
          <div class="exs-review-q">${i + 1}. ${escapeHtml(q.text)}</div>
          <div class="exs-review-answer ${correct ? "is-correct" : "is-wrong"}">
            ${correct ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>'} Your answer: ${userAns !== undefined ? escapeHtml(q.options[userAns]) : "No answer given"}
          </div>
          ${!correct ? `<div class="exs-review-answer is-correct"><i class="fa-solid fa-check"></i> Correct answer: ${escapeHtml(q.options[q.correctIndex])}</div>` : ""}
          ${q.explanation && q.explanation.trim() ? `<div class="exs-review-explain"><i class="fa-solid fa-lightbulb"></i><span><b>Explanation:</b> ${escapeHtml(q.explanation)}</span></div>` : ""}
        </div>`;
        })
        .join("")}
    </div>`;

  resultView.querySelector("#exs-download-pdf")?.addEventListener("click", onDownloadPdf);
}
