// ==========================================================================
// exam.js — Exam list, question/answer flow, scoring, review, PDF export
// Exported as initExamPage(params) for the SPA router (app.js) — the same
// render()-then-init() split js/course.js already uses for #/course.
// URL scheme: mydomain.com/#/exam            → exam list
//             mydomain.com/#/exam?id=xxx     → take a specific exam
// The markup this file drives lives directly in index.html's #page-exam
// shell (see the comment there); previously exam.html, now removed — this
// route no longer exists as its own HTML file at all.
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  orderBy,
  where,
  limit,
  setDoc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initNav, requireAuth, toast, escapeHtml, toBnDigits, formatTime, formatDuration, formatScore, getExamAvailability, formatDateTime, getCoursePricing } from "./utils.js";
import { navigate } from "./router.js";

// ── Per-visit state (reset on every initExamPage call) ────────────────────
let currentUser = null;
let examId = null;
let questions = [];
let currentIndex = 0;
let answers = {};
let lockedQuestions = new Set();
let timerInterval = null;
let secondsLeft = 0;
let examLayout = "one"; // "one" = one question at a time, "all" = all on one page
let attemptsSoFar = 0;

// Bumped on every initExamPage() call. Any async work (Firestore awaits)
// started for an older navigation checks this before touching shared state
// or the DOM — if the token has moved on (the user has since navigated
// away, or retaken/opened a different exam), that work is stale and must
// be discarded instead of e.g. auto-redirecting the user off a page
// they're no longer on, or rendering exam B's questions on top of exam C.
// Same pattern js/course.js uses for the identical reason.
let navToken = 0;

let listView, takeView, resultView;

/* ---------- One-time binding for the static controls ----------
   #q-prev / #q-next / #exam-submit-form live permanently in index.html's
   #page-exam shell (never re-created between visits, unlike the dynamic
   #question-area / #exam-grid content) — so, exactly like utils.js's
   navBound guard and app.js's dashboardBooted guard, these listeners must
   only ever be attached once per page load. They read module-level state
   (currentIndex, questions, window.__currentExam) fresh at click time, so
   binding them once and letting that state get reset on every attempt is
   both correct and avoids double-firing (double submit, index skipping). */
let controlsBound = false;
function bindStaticControlsOnce() {
  if (controlsBound) return;
  controlsBound = true;

  document.getElementById("q-prev")?.addEventListener("click", () => {
    if (currentIndex > 0) { currentIndex--; renderQuestion(); }
  });
  document.getElementById("q-next")?.addEventListener("click", () => {
    if (currentIndex < questions.length - 1) { currentIndex++; renderQuestion(); }
  });
  document.getElementById("exam-submit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitExam(window.__currentExam);
  });
}

// ── Public entry point — called by app.js on every #/exam navigation ──────
export async function initExamPage(params) {
  const myToken = ++navToken;

  // Stop any timer left running from a previous attempt/visit
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  // Reset state for this visit
  examId = params.get("id");
  questions = [];
  currentIndex = 0;
  answers = {};
  lockedQuestions = new Set();
  secondsLeft = 0;
  examLayout = "one";
  attemptsSoFar = 0;

  listView = document.getElementById("exam-list-view");
  takeView = document.getElementById("exam-take-view");
  resultView = document.getElementById("exam-result-view");

  // Always land back on the list-view layout first; loadExamTaking() below
  // switches to the take-view itself once an exam is confirmed loadable.
  listView.classList.remove("hidden");
  takeView.classList.add("hidden");
  resultView.classList.add("hidden");
  resultView.innerHTML = "";

  bindStaticControlsOnce();
  initNav("exam");

  currentUser = await requireAuth();
  if (myToken !== navToken) return cleanup; // navigated away while awaiting auth
  if (!currentUser) return cleanup;

  if (examId) {
    await loadExamTaking(examId, myToken);
  } else {
    await loadExamList(myToken);
  }

  return cleanup;

  // Returned to app.js so it can tear this visit down before the next one
  function cleanup() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
}

/* ---------- Shuffle an array (Fisher–Yates shuffle) ---------- */
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- How many times this user has attempted this exam so far ----------
   This is counted from the attemptNumber field on the "results" document, not
   from a separate query on the "examAttempts" collection — because if writing
   the results document fails during submission, the whole submission fails
   (making it reliable), whereas writing to examAttempts is silently swallowed
   by try/catch (see submitExam) — if Firestore rules blocked read/write on
   that collection, the count would always come back 0, so the "max attempts
   allowed" setting simply wouldn't work. ---------- */
const attemptsCountCache = {};
async function getAttemptsCount(exId) {
  if (attemptsCountCache[exId] !== undefined) return attemptsCountCache[exId];
  try {
    const snap = await getDoc(doc(db, "results", `${currentUser.uid}_${exId}`));
    const count = snap.exists() ? Number(snap.data().attemptNumber || 0) : 0;
    attemptsCountCache[exId] = count;
    return count;
  } catch {
    attemptsCountCache[exId] = 0;
    return 0;
  }
}

/* ---------- Check whether an exam tied to a paid course is locked ---------- */
const courseLockCache = {};
async function getCourseLockInfo(courseId) {
  if (!courseId) return { locked: false };
  if (courseLockCache[courseId] !== undefined) return courseLockCache[courseId];
  try {
    const courseSnap = await getDoc(doc(db, "courses", courseId));
    if (!courseSnap.exists()) return (courseLockCache[courseId] = { locked: false });
    if (!getCoursePricing(courseSnap.data()).isPaid) return (courseLockCache[courseId] = { locked: false });
    const q = query(
      collection(db, "accessCodes"),
      where("uid", "==", currentUser.uid),
      where("courseId", "==", courseId),
      where("used", "==", true),
      limit(1)
    );
    const snap = await getDocs(q);
    const info = { locked: snap.empty };
    courseLockCache[courseId] = info;
    return info;
  } catch {
    return (courseLockCache[courseId] = { locked: false });
  }
}

/* ---------- Small tag chip shown next to the course badge when an exam only covers specific lesson(s) ---------- */
function lessonTagHtml(ex) {
  return ex.lessonNames?.length
    ? `<span class="badge exam-lesson-tag"><i class="fa-solid fa-list-check"></i> ${escapeHtml(ex.lessonNames.join(", "))}</span>`
    : "";
}

/* ---------- Exam list ---------- */
async function loadExamList(myToken) {
  const grid = document.getElementById("exam-grid");
  grid.innerHTML = `<div class="loading-screen"><span class="spinner"></span> Loading...</div>`;
  try {
    // Fetched without orderBy() on purpose: Firestore silently drops any document that
    // is missing the sorted field, so an exam saved without a proper createdAt would
    // simply vanish from this list. Fetch everything, then sort client-side instead.
    const snap = await getDocs(collection(db, "exams"));
    if (myToken !== navToken) return; // navigated away while this was in flight

    const exams = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (!exams.length) {
      grid.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams have been added yet</p></div>`;
      return;
    }
    // Only exams tied to a free course, or a paid course the user has actually
    // purchased, belong in this global list — exams for paid courses the user
    // hasn't unlocked are skipped entirely (return "") instead of showing a
    // locked card, so this page only ever shows exams the user can take.
    const cards = (
      await Promise.all(
        exams.map(async (ex) => {
          const { state, publishAt, closesAt } = getExamAvailability(ex);
          const { locked } = await getCourseLockInfo(ex.courseId);

          if (locked) {
            return "";
          }

          if (state === "upcoming") {
            return `
            <div class="exam-card card exam-card-locked">
              <div><span class="badge badge-teal">${escapeHtml(ex.courseName || "General")}</span> ${lessonTagHtml(ex)}</div>
              <h3>${escapeHtml(ex.title)}</h3>
              <p class="muted" style="font-size:0.9rem">${escapeHtml(ex.description || "")}</p>
              <div class="meta-row">
                <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
                <span><i class="fa-solid fa-circle-question"></i> ${ex.questionCount || 0} questions</span>
              </div>
              <span class="badge badge-amber"><i class="fa-solid fa-lock"></i> To be published: ${formatDateTime(publishAt)}</span>
            </div>`;
          }

          let result = null;
          try {
            const resultSnap = await getDoc(doc(db, "results", `${currentUser.uid}_${ex.id}`));
            result = resultSnap.exists() ? resultSnap.data() : null;
          } catch (e) {
            // The user hasn't taken this exam yet — the rule may return permission-denied since the result document doesn't exist, which is normal
            result = null;
          }

          const maxAttempts = Number(ex.maxAttempts || 0);
          const attemptsUsed = maxAttempts > 0 ? Number(result?.attemptNumber || 0) : 0;
          const attemptsExhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts;
          const attemptsMeta = maxAttempts > 0
            ? `<span><i class="fa-solid fa-rotate"></i> Attempts: ${attemptsUsed}/${maxAttempts}</span>`
            : `<span><i class="fa-solid fa-infinity"></i> Unlimited attempts</span>`;

          if (state === "closed") {
            return `
            <div class="exam-card card exam-card-locked">
              <div><span class="badge badge-teal">${escapeHtml(ex.courseName || "General")}</span> ${lessonTagHtml(ex)}</div>
              <h3>${escapeHtml(ex.title)}</h3>
              <p class="muted" style="font-size:0.9rem">${escapeHtml(ex.description || "")}</p>
              <div class="meta-row">
                <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
                <span><i class="fa-solid fa-circle-question"></i> ${ex.questionCount || 0} questions</span>
              </div>
              ${result ? `<span class="badge badge-amber result-pill">Previous score: ${formatScore(result.score)}/${result.total}</span>` : ""}
              <span class="badge badge-coral"><i class="fa-solid fa-stopwatch"></i> Time's up (was open until ${formatDateTime(closesAt)})</span>
            </div>`;
          }

          if (attemptsExhausted) {
            return `
            <div class="exam-card card exam-card-locked">
              <div><span class="badge badge-teal">${escapeHtml(ex.courseName || "General")}</span> ${lessonTagHtml(ex)}</div>
              <h3>${escapeHtml(ex.title)}</h3>
              <p class="muted" style="font-size:0.9rem">${escapeHtml(ex.description || "")}</p>
              <div class="meta-row">
                <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
                <span><i class="fa-solid fa-circle-question"></i> ${ex.questionCount || 0} questions</span>
              </div>
              ${result ? `<span class="badge badge-amber result-pill">Last score: ${formatScore(result.score)}/${result.total}</span>` : ""}
              <span class="badge badge-coral"><i class="fa-solid fa-ban"></i> You have already taken the exam</span>
            </div>`;
          }

          return `
        <div class="exam-card card">
          <div>
            <span class="badge badge-teal">${escapeHtml(ex.courseName || "General")}</span> ${lessonTagHtml(ex)}
          </div>
          <h3>${escapeHtml(ex.title)}</h3>
          <p class="muted" style="font-size:0.9rem">${escapeHtml(ex.description || "")}</p>
          <div class="meta-row">
            <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
            <span><i class="fa-solid fa-circle-question"></i> ${ex.questionCount || 0} questions</span>
            ${Number(ex.negativeMarking) > 0 ? `<span><i class="fa-solid fa-triangle-exclamation"></i> −${formatScore(ex.negativeMarking)} per wrong answer</span>` : ""}
          </div>
          <div class="meta-row">${attemptsMeta}</div>
          ${result ? `<span class="badge badge-amber result-pill">Previous score: ${formatScore(result.score)}/${result.total}</span>` : ""}
          ${closesAt ? `<span class="muted" style="font-size:0.78rem">Open until ${formatDateTime(closesAt)}</span>` : ""}
          <a href="#/exam?id=${ex.id}" class="btn btn-primary btn-block">${result ? "Retake" : "Start Exam"}</a>
        </div>`;
        })
      )
    ).filter(Boolean);

    if (myToken !== navToken) return; // navigated away while card HTML was being built

    grid.innerHTML = cards.length
      ? cards.join("")
      : `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams available yet — exams for courses you've purchased will show up here</p></div>`;
  } catch (err) {
    if (myToken !== navToken) return;
    grid.innerHTML = `<div class="empty-state"><p>Could not load exams</p></div>`;
  }
}

/* ---------- Taking an exam ---------- */
async function loadExamTaking(id, myToken) {
  listView.classList.add("hidden");
  takeView.classList.remove("hidden");

  const examSnap = await getDoc(doc(db, "exams", id));
  if (myToken !== navToken) return;
  if (!examSnap.exists()) {
    takeView.innerHTML = `<div class="empty-state"><p>Exam not found</p></div>`;
    return;
  }
  const exam = examSnap.data();

  const { locked } = await getCourseLockInfo(exam.courseId);
  if (myToken !== navToken) return;
  if (locked) {
    toast("This exam is part of a paid course — please purchase the course to unlock it", "error");
    setTimeout(() => { if (myToken === navToken) navigate(`#/course?id=${exam.courseId}`); }, 1200);
    return;
  }

  const { state, publishAt, closesAt } = getExamAvailability(exam);
  if (state === "upcoming") {
    toast(`This exam hasn't been published yet — it will open on ${formatDateTime(publishAt)}`, "error");
    setTimeout(() => { if (myToken === navToken) navigate("#/exam"); }, 1200);
    return;
  }
  if (state === "closed") {
    toast(`This exam has closed (was open until ${formatDateTime(closesAt)})`, "error");
    setTimeout(() => { if (myToken === navToken) navigate("#/exam"); }, 1200);
    return;
  }

  const maxAttempts = Number(exam.maxAttempts || 0);
  if (maxAttempts > 0) {
    attemptsSoFar = await getAttemptsCount(id);
    if (myToken !== navToken) return;
    if (attemptsSoFar >= maxAttempts) {
      toast(`This exam allows a maximum of ${maxAttempts} attempts — you've used them all`, "error");
      setTimeout(() => { if (myToken === navToken) navigate("#/exam"); }, 1400);
      return;
    }
  }

  window.__currentExam = exam;
  document.getElementById("exam-take-title").textContent = exam.title;

  const qSnap = await getDocs(query(collection(db, "exams", id, "questions"), orderBy("order", "asc")));
  if (myToken !== navToken) return;
  questions = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!questions.length) {
    takeView.innerHTML = `<div class="empty-state"><p>This exam has no questions</p></div>`;
    return;
  }

  /* Question and option order is shuffled on each attempt (enabled by default) — to make cheating harder */
  if (exam.shuffle !== false) {
    questions = shuffleArray(questions).map((q) => {
      const optionOrder = shuffleArray(q.options.map((_, i) => i));
      return {
        ...q,
        options: optionOrder.map((oi) => q.options[oi]),
        correctIndex: optionOrder.indexOf(q.correctIndex),
      };
    });
  }

  examLayout = exam.layout === "all" ? "all" : "one";
  answers = {};
  lockedQuestions = new Set();
  currentIndex = 0;

  const navRow = document.querySelector(".exam-nav-row");
  const progressTrack = document.querySelector(".q-progress-track");
  const prevBtn = document.getElementById("q-prev");
  const submitBtn = document.getElementById("q-submit");
  if (examLayout === "all") {
    prevBtn.classList.add("hidden");
    document.getElementById("q-next").classList.add("hidden");
    submitBtn.classList.remove("hidden");
    progressTrack.classList.add("hidden");
  } else {
    prevBtn.classList.remove("hidden");
    document.getElementById("q-next").classList.remove("hidden");
    progressTrack.classList.remove("hidden");
  }
  navRow.classList.remove("hidden");

  secondsLeft = (exam.duration || 10) * 60;
  startTimer();
  if (examLayout === "all") renderAllQuestions();
  else renderQuestion();
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const timerEl = document.getElementById("exam-timer");
  timerInterval = setInterval(() => {
    secondsLeft--;
    timerEl.innerHTML = `<i class="fa-solid fa-stopwatch"></i> ${formatTime(Math.max(0, secondsLeft))}`;
    timerEl.classList.toggle("low", secondsLeft <= 60);
    if (secondsLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      toast("Time's up! Submitting your answers...", "error");
      submitExam(window.__currentExam);
    }
  }, 1000);
}

/* ---------- Option-list HTML for a question — locked state is also handled here ---------- */
function renderOptionsHtml(q) {
  const isLocked = lockedQuestions.has(q.id);
  return `
    <div class="option-list ${isLocked ? "locked" : ""}" data-qid="${q.id}">
      ${q.options
        .map(
          (opt, i) => `
        <div class="option-item ${answers[q.id] === i ? "selected" : ""} ${isLocked ? "disabled" : ""}" data-qid="${q.id}" data-i="${i}">
          <span class="option-letter">${String.fromCharCode(65 + i)}</span>
          <span>${escapeHtml(opt)}</span>
          ${answers[q.id] === i && isLocked ? '<i class="fa-solid fa-lock option-lock-icon"></i>' : ""}
        </div>`
        )
        .join("")}
    </div>
    ${isLocked ? `<div class="option-locked-hint"><i class="fa-solid fa-circle-info"></i> Viewing your answer</div>` : ""}
  `;
}

/* ---------- Clicking an option selects and locks it — one-time only ---------- */
function bindOptionClicks(container, onAfterLock) {
  container.querySelectorAll(".option-item").forEach((el) => {
    el.addEventListener("click", () => {
      const qid = el.dataset.qid;
      if (lockedQuestions.has(qid)) return; // Already locked — can't be changed
      answers[qid] = Number(el.dataset.i);
      lockedQuestions.add(qid);
      onAfterLock();
    });
  });
}

/* ---------- Layout: one question at a time ---------- */
function renderQuestion() {
  const q = questions[currentIndex];
  document.getElementById("q-progress-fill").style.width = `${((currentIndex + 1) / questions.length) * 100}%`;
  document.getElementById("question-area").innerHTML = `
    <div class="question-card paper">
      <div class="q-index">Question ${currentIndex + 1} / ${questions.length}</div>
      <h2>${escapeHtml(q.text)}</h2>
      ${renderOptionsHtml(q)}
    </div>
  `;
  bindOptionClicks(document.getElementById("question-area"), renderQuestion);

  const prevBtn = document.getElementById("q-prev");
  const nextBtn = document.getElementById("q-next");
  const submitBtn = document.getElementById("q-submit");
  prevBtn.disabled = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;
  nextBtn.classList.toggle("hidden", isLast);
  submitBtn.classList.toggle("hidden", !isLast);
}

/* ---------- Layout: all questions on one page ---------- */
function renderAllQuestions() {
  document.getElementById("question-area").innerHTML = questions
    .map(
      (q, i) => `
    <div class="question-card paper mb-16">
      <div class="q-index">Question ${i + 1} / ${questions.length}</div>
      <h2>${escapeHtml(q.text)}</h2>
      ${renderOptionsHtml(q)}
    </div>`
    )
    .join("");
  bindOptionClicks(document.getElementById("question-area"), renderAllQuestions);
}

async function submitExam(exam) {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  /* ---------- Scoring: +1 per correct answer, −negativeMarking per wrong answer ----------
     Unanswered questions never lose marks, only answered-and-wrong ones do. The net score can
     come out fractional (e.g. 0.25 negative marking) or below zero — both are stored as-is so
     the admin leaderboard can rank attempts precisely; only the on-screen percent ring is
     clamped to 0–100 so it never renders a broken/negative progress ring. ---------- */
  const negativeMarking = Math.max(0, Number(exam?.negativeMarking) || 0);
  let correctCount = 0;
  let wrongCount = 0;
  questions.forEach((q) => {
    if (answers[q.id] === undefined) return; // unanswered — no penalty
    if (answers[q.id] === q.correctIndex) correctCount++;
    else wrongCount++;
  });
  const unansweredCount = questions.length - correctCount - wrongCount;
  const rawScore = correctCount - wrongCount * negativeMarking;
  const score = Math.round(rawScore * 100) / 100; // net score, may be fractional or negative
  const percent = Math.max(0, Math.min(100, Math.round((rawScore / questions.length) * 100)));
  const attemptNumber = attemptsSoFar + 1;
  const examTitle = exam?.title || document.getElementById("exam-take-title").textContent;

  const totalSeconds = (exam?.duration || 10) * 60;
  const timeTakenSeconds = Math.max(0, Math.min(totalSeconds, totalSeconds - secondsLeft));

  const resultPayload = {
    uid: currentUser.uid,
    examId,
    examTitle,
    score,
    total: questions.length,
    percent,
    correctCount,
    wrongCount,
    unansweredCount,
    negativeMarking,
    timeTakenSeconds,
    answers,
    attemptNumber,
    submittedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "results", `${currentUser.uid}_${examId}`), resultPayload);
  attemptsCountCache[examId] = attemptNumber; // keep the cache in sync for an immediate retake

  try {
    await addDoc(collection(db, "examAttempts"), {
      uid: currentUser.uid,
      examId,
      examTitle,
      score,
      total: questions.length,
      percent,
      correctCount,
      wrongCount,
      unansweredCount,
      negativeMarking,
      timeTakenSeconds,
      attemptNumber,
      submittedAt: serverTimestamp(),
    });
  } catch (e) {
    // Even if saving attempt history fails, don't block showing the result
  }

  showResult(score, questions.length, percent, examTitle, { correctCount, wrongCount, unansweredCount, negativeMarking, timeTakenSeconds });
}

function showResult(score, total, percent, examTitle, breakdown = {}) {
  const { correctCount = 0, wrongCount = 0, unansweredCount = 0, negativeMarking = 0, timeTakenSeconds = 0 } = breakdown;
  takeView.classList.add("hidden");
  resultView.classList.remove("hidden");
  resultView.innerHTML = `
    <div class="result-hero card">
      <div class="result-ring" style="--pct:${percent}"><b>${percent}%</b></div>
      <h2>${percent >= 60 ? 'Great job! <i class="fa-solid fa-champagne-glasses"></i>' : "A bit more practice and you've got it <i class=\"fa-solid fa-hand-fist\"></i>"}</h2>
      <p class="muted mt-8">Your score: <b>${formatScore(score)} / ${total}</b></p>
      <div class="result-breakdown-row">
        <span class="badge badge-teal"><i class="fa-solid fa-check"></i> Correct: ${correctCount}</span>
        <span class="badge badge-coral"><i class="fa-solid fa-xmark"></i> Wrong: ${wrongCount}</span>
        <span class="badge badge-amber"><i class="fa-solid fa-circle-minus"></i> Unanswered: ${unansweredCount}</span>
        <span class="badge badge-amber"><i class="fa-solid fa-stopwatch"></i> Time taken: ${formatDuration(timeTakenSeconds)}</span>
      </div>
      ${negativeMarking > 0 ? `<p class="muted mt-8" style="font-size:0.82rem;"><i class="fa-solid fa-circle-info"></i> Negative marking was on for this exam — ${formatScore(negativeMarking)} mark deducted per wrong answer</p>` : ""}
      <div class="flex gap-12 justify-between mt-24" style="max-width:480px;margin:24px auto 0">
        <a href="#/exam" class="btn btn-outline btn-block">All Exams</a>
        <a href="#/exam?id=${examId}" class="btn btn-primary btn-block">Retake</a>
        <button type="button" class="btn btn-teal btn-block" id="download-result-pdf"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
      </div>
    </div>
    <div class="review-list">
      ${questions
        .map((q, i) => {
          const userAns = answers[q.id];
          const correct = userAns === q.correctIndex;
          return `
        <div class="review-item paper">
          <div class="q">${i + 1}. ${escapeHtml(q.text)}</div>
          <div class="review-answer ${correct ? "correct" : "wrong"}">
            ${correct ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>'} Your answer: ${userAns !== undefined ? escapeHtml(q.options[userAns]) : "No answer given"}
          </div>
          ${!correct ? `<div class="review-answer correct"><i class="fa-solid fa-check"></i> Correct answer: ${escapeHtml(q.options[q.correctIndex])}</div>` : ""}
        </div>`;
        })
        .join("")}
    </div>
  `;

  const pdfBtn = document.getElementById("download-result-pdf");
  pdfBtn?.addEventListener("click", () => {
    downloadResultPDF(score, total, percent, examTitle, breakdown);
  });
}

/* -------- PDF export with logo watermark --------
   Uses jsPDF (loaded via CDN in index.html's <head> as window.jspdf — the
   whole SPA shares one copy now instead of exam.html loading its own).
   Every page of the generated PDF gets the site logo drawn faintly,
   rotated, and centered as a watermark before any text/content is placed
   on top of it. -------- */
function loadLogoImage() {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "assets/logo.png";
  });
}

async function downloadResultPDF(score, total, percent, examTitle, breakdown = {}) {
  const pdfBtn = document.getElementById("download-result-pdf");
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    toast("Couldn't load the PDF engine. Check your connection and try again.", "error");
    return;
  }
  if (pdfBtn) {
    pdfBtn.disabled = true;
    pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing...';
  }

  try {
    const { correctCount = 0, wrongCount = 0, unansweredCount = 0, negativeMarking = 0, timeTakenSeconds = 0 } = breakdown;
    const logoImg = await loadLogoImage();
    const pdfDoc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdfDoc.internal.pageSize.getWidth();
    const pageHeight = pdfDoc.internal.pageSize.getHeight();
    const marginX = 40;

    const drawWatermark = () => {
      if (!logoImg) return;
      pdfDoc.saveGraphicsState();
      pdfDoc.setGState(new pdfDoc.GState({ opacity: 0.08 }));
      const wmSize = 300;
      pdfDoc.addImage(logoImg, "PNG", (pageWidth - wmSize) / 2, (pageHeight - wmSize) / 2, wmSize, wmSize, undefined, undefined, 30);
      pdfDoc.restoreGraphicsState();
    };

    drawWatermark();

    let y = 55;
    if (logoImg) pdfDoc.addImage(logoImg, "PNG", marginX, 30, 36, 36);
    pdfDoc.setFontSize(17);
    pdfDoc.setFont(undefined, "bold");
    pdfDoc.text("Tech Verse Course", marginX + 46, 50);
    pdfDoc.setFontSize(10);
    pdfDoc.setFont(undefined, "normal");
    pdfDoc.setTextColor(110, 110, 110);
    pdfDoc.text("Exam Result Report", marginX + 46, 65);
    pdfDoc.setTextColor(0, 0, 0);

    y = 100;
    pdfDoc.setDrawColor(210);
    pdfDoc.line(marginX, y, pageWidth - marginX, y);
    y += 28;

    pdfDoc.setFontSize(14);
    pdfDoc.setFont(undefined, "bold");
    pdfDoc.text(examTitle || "Exam", marginX, y);
    y += 22;

    pdfDoc.setFontSize(11);
    pdfDoc.setFont(undefined, "normal");
    const studentLine = `Student: ${currentUser?.displayName || currentUser?.email || "-"}`;
    pdfDoc.text(studentLine, marginX, y); y += 16;
    pdfDoc.text(`Date: ${new Date().toLocaleString()}`, marginX, y); y += 16;
    pdfDoc.setFont(undefined, "bold");
    pdfDoc.text(`Score: ${formatScore(score)} / ${total}  (${percent}%)`, marginX, y); y += 16;
    pdfDoc.setFont(undefined, "normal");
    pdfDoc.text(`Correct: ${correctCount}   Wrong: ${wrongCount}   Unanswered: ${unansweredCount}`, marginX, y); y += 16;
    pdfDoc.text(`Time Taken: ${formatDuration(timeTakenSeconds)}`, marginX, y); y += 16;
    if (negativeMarking > 0) {
      pdfDoc.text(`Negative Marking: ${formatScore(negativeMarking)} per wrong answer`, marginX, y); y += 16;
    }
    y += 14;

    pdfDoc.setFontSize(13);
    pdfDoc.setFont(undefined, "bold");
    pdfDoc.text("Answer Review", marginX, y);
    y += 20;
    pdfDoc.setFontSize(10);

    const contentWidth = pageWidth - marginX * 2;
    questions.forEach((q, i) => {
      const qLines = pdfDoc.splitTextToSize(`${i + 1}. ${q.text}`, contentWidth);
      const userAns = answers[q.id];
      const correct = userAns === q.correctIndex;
      const estLines = qLines.length + (correct ? 1 : 2);

      if (y + estLines * 14 + 20 > pageHeight - 40) {
        pdfDoc.addPage();
        drawWatermark();
        y = 50;
      }

      pdfDoc.setFont(undefined, "bold");
      pdfDoc.setTextColor(0, 0, 0);
      pdfDoc.text(qLines, marginX, y);
      y += qLines.length * 14;

      pdfDoc.setFont(undefined, "normal");
      pdfDoc.setTextColor(correct ? 20 : 195, correct ? 130 : 45, correct ? 70 : 45);
      const yourAnsLines = pdfDoc.splitTextToSize(`Your answer: ${userAns !== undefined ? q.options[userAns] : "No answer given"}`, contentWidth - 10);
      pdfDoc.text(yourAnsLines, marginX + 10, y);
      y += yourAnsLines.length * 14;

      if (!correct) {
        pdfDoc.setTextColor(20, 130, 70);
        const correctLines = pdfDoc.splitTextToSize(`Correct answer: ${q.options[q.correctIndex]}`, contentWidth - 10);
        pdfDoc.text(correctLines, marginX + 10, y);
        y += correctLines.length * 14;
      }
      pdfDoc.setTextColor(0, 0, 0);
      y += 10;
    });

    const safeTitle = (examTitle || "exam").replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 60);
    pdfDoc.save(`${safeTitle}_result.pdf`);
  } catch (err) {
    toast("Failed to generate the PDF. Please try again.", "error");
  } finally {
    if (pdfBtn) {
      pdfBtn.disabled = false;
      pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
    }
  }
}
