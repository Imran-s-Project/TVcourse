// ==========================================================================
// dashboard.js — Homepage: course list, search, filter, continue learning
// Exported as initDashboard() for use by the SPA router (app.js).
// All course links now use hash routing: #/course?id=xxx
// ==========================================================================
import { db, auth } from "./firebase-config.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  initNav, getUserProfile, escapeHtml, toBnDigits,
  videoThumbnail, videoEmbedUrl, isDirectVideo, openModal,
  getCoursePricing, priceBadgeHtml,
} from "./utils.js";
import { courseUrl } from "./router.js";

// ── State ──────────────────────────────────────────────────────────────────
let allCourses = [];
let currentUserProfile = null;
let activeCategory = "All";

// ── DOM refs (resolved lazily so they work when initDashboard() is called) ─
function dom(id) { return document.getElementById(id); }

// ── Public init — called once by app.js ───────────────────────────────────
export async function initDashboard() {
  initNav("home");
  await Promise.all([loadHeroSettings(), loadFeaturedVideos()]);

  const searchInput = dom("hero-search-input");
  searchInput?.addEventListener("input", renderCourses);

  // Hero search button
  dom("hero-search-btn")?.addEventListener("click", renderCourses);

  onAuthStateChanged(auth, (user) => {
    loadCourses().then(() => renderContinueLearning(user));
  });
}

// ── Courses ────────────────────────────────────────────────────────────────
async function loadCourses() {
  const grid = dom("course-grid");
  grid.innerHTML = `<div class="loading-screen"><span class="spinner"></span> Loading courses...</div>`;
  try {
    const snap = await getDocs(collection(db, "courses"));
    allCourses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const statCourses = dom("stat-courses");
    if (statCourses) statCourses.textContent = toBnDigits(allCourses.length);
    renderCategories();
    renderCourses();
  } catch {
    dom("course-grid").innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-book-open"></i></div><p>Could not load courses. Check whether Firebase is configured.</p></div>`;
  }
}

function renderCategories() {
  const categoryRow = dom("category-row");
  const cats = ["All", ...new Set(allCourses.map((c) => c.category).filter(Boolean))];
  categoryRow.innerHTML = cats
    .map((c) => `<button class="chip ${c === activeCategory ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join("");
  categoryRow.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      renderCategories();
      renderCourses();
    });
  });
}

function courseProgress(course) {
  if (!currentUserProfile) return 0;
  const done = currentUserProfile.progress?.[course.id];
  if (!done || !course.lessonCount) return 0;
  const completed = Object.values(done).filter(Boolean).length;
  return Math.min(100, Math.round((completed / course.lessonCount) * 100));
}

function renderCourses() {
  const grid = dom("course-grid");
  const searchInput = dom("hero-search-input");
  const term = (searchInput?.value || "").trim().toLowerCase();
  const filtered = allCourses.filter((c) => {
    const matchCat = activeCategory === "All" || c.category === activeCategory;
    const matchTerm = !term || c.title?.toLowerCase().includes(term) || c.description?.toLowerCase().includes(term);
    return matchCat && matchTerm;
  });

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-magnifying-glass"></i></div><p>No courses found</p></div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((c) => {
      const progress = courseProgress(c);
      const ribbonH = progress > 0 ? 40 + progress * 0.35 : 0;
      const { isPaid } = getCoursePricing(c);
      const hasAccess = !isPaid || (currentUserProfile?.enrolledCourses || []).includes(c.id);
      const owned = isPaid && hasAccess;

      // Hash-based course links
      const btnRow = hasAccess
        ? `<a class="course-card-btn view" href="${courseUrl(c.id)}"><i class="fa-solid fa-play"></i> View Course</a>`
        : `<a class="course-card-btn buy" href="${courseUrl(c.id, 'buy')}"><i class="fa-solid fa-tag"></i> Buy</a>
           <a class="course-card-btn access" href="${courseUrl(c.id, 'access')}"><i class="fa-solid fa-lock-open"></i> Access Now</a>`;

      return `
      <div class="course-card">
        ${progress > 0 ? `<div class="bookmark-ribbon ${progress >= 100 ? "done" : ""}" style="height:${ribbonH}px"></div>` : ""}
        <a href="${courseUrl(c.id)}" class="course-cover" style="background-image:url('${c.coverImage || ""}')">
          <span class="badge badge-amber">${escapeHtml(c.category || "Course")}</span>
          ${priceBadgeHtml(c, "price-badge", owned)}
        </a>
        <div class="course-body">
          <div class="course-tag-row">
            ${c.category ? `<span class="tag-pill">${escapeHtml(c.category)}</span>` : ""}
            ${c.enrollCount > 0 ? `<span class="tag-pill tag-pill-dark"><i class="fa-solid fa-users"></i> ${c.enrollCount} enrolled</span>` : ""}
          </div>
          <a href="${courseUrl(c.id)}"><h3>${escapeHtml(c.title || "Untitled Course")}</h3></a>
          <div class="instructor">${escapeHtml(c.instructor || "Tech Verse Course")}</div>
          ${progress > 0 ? `<div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>` : ""}
          <div class="course-meta">
            <span>${c.lessonCount || 0} videos</span>
            ${progress > 0 ? `<span>${progress}% complete</span>` : ""}
          </div>
          <div class="course-btn-row">${btnRow}</div>
        </div>
      </div>`;
    })
    .join("");
}

async function renderContinueLearning(user) {
  const continueSection = dom("continue-section");
  const continueStrip = dom("continue-strip");
  if (!user) {
    continueSection?.classList.add("hidden");
    return;
  }
  currentUserProfile = await getUserProfile(user.uid);
  const enrolled = currentUserProfile?.enrolledCourses || [];
  const inProgress = allCourses.filter((c) => enrolled.includes(c.id) && courseProgress(c) < 100 && courseProgress(c) > 0);

  if (!inProgress.length) {
    continueSection?.classList.add("hidden");
  } else {
    continueSection?.classList.remove("hidden");
    continueStrip.innerHTML = inProgress
      .map(
        (c) => `
      <a class="continue-card" href="${courseUrl(c.id)}">
        <h4>${escapeHtml(c.title)}</h4>
        <div class="progress-track"><div class="progress-fill" style="width:${courseProgress(c)}%"></div></div>
        <span class="muted" style="font-size:0.82rem">${courseProgress(c)}% complete — Continue</span>
      </a>`
      )
      .join("");
  }
  renderCourses();
}

// ── Hero settings ─────────────────────────────────────────────────────────
async function loadHeroSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "homepage"));
    if (!snap.exists()) return;
    const s = snap.data();
    if (s.heroEyebrow) dom("hero-eyebrow").textContent = s.heroEyebrow;
    if (s.heroTitle) dom("hero-title").innerHTML = escapeHtml(s.heroTitle);
    if (s.heroSubtitle) dom("hero-subtitle").textContent = s.heroSubtitle;
  } catch { /* default hero text */ }
}

// ── Featured videos ───────────────────────────────────────────────────────
async function loadFeaturedVideos() {
  const section = dom("featured-video-section");
  const showcase = dom("video-showcase");
  try {
    let videos = [];
    const settingsSnap = await getDoc(doc(db, "settings", "homepage"));
    const curated = settingsSnap.exists() ? settingsSnap.data().featuredLessons || [] : [];

    if (curated.length) {
      videos = curated;
    } else {
      const coursesSnap = await getDocs(query(collection(db, "courses"), orderBy("createdAt", "desc"), limit(6)));
      const results = await Promise.all(
        coursesSnap.docs.map(async (cDoc) => {
          const lessonsSnap = await getDocs(query(collection(db, "courses", cDoc.id, "lessons"), orderBy("order"), limit(1)));
          if (lessonsSnap.empty) return null;
          const l = lessonsSnap.docs[0];
          return {
            courseId: cDoc.id, lessonId: l.id, title: l.data().title,
            courseTitle: cDoc.data().title, videoURL: l.data().videoURL, duration: l.data().duration || 0,
          };
        })
      );
      videos = results.filter(Boolean);
    }

    if (!videos.length) { section.classList.add("hidden"); return; }
    section.classList.remove("hidden");
    showcase.innerHTML = videos
      .map((v, i) => {
        const thumb = videoThumbnail(v.videoURL);
        return `
        <button class="video-card" data-video-i="${i}">
          <div class="video-thumb" style="${thumb ? `background-image:url('${thumb}')` : ""}">
            <span class="play-badge"><i class="fa-solid fa-play"></i></span>
            ${v.duration ? `<span class="duration-badge">${v.duration} min</span>` : ""}
          </div>
          <div class="video-card-body">
            <h4>${escapeHtml(v.title)}</h4>
            <span class="muted" style="font-size:0.82rem">${escapeHtml(v.courseTitle || "")}</span>
          </div>
        </button>`;
      })
      .join("");

    showcase.querySelectorAll("[data-video-i]").forEach((btn) => {
      btn.addEventListener("click", () => openVideoPlayerModal(videos[Number(btn.dataset.videoI)]));
    });
  } catch {
    section.classList.add("hidden");
  }
}

function openVideoPlayerModal(v) {
  const embed = videoEmbedUrl(v.videoURL);
  const playerHtml = embed
    ? `<iframe src="${embed}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
    : isDirectVideo(v.videoURL)
    ? `<video src="${v.videoURL}" controls autoplay></video>`
    : `<a href="${v.videoURL}" target="_blank" rel="noopener" class="btn btn-primary">Watch Video</a>`;
  const overlay = openModal(`
    <div class="modal-head"><h3>${escapeHtml(v.title)}</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <div class="video-player-frame">${playerHtml}</div>
    <div class="flex items-center justify-between mt-16" style="flex-wrap:wrap; gap:10px;">
      <span class="muted" style="font-size:0.88rem;">${escapeHtml(v.courseTitle || "")}</span>
      <a href="${courseUrl(v.courseId)}" class="btn btn-outline btn-sm">View Full Course</a>
    </div>
  `);
  overlay.classList.add("video-modal");
}
