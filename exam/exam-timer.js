// ==========================================================================
// exam-timer.js — the exam-duration countdown while taking an exam, and the
// small "opens in Xh Ym" live chips shown on upcoming-exam cards.
// ==========================================================================
import { formatTime } from "../js/utils.js";
import { state } from "./exam-engine.js";

let timerInterval = null;

export function stopExamTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/* onTick(secondsLeft) runs every second; onExpire() runs once, when time hits 0. */
export function startExamTimer(onTick, onExpire) {
  stopExamTimer();
  timerInterval = setInterval(() => {
    state.secondsLeft--;
    onTick(Math.max(0, state.secondsLeft));
    if (state.secondsLeft <= 0) {
      stopExamTimer();
      onExpire();
    }
  }, 1000);
}

export function formatClock(seconds) {
  return formatTime(seconds);
}

/* ---------- Real-time countdown chips for upcoming exams ----------
   Finds every [data-countdown] chip inside `container`, ticks every second.
   The interval is stored on the container element so navigating away
   (which replaces innerHTML) naturally stops the old timer. ---------- */
export function startCountdowns(container) {
  if (container._countdownTimer) clearInterval(container._countdownTimer);

  function tick() {
    const chips = container.querySelectorAll("[data-countdown]");
    if (!chips.length) {
      clearInterval(container._countdownTimer);
      return;
    }
    const now = Date.now();
    chips.forEach((chip) => {
      const target = Number(chip.dataset.countdown);
      const diff = Math.max(0, target - now);
      const valEl = chip.querySelector(".countdown-val");
      if (!valEl) return;

      if (diff === 0) {
        valEl.textContent = "Starting…";
        return;
      }

      const totalSecs = Math.floor(diff / 1000);
      const d = Math.floor(totalSecs / 86400);
      const h = Math.floor((totalSecs % 86400) / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = totalSecs % 60;

      let label = "";
      if (d > 0) label = `${d}d ${h}h`;
      else if (h > 0) label = `${h}h ${m}m`;
      else if (m > 0) label = `${m}m ${s}s`;
      else label = `${s}s`;

      valEl.textContent = label;
    });
  }

  tick();
  container._countdownTimer = setInterval(tick, 1000);
}
