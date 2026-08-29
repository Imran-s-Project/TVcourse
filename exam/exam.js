// ==========================================================================
// exam.js — the exam section's public entry point.
// Exported as initExamPage(params) for the SPA router (js/app.js), the same
// render()-then-init() split js/course.js uses for #/course.
// URL scheme: mydomain.com/#/exam            → exam list
//             mydomain.com/#/exam?id=xxx     → verification → take → result
//
// This file only wires the other exam-section modules together:
//   exam-data.js    → Firestore reads/writes
//   exam-engine.js  → shared state + shuffle/scoring rules
//   exam-guard.js   → the verification + rules gate before an attempt starts
//   exam-render.js  → all DOM markup
//   exam-timer.js   → the countdown while taking an exam
//   exam-pdf.js     → result PDF export
// ==========================================================================
import { initNav, requireAuth, toast, getUserProfile, getExamQuestionCount } from "../js/utils.js";
import { navigate } from "../js/router.js";
import { state, resetSessionState, buildQuestionPool, scoreExam } from "./exam-engine.js";
import { fetchQuestions, saveResult } from "./exam-data.js";
import { runVerification, renderRulesGate } from "./exam-guard.js";
import { renderExamList, renderQuestion, renderAllQuestions, renderResult } from "./exam-render.js";
import { startExamTimer, stopExamTimer, formatClock } from "./exam-timer.js";
import { downloadResultPDF } from "./exam-pdf.js";

let listView, verifyView, takeView, resultView, refs;

/* ---------- One-time binding for the static controls ----------
   #q-prev / #q-next / #exam-submit-form live permanently in index.html's
   #page-exam shell (never re-created between visits) — exactly like
   js/course.js's own one-time-binding guards, this must only run once per
   page load. They read module-level state fresh at click time. ---------- */
let controlsBound = false;
function bindStaticControlsOnce() {
  if (controlsBound) return;
  controlsBound = true;

  document.getElementById("q-prev")?.addEventListener("click", () => {
    if (state.currentIndex > 0) { state.currentIndex--; renderQuestion(refs); }
  });
  document.getElementById("q-next")?.addEventListener("click", () => {
    if (state.currentIndex < state.questions.length - 1) { state.currentIndex++; renderQuestion(refs); }
  });
  document.getElementById("exam-submit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitExam();
  });
}

export async function initExamPage(params) {
  const myToken = ++state.navToken;
  stopExamTimer();

  const examId = params.get("id");
  resetSessionState(examId);

  listView = document.getElementById("exam-list-view");
  verifyView = document.getElementById("exam-verify-view");
  takeView = document.getElementById("exam-take-view");
  resultView = document.getElementById("exam-result-view");

  refs = {
    questionArea: document.getElementById("question-area"),
    progressFill: document.getElementById("q-progress-fill"),
    prevBtn: document.getElementById("q-prev"),
    nextBtn: document.getElementById("q-next"),
    submitBtn: document.getElementById("q-submit"),
  };

  listView.classList.remove("hidden");
  verifyView.classList.add("hidden");
  verifyView.innerHTML = "";
  takeView.classList.add("hidden");
  resultView.classList.add("hidden");
  resultView.innerHTML = "";

  bindStaticControlsOnce();
  initNav("exam");

  state.currentUser = await requireAuth();
  if (myToken !== state.navToken) return cleanup;
  if (!state.currentUser) return cleanup;
  state.userProfile = await getUserProfile(state.currentUser.uid);
  if (myToken !== state.navToken) return cleanup;

  if (examId) {
    await runExamEntry(examId, myToken);
  } else {
    await renderExamList(document.getElementById("exam-grid"));
  }

  return cleanup;

  function cleanup() {
    stopExamTimer();
  }
}

/* ---------- Verification → rules gate → begin timed attempt ---------- */
async function runExamEntry(examId, myToken) {
  listView.classList.add("hidden");
  verifyView.classList.remove("hidden");

  const verdict = await runVerification(verifyView, examId, myToken);
  if (myToken !== state.navToken) return;
  if (!verdict.ok) return; // exam-guard.js already rendered the failure screen

  const totalMarks = getExamQuestionCount(verdict.exam);
  const gateResult = await renderRulesGate(verifyView, verdict.exam, {
    attemptsSoFar: verdict.attemptsSoFar,
    maxAttempts: verdict.maxAttempts,
    totalMarks,
  });
  if (myToken !== state.navToken) return;
  if (gateResult === "away") return;
  if (gateResult !== "confirmed") {
    navigate("#/exam");
    return;
  }

  await beginAttempt(verdict.exam, myToken);
}

async function beginAttempt(exam, myToken) {
  const questionBank = await fetchQuestions(state.examId);
  if (myToken !== state.navToken) return;
  if (!questionBank.length) {
    verifyView.innerHTML = `<div class="exs-empty"><p>This exam has no questions</p></div>`;
    return;
  }

  state.exam = exam;
  state.questions = buildQuestionPool(exam, questionBank);
  state.examLayout = exam.layout === "all" ? "all" : "one";
  state.answers = {};
  state.lockedQuestions = new Set();
  state.currentIndex = 0;
  state.secondsLeft = (exam.duration || 10) * 60;

  verifyView.classList.add("hidden");
  takeView.classList.remove("hidden");
  document.getElementById("exam-take-title").textContent = exam.title;

  const navRow = document.querySelector(".exam-nav-row");
  const progressTrack = document.querySelector(".q-progress-track");
  if (state.examLayout === "all") {
    refs.prevBtn.classList.add("hidden");
    refs.nextBtn.classList.add("hidden");
    refs.submitBtn.classList.remove("hidden");
    progressTrack.classList.add("hidden");
  } else {
    refs.prevBtn.classList.remove("hidden");
    refs.nextBtn.classList.remove("hidden");
    progressTrack.classList.remove("hidden");
  }
  navRow.classList.remove("hidden");

  const timerEl = document.getElementById("exam-timer");
  startExamTimer(
    (secondsLeft) => {
      timerEl.innerHTML = `<i class="fa-solid fa-stopwatch"></i> ${formatClock(secondsLeft)}`;
      timerEl.classList.toggle("low", secondsLeft <= 60);
    },
    () => {
      toast("Time's up! Submitting your answers...", "error");
      submitExam();
    }
  );

  if (state.examLayout === "all") renderAllQuestions(refs);
  else renderQuestion(refs);
}

async function submitExam() {
  stopExamTimer();
  const exam = state.exam;
  const breakdown = scoreExam(exam);
  const attemptNumber = state.attemptsSoFar + 1;
  const examTitle = exam?.title || document.getElementById("exam-take-title").textContent;

  await saveResult({
    uid: state.currentUser.uid,
    examId: state.examId,
    examTitle,
    score: breakdown.score,
    total: state.questions.length,
    percent: breakdown.percent,
    correctCount: breakdown.correctCount,
    wrongCount: breakdown.wrongCount,
    unansweredCount: breakdown.unansweredCount,
    negativeMarking: breakdown.negativeMarking,
    timeTakenSeconds: breakdown.timeTakenSeconds,
    answers: state.answers,
    attemptNumber,
  });

  takeView.classList.add("hidden");
  resultView.classList.remove("hidden");
  renderResult(resultView, {
    score: breakdown.score,
    total: state.questions.length,
    percent: breakdown.percent,
    examTitle,
    breakdown,
    onDownloadPdf: () => downloadResultPDF(breakdown.score, state.questions.length, breakdown.percent, examTitle, breakdown),
  });
}
