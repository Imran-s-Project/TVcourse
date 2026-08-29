// ==========================================================================
// exam-data.js — every Firestore read/write the exam section needs.
// Kept separate from rendering/engine logic so the DB shape can change
// without touching a single line of UI code.
// ==========================================================================
import { db } from "../js/firebase-config.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  orderBy,
  setDoc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getCoursePricing } from "../js/utils.js";

export async function fetchAllExams() {
  // No orderBy() on purpose: Firestore silently drops any document missing
  // the sorted field, so an exam saved without createdAt would vanish from
  // the list entirely. Fetch everything, sort client-side instead.
  const snap = await getDocs(collection(db, "exams"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function fetchExam(examId) {
  const snap = await getDoc(doc(db, "exams", examId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function fetchQuestions(examId) {
  const snap = await getDocs(query(collection(db, "exams", examId, "questions"), orderBy("order", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchResult(uid, examId) {
  try {
    const snap = await getDoc(doc(db, "results", `${uid}_${examId}`));
    return snap.exists() ? snap.data() : null;
  } catch {
    // Permission-denied is expected/normal when the result doc doesn't exist yet
    return null;
  }
}

/* ---------- Attempts so far, counted from the results doc's attemptNumber ----------
   Not from a separate "examAttempts" query — that write is best-effort/silently
   swallowed on failure (see saveResult below), so counting from it would let
   "max attempts" silently stop being enforced if Firestore rules ever block it.
   The results doc write is NOT best-effort (submission fails loudly if it fails),
   so its attemptNumber is the reliable source of truth. ---------- */
const attemptsCache = {};
export async function getAttemptsCount(uid, examId) {
  if (attemptsCache[examId] !== undefined) return attemptsCache[examId];
  const result = await fetchResult(uid, examId);
  const count = Number(result?.attemptNumber || 0);
  attemptsCache[examId] = count;
  return count;
}
export function bumpAttemptsCache(examId, attemptNumber) {
  attemptsCache[examId] = attemptNumber;
}

/* ---------- Whether an exam tied to a paid course is locked for this user ---------- */
const courseLockCache = {};
export async function getCourseLockInfo(courseId, userProfile) {
  if (!courseId) return { locked: false };
  if (courseLockCache[courseId] !== undefined) return courseLockCache[courseId];
  try {
    const courseSnap = await getDoc(doc(db, "courses", courseId));
    if (!courseSnap.exists()) return (courseLockCache[courseId] = { locked: false });
    if (!getCoursePricing(courseSnap.data()).isPaid) return (courseLockCache[courseId] = { locked: false });
    // Single source of truth: users/{uid}.enrolledCourses — same field the admin
    // panel's "Revoke" button edits and the course page reads.
    const info = { locked: !userProfile?.enrolledCourses?.includes(courseId) };
    courseLockCache[courseId] = info;
    return info;
  } catch {
    return (courseLockCache[courseId] = { locked: false });
  }
}

export async function saveResult(payload) {
  await setDoc(doc(db, "results", `${payload.uid}_${payload.examId}`), {
    ...payload,
    submittedAt: serverTimestamp(),
  });
  bumpAttemptsCache(payload.examId, payload.attemptNumber);

  try {
    await addDoc(collection(db, "examAttempts"), {
      ...payload,
      submittedAt: serverTimestamp(),
    });
  } catch {
    // Best-effort history log only — never blocks showing the result
  }
}
