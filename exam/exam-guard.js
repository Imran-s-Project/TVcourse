// ==========================================================================
// exam-guard.js — the exam section's own entry gate.
// Mirrors the shape of js/utils.js's requireAdmin() (a guard that runs a
// check and only lets the visit continue if it passes) but the checks
// themselves are entirely different: not a role check, but exam-specific
// eligibility — enrollment, publish/close window, and attempts left — shown
// to the student step-by-step instead of happening silently. Only after
// every step passes AND the student explicitly accepts the exam rules does
// this resolve "confirmed", which is the one signal exam.js uses to move
// from the verification screen into the actual timed attempt.
// ==========================================================================
import { escapeHtml, getExamAvailability, formatDateTime } from "../js/utils.js";
import { getCourseLockInfo, getAttemptsCount, fetchExam } from "./exam-data.js";
import { navigate } from "../js/router.js";
import { state } from "./exam-engine.js";

const STEP_LABELS = [
  { key: "auth", label: "Account verification" },
  { key: "access", label: "Course/Exam access" },
  { key: "window", label: "Exam time window" },
  { key: "attempts", label: "Attempt count" },
];

function stepRowHtml(key, label, status) {
  // status: "pending" | "ok" | "fail"
  const icon = status === "ok" ? '<i class="fa-solid fa-circle-check"></i>'
    : status === "fail" ? '<i class="fa-solid fa-circle-xmark"></i>'
    : '<i class="fa-solid fa-spinner fa-spin"></i>';
  return `<div class="exs-verify-step exs-verify-step--${status}" data-step="${key}">
    <span class="exs-verify-step-icon">${icon}</span>
    <span class="exs-verify-step-label">${label}</span>
  </div>`;
}

function renderStepList(container, statuses) {
  container.innerHTML = `
    <div class="exs-verify-card">
      <div class="exs-verify-head">
        <i class="fa-solid fa-shield-halved"></i>
        <div>
          <h2>Verifying Access</h2>
          <p>Confirming a few things before you enter the exam section</p>
        </div>
      </div>
      <div class="exs-verify-steps">
        ${STEP_LABELS.map((s) => stepRowHtml(s.key, s.label, statuses[s.key] || "pending")).join("")}
      </div>
    </div>`;
}

function setStep(container, key, status) {
  const row = container.querySelector(`[data-step="${key}"]`);
  if (!row) return;
  row.className = `exs-verify-step exs-verify-step--${status}`;
  row.querySelector(".exs-verify-step-icon").innerHTML =
    status === "ok" ? '<i class="fa-solid fa-circle-check"></i>'
    : status === "fail" ? '<i class="fa-solid fa-circle-xmark"></i>'
    : '<i class="fa-solid fa-spinner fa-spin"></i>';
}

function failScreen(container, { title, message, backLabel, backHref }) {
  container.innerHTML = `
    <div class="exs-verify-card exs-verify-card--fail">
      <div class="exs-verify-head exs-verify-head--fail">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
      <a href="${backHref}" class="btn btn-outline btn-block">${escapeHtml(backLabel)}</a>
    </div>`;
}

/* ---------- Runs the full verification sequence, updating the checklist live.
   Returns { ok:true, exam } once everything passes, or { ok:false } after
   rendering the failure screen itself (caller does nothing further). ---------- */
export async function runVerification(container, examId, myToken) {
  const statuses = {};
  renderStepList(container, statuses);

  // Step 1 — auth (by the time this runs, initExamPage already resolved
  // requireAuth(), so this step is really just making the check visible)
  setStep(container, "auth", "ok");

  const exam = await fetchExam(examId);
  if (myToken !== state.navToken) return { ok: false };
  if (!exam) {
    failScreen(container, {
      title: "Exam Not Found",
      message: "This exam may have been removed, or the link is incorrect.",
      backLabel: "View All Exams",
      backHref: "#/exam",
    });
    return { ok: false };
  }

  // Step 2 — course/exam access (paid-course lock)
  const { locked } = await getCourseLockInfo(exam.courseId, state.userProfile);
  if (myToken !== state.navToken) return { ok: false };
  if (locked) {
    setStep(container, "access", "fail");
    failScreen(container, {
      title: "This Exam Is Locked",
      message: "This is part of a paid course — you'll need to purchase the course before taking the exam.",
      backLabel: "Go to Course Page",
      backHref: `#/course?id=${exam.courseId}`,
    });
    return { ok: false };
  }
  setStep(container, "access", "ok");

  // Step 3 — publish/close window
  const courseBackHref = `#/exam?course=${encodeURIComponent(exam.courseId || "general")}`;
  const { state: availState, publishAt, closesAt } = getExamAvailability(exam);
  if (availState === "upcoming") {
    setStep(container, "window", "fail");
    failScreen(container, {
      title: "This Exam Hasn't Started Yet",
      message: `This exam will open on ${formatDateTime(publishAt)}.`,
      backLabel: "Back to This Course's Exams",
      backHref: courseBackHref,
    });
    return { ok: false };
  }
  if (availState === "closed") {
    setStep(container, "window", "fail");
    failScreen(container, {
      title: "Exam Time Has Ended",
      message: `This exam was open until ${formatDateTime(closesAt)}.`,
      backLabel: "Back to This Course's Exams",
      backHref: courseBackHref,
    });
    return { ok: false };
  }
  setStep(container, "window", "ok");

  // Step 4 — attempts remaining
  const maxAttempts = Number(exam.maxAttempts || 0);
  let attemptsSoFar = 0;
  if (maxAttempts > 0) {
    attemptsSoFar = await getAttemptsCount(state.currentUser.uid, examId);
    if (myToken !== state.navToken) return { ok: false };
    if (attemptsSoFar >= maxAttempts) {
      setStep(container, "attempts", "fail");
      failScreen(container, {
        title: "Attempts Exhausted",
        message: `This exam allows a maximum of ${maxAttempts} attempts — you've already used them all.`,
        backLabel: "Back to This Course's Exams",
        backHref: courseBackHref,
      });
      return { ok: false };
    }
  }
  setStep(container, "attempts", "ok");
  state.attemptsSoFar = attemptsSoFar;

  return { ok: true, exam, attemptsSoFar, maxAttempts };
}

/* ---------- Rules/instructions screen — the last gate before the timer starts.
   Resolves "confirmed" only on an explicit click; "cancelled" for Back;
   "away" if the student navigated elsewhere while this was showing. ---------- */
export function renderRulesGate(container, exam, { attemptsSoFar, maxAttempts, totalMarks }) {
  return new Promise((resolve) => {
    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      window.removeEventListener("hashchange", onNavigateAway);
      resolve(result);
    }
    function onNavigateAway() { finish("away"); }
    window.addEventListener("hashchange", onNavigateAway);

    const attemptLine = maxAttempts > 0
      ? `<li>This will be attempt <b>${attemptsSoFar + 1}</b> of <b>${maxAttempts}</b> allowed.</li>`
      : "";

    container.innerHTML = `
      <div class="exs-verify-card exs-rules-card">
        <div class="exs-verify-head exs-verify-head--ok">
          <i class="fa-solid fa-clipboard-check"></i>
          <div>
            <h2>${escapeHtml(exam.title)}</h2>
            <p>Access verified — please read the rules before starting</p>
          </div>
        </div>

        <div class="exs-rules-stats">
          <div class="exs-rules-stat"><span>Duration</span><b>${exam.duration || 10} min</b></div>
          <div class="exs-rules-stat"><span>Total Marks</span><b>${totalMarks}</b></div>
        </div>

        <ul class="exs-rules-list">
          <li>Once the exam starts, the timer will not stop — make sure you're ready before beginning.</li>
          <li>You must finish the exam within ${exam.duration || 10} minutes — the timer starts the moment you press "Start Exam".</li>
          <li>Questions can be viewed in any order, but as soon as you select an answer it locks in — it cannot be changed afterward.</li>
          <li>Do not refresh or close the page during the exam — your progress is only saved for this session.</li>
          <li>When time runs out, whatever answers have been given will be submitted automatically.</li>
          ${attemptLine}
        </ul>

        <div class="exs-rules-actions">
          <a href="#/exam?course=${encodeURIComponent(exam.courseId || "general")}" class="btn btn-outline btn-block">Go Back</a>
          <button type="button" class="btn btn-primary btn-block" id="exs-start-confirm">Start Exam <i class="fa-solid fa-arrow-right"></i></button>
        </div>
      </div>`;

    container.querySelector("#exs-start-confirm").addEventListener("click", () => finish("confirmed"));
    // The Back link is a normal hash navigation — the hashchange listener
    // above already resolves "away" for it, so no extra handler is needed.
  });
}

export { navigate };
