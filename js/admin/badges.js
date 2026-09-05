// ==========================================================================
// badges.js — Achievement badges + daily login streak for the Learning Hub
// ==========================================================================
// Badges are computed CLIENT-SIDE from data that already exists (progress,
// exam results, discussion/flashcard activity counters) — no Cloud Functions
// needed, keeping this 100% free like the rest of the site. Once a badge is
// earned it's written onto users/{uid}.badges (arrayUnion) so it's a
// permanent record even if the underlying activity is later deleted.
import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getUserProfile, escapeHtml, toast, newPillHtml, isFeatureSeen, markFeatureSeen } from "./utils.js";

/* ---------- Badge catalogue ----------
   check(stats) returns true/false. `stats` is built by loadHubStats() below. */
export const BADGE_DEFS = [
  { id: "first-lesson",     title: "First Step",        icon: "fa-shoe-prints",   color: "teal",
    desc: "Complete your very first lesson",
    check: (s) => s.completedLessonCount >= 1 },
  { id: "five-lessons",     title: "Getting Momentum",  icon: "fa-fire",          color: "amber",
    desc: "Complete 5 lessons across any courses",
    check: (s) => s.completedLessonCount >= 5 },
  { id: "course-complete",  title: "Course Conqueror",  icon: "fa-graduation-cap",color: "amber",
    desc: "Finish every lesson in a course",
    check: (s) => s.coursesCompleted >= 1 },
  { id: "course-complete-3",title: "Serial Learner",    icon: "fa-crown",         color: "amber",
    desc: "Fully complete 3 different courses",
    check: (s) => s.coursesCompleted >= 3 },
  { id: "exam-taken",       title: "Test Taker",        icon: "fa-file-pen",      color: "teal",
    desc: "Submit your first exam",
    check: (s) => s.examsTaken >= 1 },
  { id: "exam-ace",         title: "Exam Ace",          icon: "fa-medal",         color: "teal",
    desc: "Score 90% or higher on any exam",
    check: (s) => s.bestExamPct >= 90 },
  { id: "perfect-score",    title: "Perfectionist",     icon: "fa-star",          color: "coral",
    desc: "Get a perfect 100% score on an exam",
    check: (s) => s.bestExamPct >= 100 },
  { id: "exam-machine",     title: "Quiz Machine",      icon: "fa-bolt",          color: "coral",
    desc: "Submit 5 or more exams",
    check: (s) => s.examsTaken >= 5 },
  { id: "streak-3",         title: "Warming Up",        icon: "fa-fire-flame-simple", color: "green",
    desc: "Visit and learn 3 days in a row",
    check: (s) => s.streakCount >= 3 },
  { id: "streak-7",         title: "One Week Strong",   icon: "fa-calendar-week", color: "green",
    desc: "Keep a 7-day learning streak",
    check: (s) => s.streakCount >= 7 },
  { id: "streak-30",        title: "Unstoppable",       icon: "fa-rocket",        color: "green",
    desc: "Keep a 30-day learning streak",
    check: (s) => s.streakCount >= 30 },
  { id: "discussion-voice", title: "Community Voice",   icon: "fa-comments",      color: "teal",
    desc: "Post 5 discussion threads or replies",
    check: (s) => s.discussionPostCount >= 5 },
  { id: "flashcard-master", title: "Memory Master",     icon: "fa-brain",         color: "coral",
    desc: "Review 50 flashcards with spaced repetition",
    check: (s) => s.flashcardReviewCount >= 50 },
];

/* ---------- Daily login streak ----------
   Called once per auth session boot (see utils.js's onAuthStateChanged hook).
   Uses the person's LOCAL calendar date (not UTC) so "today" matches what
   they actually see on their clock. */
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function updateDailyStreak(uid) {
  if (!uid) return;
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    const streak = snap.data()?.streak || { count: 0, lastActive: "" };
    const today = localDateKey();
    if (streak.lastActive === today) return; // already counted today

    const yesterday = localDateKey(new Date(Date.now() - 86400000));
    const nextCount = streak.lastActive === yesterday ? (streak.count || 0) + 1 : 1;
    await setDoc(ref, { streak: { count: nextCount, lastActive: today } }, { merge: true });
  } catch {
    // Non-critical — a missed streak tick just means the badge shows up a day later.
  }
}

/* ---------- Gather everything badge checks need ---------- */
export async function loadHubStats(uid, profile) {
  const prof = profile || (await getUserProfile(uid)) || {};
  const progress = prof.progress || {};
  const enrolledCourses = prof.enrolledCourses || [];

  const [coursesSnap, resultsSnap] = await Promise.all([
    getDocs(collection(db, "courses")),
    getDocs(query(collection(db, "results"), where("uid", "==", uid))).catch(() => ({ docs: [] })),
  ]);
  const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  let completedLessonCount = 0;
  let coursesCompleted = 0;
  enrolledCourses.forEach((cid) => {
    const done = Object.keys(progress[cid] || {}).length;
    completedLessonCount += done;
    const course = courses.find((c) => c.id === cid);
    if (course?.lessonCount && done >= course.lessonCount) coursesCompleted += 1;
  });

  const results = resultsSnap.docs.map((d) => d.data());
  const examsTaken = results.length;
  const bestExamPct = results.reduce((max, r) => {
    const total = r.total || r.totalMax || 0;
    const score = r.score ?? r.totalScore ?? 0;
    const pct = total > 0 ? (score / total) * 100 : 0;
    return Math.max(max, pct);
  }, 0);

  return {
    completedLessonCount,
    coursesCompleted,
    examsTaken,
    bestExamPct,
    streakCount: prof.streak?.count || 0,
    discussionPostCount: prof.discussionPostCount || 0,
    flashcardReviewCount: prof.flashcardReviewCount || 0,
    earnedBadgeIds: prof.badges || [],
  };
}

/** Recomputes which badges are earned, persists any newly-earned ones, and
 *  returns { stats, earnedIds, newlyEarned } — call this after any action
 *  that could unlock a badge (lesson complete, exam submit, discussion post,
 *  flashcard review) so the person sees the toast right away. */
export async function computeAndSyncBadges(uid, profile) {
  const stats = await loadHubStats(uid, profile);
  const earnedIds = BADGE_DEFS.filter((b) => b.check(stats)).map((b) => b.id);
  const newlyEarned = earnedIds.filter((id) => !stats.earnedBadgeIds.includes(id));

  if (newlyEarned.length) {
    await updateDoc(doc(db, "users", uid), { badges: arrayUnion(...newlyEarned) }).catch(() => {});
    newlyEarned.forEach((id) => {
      const def = BADGE_DEFS.find((b) => b.id === id);
      if (def) toast(`🏅 New badge unlocked: ${def.title}!`, "success");
    });
  }
  return { stats, earnedIds, newlyEarned };
}

/* ---------- Render the Achievements tab ---------- */
export async function renderBadgesTab(container, uid, profile) {
  container.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  const { stats, earnedIds } = await computeAndSyncBadges(uid, profile);

  const streakHtml = `
    <div class="hub-streak-banner">
      <div class="hub-streak-flame"><i class="fa-solid fa-fire"></i></div>
      <div>
        <div class="hub-streak-count">${stats.streakCount}-day streak</div>
        <div class="hub-streak-sub">Visit and complete something every day to keep it alive.</div>
      </div>
    </div>`;

  const gridHtml = BADGE_DEFS.map((b) => {
    const earned = earnedIds.includes(b.id);
    return `
      <div class="badge-card ${earned ? "earned" : "locked"} badge-${b.color}">
        <div class="badge-card-icon"><i class="fa-solid ${b.icon}"></i></div>
        <div class="badge-card-title">${escapeHtml(b.title)}</div>
        <div class="badge-card-desc">${escapeHtml(b.desc)}</div>
        ${earned ? `<span class="badge-card-status"><i class="fa-solid fa-check"></i> Earned</span>` : `<span class="badge-card-status locked"><i class="fa-solid fa-lock"></i> Locked</span>`}
      </div>`;
  }).join("");

  container.innerHTML = `
    ${streakHtml}
    <div class="hub-section-label">Your Badges <span class="muted">(${earnedIds.length}/${BADGE_DEFS.length} earned)</span></div>
    <div class="badge-grid">${gridHtml}</div>
  `;
}
