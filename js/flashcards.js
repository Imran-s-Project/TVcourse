// ==========================================================================
// flashcards.js — Spaced-repetition flashcard review (student side)
// Cards are created by admins in admin.html (see admin-hub.js); this file
// just handles reviewing them with a lightweight SM-2-style scheduler, all
// computed/stored client-side (no Cloud Functions, 100% free).
// Deliberately flat/strong — no gradients, glows, or blur-shadows; see the
// "Flashcards" block in css/hub.css for the design rationale.
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  collection, getDocs, doc, setDoc, updateDoc, increment, query, where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { escapeHtml, toast } from "./utils.js";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Simplified SM-2 scheduler. grade: "again" | "hard" | "good" | "easy" */
function nextSchedule(progress, grade) {
  let { ease = 2.5, interval = 0, reps = 0 } = progress || {};
  if (grade === "again") {
    reps = 0; interval = 0; ease = Math.max(1.3, ease - 0.2);
  } else {
    reps += 1;
    if (grade === "hard") {
      interval = reps === 1 ? 1 : Math.max(1, Math.round(interval * 1.2));
      ease = Math.max(1.3, ease - 0.15);
    } else if (grade === "good") {
      interval = reps === 1 ? 1 : Math.round(interval * ease);
    } else { // easy
      interval = reps === 1 ? 3 : Math.round(interval * ease * 1.3);
      ease = ease + 0.15;
    }
  }
  return { ease, interval, reps, dueDate: grade === "again" ? todayKey() : addDays(interval) };
}

function doneScreenHtml({ icon, title, sub }) {
  return `
    <div class="fc-shell">
      <div class="fc-done">
        <div class="fc-done-icon"><i class="fa-solid ${icon}"></i></div>
        <h3>${title}</h3>
        <p class="muted">${sub}</p>
      </div>
    </div>`;
}

export async function renderFlashcardsTab(container, user, profile) {
  container.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;

  const [cardsSnap, progressSnap] = await Promise.all([
    getDocs(collection(db, "flashcards")),
    getDocs(collection(db, "users", user.uid, "flashcardProgress")).catch(() => ({ docs: [] })),
  ]);

  const enrolled = profile?.enrolledCourses || [];
  const allCards = cardsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => !c.courseId || enrolled.includes(c.courseId));

  const progressMap = {};
  progressSnap.docs.forEach((d) => { progressMap[d.id] = d.data(); });

  const today = todayKey();
  const dueCards = allCards.filter((c) => {
    const p = progressMap[c.id];
    return !p || !p.dueDate || p.dueDate <= today;
  });

  if (!allCards.length) {
    container.innerHTML = doneScreenHtml({
      icon: "fa-layer-group",
      title: "No flashcards yet",
      sub: "None are available for your enrolled courses yet — check back after your instructor adds some.",
    });
    return;
  }

  if (!dueCards.length) {
    const nextDue = allCards
      .map((c) => progressMap[c.id]?.dueDate)
      .filter(Boolean)
      .sort()[0];
    container.innerHTML = doneScreenHtml({
      icon: "fa-circle-check",
      title: "All caught up!",
      sub: `You've reviewed every due flashcard.${nextDue ? ` Next review: ${nextDue}.` : ""}`,
    });
    return;
  }

  const totalCount = dueCards.length;
  let queue = shuffle([...dueCards]);
  let reviewedCount = 0;
  let flipped = false;

  function renderCard() {
    if (!queue.length) {
      container.innerHTML = doneScreenHtml({
        icon: "fa-circle-check",
        title: "Session complete!",
        sub: `You reviewed ${reviewedCount} card${reviewedCount === 1 ? "" : "s"}. Come back tomorrow for more.`,
      });
      return;
    }
    flipped = false;
    const card = queue[0];
    const pct = Math.round((reviewedCount / totalCount) * 100);
    container.innerHTML = `
      <div class="fc-shell">
        <div class="fc-top-row">
          <span class="fc-progress-text">${reviewedCount}/${totalCount} reviewed</span>
          ${card.courseTitle ? `<span class="badge badge-teal">${escapeHtml(card.courseTitle)}</span>` : `<span class="badge">General</span>`}
        </div>
        <div class="fc-progress-track"><div class="fc-progress-fill" style="width:${pct}%"></div></div>

        <div class="fc-flip" id="flashcard-flip">
          <span class="fc-face-label" id="flashcard-face-label">Question</span>
          <div class="fc-face fc-front">${escapeHtml(card.front)}</div>
          <div class="fc-face fc-back hidden">${escapeHtml(card.back)}</div>
        </div>
        <p class="fc-hint" id="flashcard-hint"><i class="fa-solid fa-hand-pointer"></i> Tap the card to reveal the answer</p>

        <div class="fc-grade-row hidden" id="flashcard-grade-row">
          <button type="button" class="fc-grade-btn fc-grade-again" data-grade="again">Again</button>
          <button type="button" class="fc-grade-btn fc-grade-hard" data-grade="hard">Hard</button>
          <button type="button" class="fc-grade-btn fc-grade-good" data-grade="good">Good</button>
          <button type="button" class="fc-grade-btn fc-grade-easy" data-grade="easy">Easy</button>
        </div>
      </div>
    `;

    document.getElementById("flashcard-flip")?.addEventListener("click", () => {
      if (flipped) return;
      flipped = true;
      document.querySelector(".fc-back")?.classList.remove("hidden");
      document.getElementById("flashcard-grade-row")?.classList.remove("hidden");
      document.getElementById("flashcard-hint").innerHTML = '<i class="fa-solid fa-circle-question"></i> How well did you know it?';
      document.getElementById("flashcard-face-label").textContent = "Answer";
    });

    document.getElementById("flashcard-grade-row")?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".fc-grade-btn");
      if (!btn) return;
      const grade = btn.dataset.grade;
      await gradeCard(card, grade);
      if (grade === "again") {
        queue.push(queue.shift()); // reinforce later in this same session
      } else {
        queue.shift();
        reviewedCount += 1;
      }
      renderCard();
    });
  }

  async function gradeCard(card, grade) {
    const sched = nextSchedule(progressMap[card.id], grade);
    progressMap[card.id] = sched;
    try {
      await setDoc(doc(db, "users", user.uid, "flashcardProgress", card.id), sched, { merge: true });
      await updateDoc(doc(db, "users", user.uid), { flashcardReviewCount: increment(1) });
      const { computeAndSyncBadges } = await import("./badges.js");
      await computeAndSyncBadges(user.uid, { ...(profile || {}), flashcardReviewCount: (profile?.flashcardReviewCount || 0) + 1 });
    } catch {
      toast("Couldn't save your review progress — please check your connection.", "error");
    }
  }

  renderCard();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
