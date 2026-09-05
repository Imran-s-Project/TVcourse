// ==========================================================================
// parent-data.js — every Firestore read/write the Parent Dashboard feature
// needs (link codes, linking/unlinking, and pulling a linked child's course
// progress + exam results). Kept separate from js/page-parent.js the same
// way exam/exam-data.js is kept separate from the exam UI files — the DB
// shape can change here without touching a single line of rendering code.
//
// Data model (see firestore.rules.txt for the matching security rules):
//   users/{uid}.role            "student" (default) | "parent"
//   users/{uid}.linkedParents   array<uid> — students only, who can view them
//   users/{uid}.linkedChildren  array<uid> — parents only, who they can view
//   users/{uid}.linkCode        the student's current active link code
//   linkCodes/{code}            { uid: studentUid, createdAt } — reverse lookup
// ==========================================================================
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getUserProfile } from "./utils.js";
import { loadHubStats, BADGE_DEFS } from "./badges.js";

/* ---------- Random, unguessable link code ----------
   10 characters from a 32-symbol alphabet (no 0/O/1/I — easy to misread and
   easy to mix up when a parent is copying it off a phone screen) — about 50
   bits of entropy, more than enough since linkCodes/{code} disallows list()
   in the security rules (see firestore.rules.txt), so brute force can only
   ever happen one guess-write at a time. ---------- */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode(length = 10) {
  let out = "";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/* ---------- Get this student's active link code, creating one on first use ----------
   Denormalized onto users/{uid}.linkCode (a self-write, always allowed) so
   the Family tab can show/copy it without an extra Firestore read. */
export async function getOrCreateLinkCode(uid) {
  const profile = await getUserProfile(uid);
  if (profile?.linkCode) return profile.linkCode;
  return regenerateLinkCode(uid, profile?.linkCode);
}

/* ---------- Regenerate: makes the old code stop working and issues a fresh one.
   Existing linked parents are NOT affected — regenerating only closes the
   door to new links via the old code. ---------- */
export async function regenerateLinkCode(uid, oldCode) {
  const code = generateCode();
  await setDoc(doc(db, "linkCodes", code), { uid, createdAt: serverTimestamp() });
  await updateDoc(doc(db, "users", uid), { linkCode: code });
  if (oldCode) {
    await deleteDoc(doc(db, "linkCodes", oldCode)).catch(() => {
      // Best-effort cleanup only — an orphaned old code doc is harmless
      // (it just keeps pointing at the same student), never blocks the UI.
    });
  }
  return code;
}

/* ---------- Link a child to the current parent account by code ----------
   Two writes, in order:
     1) child doc: linkedParents += parentUid  (needs lastVerifiedCode — see rules)
     2) parent doc: linkedChildren += childUid (plain self-write)
   If step 1 fails (bad/expired code) step 2 never runs. ---------- */
export async function linkChildByCode(parentUid, rawCode) {
  const code = (rawCode || "").trim().toUpperCase();
  if (!code) throw new Error("Please enter a link code.");

  const codeSnap = await getDoc(doc(db, "linkCodes", code)).catch(() => null);
  if (!codeSnap || !codeSnap.exists()) {
    throw new Error("That link code isn't valid. Please double-check it with your child.");
  }
  const childUid = codeSnap.data().uid;
  if (!childUid) throw new Error("That link code isn't valid.");
  if (childUid === parentUid) throw new Error("You can't link your own account.");

  const parentProfile = await getUserProfile(parentUid);
  if ((parentProfile?.linkedChildren || []).includes(childUid)) {
    throw new Error("This account is already linked.");
  }

  try {
    await updateDoc(doc(db, "users", childUid), {
      linkedParents: arrayUnion(parentUid),
      lastVerifiedCode: code,
    });
    await updateDoc(doc(db, "users", parentUid), {
      linkedChildren: arrayUnion(childUid),
    });
  } catch (err) {
    // A permission-denied here almost never means the code is wrong (that's
    // already been checked above) — it means this project's live Firestore
    // Security Rules don't yet match firestore.rules.txt (either they were
    // never published, or an older version without the Guardian-linking
    // clauses is still live). Say so plainly instead of a generic failure,
    // since "try a different code" would send someone chasing the wrong fix.
    if (err.code === "permission-denied") {
      throw new Error(
        "Linking was blocked by the database's security rules. Ask the site admin to publish the latest firestore.rules.txt in the Firebase Console (Firestore Database → Rules)."
      );
    }
    throw err;
  }

  return childUid;
}

/* ---------- Unlink — works from either side ----------
   Removing the child from the parent's own linkedChildren is always a plain
   self-write. Removing the parent from the child's linkedParents needs no
   code proof in the rules (only *adding* does) — a parent can always walk
   away, and a child can always revoke access. ---------- */
export async function unlinkChild(parentUid, childUid) {
  await updateDoc(doc(db, "users", parentUid), {
    linkedChildren: arrayRemove(childUid),
  }).catch(() => {});
  await updateDoc(doc(db, "users", childUid), {
    linkedParents: arrayRemove(parentUid),
  }).catch(() => {
    // The parent may have already lost read/write access if the child
    // revoked first — the parent-side removal above is what matters most.
  });
}

/* Child-initiated revoke of one linked parent, from the Family tab. */
export async function revokeParent(childUid, parentUid) {
  await updateDoc(doc(db, "users", childUid), {
    linkedParents: arrayRemove(parentUid),
  });
}

/* ---------- Course progress for one linked child ----------
   Mirrors the exact pct/status calculation in js/page-mycourses.js so the
   parent sees the same numbers the child sees on "My Courses". ---------- */
async function loadChildCourses(childProfile) {
  const enrolled = childProfile?.enrolledCourses || [];
  if (!enrolled.length) return [];
  const snaps = await Promise.all(
    enrolled.map((id) => getDoc(doc(db, "courses", id)).catch(() => null))
  );
  return snaps
    .filter((s) => s && s.exists())
    .map((s) => {
      const c = { id: s.id, ...s.data() };
      const doneMap = childProfile?.progress?.[c.id] || {};
      const doneCount = Object.values(doneMap).filter(Boolean).length;
      const pct = c.lessonCount ? Math.round((doneCount / c.lessonCount) * 100) : 0;
      const status = c.lessonCount > 0 && pct >= 100 ? "completed" : pct > 0 ? "in-progress" : "not-started";
      return { ...c, pct, status };
    })
    .sort((a, b) => b.pct - a.pct);
}

/* ---------- Exam results for one linked child (most recent first) ---------- */
async function loadChildResults(childUid) {
  const snap = await getDocs(query(collection(db, "results"), where("uid", "==", childUid))).catch(() => null);
  if (!snap) return [];
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
}

/* ---------- Learning activity + achievements for one linked child ----------
   Reuses js/badges.js's loadHubStats() — the exact same stats engine the
   child's own Learning Hub uses — so a Guardian never sees a streak, badge,
   or activity count that could disagree with what the student sees on
   their own Achievements tab. Only the badges actually EARNED are returned
   (each resolved to its full title/icon/desc/color from BADGE_DEFS) — a
   Guardian sees accomplishments, not a spoiler list of what's still locked. */
async function loadChildActivity(childUid, profile) {
  const stats = await loadHubStats(childUid, profile);
  const earnedBadges = BADGE_DEFS.filter((b) => stats.earnedBadgeIds.includes(b.id));
  return { stats, earnedBadges };
}

/* ---------- Full dashboard payload for one linked child ----------
   Returns null if the profile can no longer be read (access was revoked
   from the child's side since the parent last linked) — the caller uses
   that to silently drop the child from the switcher instead of erroring. */
export async function fetchChildDashboard(childUid) {
  const profile = await getUserProfile(childUid).catch(() => null);
  if (!profile) return null;
  const [courses, results, activity] = await Promise.all([
    loadChildCourses(profile),
    loadChildResults(childUid),
    loadChildActivity(childUid, profile).catch(() => ({ stats: null, earnedBadges: [] })),
  ]);
  return { profile, courses, results, activity };
}

/* ---------- All linked children for a parent, each with its dashboard payload ----------
   Fetched in parallel; any child that's become unreadable (revoked) is
   quietly dropped from the list AND cleaned out of the parent's own
   linkedChildren array so it doesn't keep showing up as a dead entry. */
export async function fetchAllChildren(parentUid, parentProfile) {
  const ids = parentProfile?.linkedChildren || [];
  if (!ids.length) return [];
  const results = await Promise.all(ids.map((id) => fetchChildDashboard(id)));
  const alive = [];
  const stale = [];
  results.forEach((r, i) => (r ? alive.push(r) : stale.push(ids[i])));
  if (stale.length) {
    await Promise.all(
      stale.map((id) =>
        updateDoc(doc(db, "users", parentUid), { linkedChildren: arrayRemove(id) }).catch(() => {})
      )
    );
  }
  return alive;
}
