// ==========================================================================
// admin/leaderboard.js — every user's exam results, ranked, for
// gift/reward decisions (CSV/PDF export included)
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  toast, escapeHtml, formatDateTime, formatScore, formatDuration, useBengaliFont,
  hasBengaliText, rasterizeTextLine, loadBengaliCanvasFont, safeSavePdf,
} from "../utils.js";
import { currentExams, loadExamsTable } from "./exams.js";

/* ==========================================================================
   Leaderboard — every user's exam results, ranked, for gift/reward decisions
   ========================================================================== */
let allResults = [];
let resultsLoaded = false;

export async function initLeaderboardSection() {
  if (!currentExams.length) await loadExamsTable();
  await loadAllUsersMap();
  populateLeaderboardExamSelect();
  // Re-fetched every time this tab is opened (rather than cached forever) since new
  // submissions can come in at any time and the admin relies on this being current.
  const list = document.getElementById("leaderboard-list");
  list.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(collection(db, "results"));
    allResults = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    resultsLoaded = true;
  } catch {
    list.innerHTML = `<div class="empty-state"><p>Could not load results — make sure the Firestore rule for "results" includes <code>|| isAdmin()</code> on read (see README)</p></div>`;
    return;
  }
  renderLeaderboard();
}

function populateLeaderboardExamSelect() {
  const sel = document.getElementById("lb-exam-select");
  const prevValue = sel.value;
  sel.innerHTML =
    `<option value="">All Exams (Combined)</option>` +
    currentExams.map((ex) => `<option value="${ex.id}">${escapeHtml(ex.title)}</option>`).join("");
  if (prevValue && currentExams.some((ex) => ex.id === prevValue)) sel.value = prevValue;
}

// Full uid → user map, kept separate from the paginated Users-tab list
// above (allUsers only holds whichever pages the admin has scrolled
// through) — the leaderboard needs every user resolvable by uid regardless
// of pagination, so it fetches once here and caches for the session.
let allUsersMap = null;
async function loadAllUsersMap() {
  if (allUsersMap) return allUsersMap;
  const snap = await getDocs(collection(db, "users"));
  allUsersMap = {};
  snap.docs.forEach((d) => (allUsersMap[d.id] = { id: d.id, ...d.data() }));
  return allUsersMap;
}

function usersMapCache() {
  return allUsersMap || {};
}

function lbRankBadge(rank) {
  if (rank === 1) return `<span class="lb-rank lb-rank-1"><i class="fa-solid fa-trophy"></i> 1</span>`;
  if (rank === 2) return `<span class="lb-rank lb-rank-2"><i class="fa-solid fa-medal"></i> 2</span>`;
  if (rank === 3) return `<span class="lb-rank lb-rank-3"><i class="fa-solid fa-medal"></i> 3</span>`;
  return `<span class="lb-rank">${rank}</span>`;
}

// A small pill showing just the score — the one thing worth seeing at a
// glance in the collapsed row, alongside name/email/photo/rank.
function lbScoreBadge(r, mode) {
  if (mode === "exam") {
    const pct = Math.max(0, Math.min(100, r.percent));
    return `<span class="lb-score-badge"><b>${formatScore(r.score)}</b>/${r.total} <span class="pct">${pct}%</span></span>`;
  }
  const avgPct = r.totalMax > 0 ? Math.max(0, Math.min(100, Math.round((r.totalScore / r.totalMax) * 100))) : 0;
  return `<span class="lb-score-badge"><b>${formatScore(r.totalScore)}</b>/${r.totalMax} <span class="pct">${avgPct}%</span></span>`;
}

// Full breakdown shown only once a row is tapped open.
function lbDetailHtml(r, mode) {
  const items =
    mode === "exam"
      ? [
          { l: "Correct", v: r.correctCount ?? "—" },
          { l: "Wrong", v: r.wrongCount ?? "—" },
          { l: "Unanswered", v: r.unansweredCount ?? "—" },
          { l: "Time Taken", v: r.timeTakenSeconds != null ? formatDuration(r.timeTakenSeconds) : "—" },
          { l: "Attempt", v: r.attemptNumber },
          { l: "Submitted", v: formatDateTime(r.submittedAt) },
        ]
      : [
          { l: "Exams Taken", v: r.examsTaken },
          { l: "Avg Score", v: `${r.totalMax > 0 ? Math.max(0, Math.min(100, Math.round((r.totalScore / r.totalMax) * 100))) : 0}%` },
          { l: "Total Time", v: formatDuration(r.totalTime) },
          { l: "Last Activity", v: r.lastSubmittedTs ? formatDateTime(r.lastSubmittedTs) : "—" },
        ];
  return `<div class="lb-detail-grid">${items.map((it) => `<div class="lb-detail-item"><span class="l">${it.l}</span><span class="v">${it.v}</span></div>`).join("")}</div>`;
}

function renderLeaderboard() {
  const examId = document.getElementById("lb-exam-select").value;
  const sortMode = document.getElementById("lb-sort-select").value;
  const searchTerm = document.getElementById("lb-search-input").value.trim().toLowerCase();
  const usersMap = usersMapCache();
  const statGrid = document.getElementById("lb-stat-grid");
  const mode = examId ? "exam" : "combined";

  let rows;
  if (mode === "exam") {
    rows = allResults
      .filter((r) => r.examId === examId)
      .map((r) => ({
        uid: r.uid,
        score: Number(r.score) || 0,
        total: r.total || 0,
        percent: r.percent ?? Math.round(((Number(r.score) || 0) / (r.total || 1)) * 100),
        correctCount: r.correctCount,
        wrongCount: r.wrongCount,
        unansweredCount: r.unansweredCount,
        timeTakenSeconds: r.timeTakenSeconds,
        attemptNumber: r.attemptNumber || 1,
        submittedAt: r.submittedAt,
      }));
  } else {
    const byUser = {};
    allResults.forEach((r) => {
      if (!byUser[r.uid]) byUser[r.uid] = { uid: r.uid, totalScore: 0, totalMax: 0, examsTaken: 0, totalTime: 0, lastSubmittedSec: 0, lastSubmittedTs: null };
      const agg = byUser[r.uid];
      agg.totalScore += Number(r.score) || 0;
      agg.totalMax += r.total || 0;
      agg.examsTaken += 1;
      agg.totalTime += Number(r.timeTakenSeconds) || 0;
      const sec = r.submittedAt?.seconds || 0;
      if (sec >= agg.lastSubmittedSec) { agg.lastSubmittedSec = sec; agg.lastSubmittedTs = r.submittedAt; }
    });
    rows = Object.values(byUser);
  }

  // ---------- Search filter (by user's display name or email) ----------
  if (searchTerm) {
    rows = rows.filter((r) => {
      const u = usersMap[r.uid];
      return (u?.displayName || "").toLowerCase().includes(searchTerm) || (u?.email || "").toLowerCase().includes(searchTerm);
    });
  }

  // ---------- Sort — "smart" considers score first, then speed as the tiebreaker, exactly
  // like a real exam leaderboard (whoever scored highest wins; if tied, whoever finished
  // faster wins; if still tied, whoever submitted first wins) ----------
  if (mode === "exam") {
    if (sortMode === "recent") rows.sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    else if (sortMode === "fastest") rows.sort((a, b) => (a.timeTakenSeconds ?? Infinity) - (b.timeTakenSeconds ?? Infinity) || b.score - a.score);
    else rows.sort((a, b) => b.score - a.score || (a.timeTakenSeconds ?? Infinity) - (b.timeTakenSeconds ?? Infinity) || (a.submittedAt?.seconds || 0) - (b.submittedAt?.seconds || 0));
  } else {
    if (sortMode === "recent") rows.sort((a, b) => b.lastSubmittedSec - a.lastSubmittedSec);
    else if (sortMode === "fastest") rows.sort((a, b) => a.totalTime - b.totalTime || b.totalScore - a.totalScore);
    else rows.sort((a, b) => b.totalScore - a.totalScore || a.totalTime - b.totalTime);
  }

  // ---------- Stat summary cards ----------
  if (!rows.length) {
    statGrid.innerHTML = "";
  } else if (mode === "exam") {
    const avgScore = rows.reduce((s, r) => s + r.score, 0) / rows.length;
    const topScore = rows[0]?.score ?? 0;
    const timesKnown = rows.filter((r) => r.timeTakenSeconds != null);
    const avgTime = timesKnown.length ? timesKnown.reduce((s, r) => s + r.timeTakenSeconds, 0) / timesKnown.length : null;
    statGrid.innerHTML = [
      { n: rows.length, l: "Participants" },
      { n: formatScore(topScore), l: "Top Score" },
      { n: formatScore(Math.round(avgScore * 100) / 100), l: "Average Score" },
      { n: avgTime != null ? formatDuration(avgTime) : "—", l: "Average Time" },
    ].map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`).join("");
  } else {
    const avgTotal = rows.reduce((s, r) => s + r.totalScore, 0) / rows.length;
    statGrid.innerHTML = [
      { n: rows.length, l: "Active Users" },
      { n: formatScore(rows[0]?.totalScore ?? 0), l: "Top Total Score" },
      { n: formatScore(Math.round(avgTotal * 100) / 100), l: "Average Total Score" },
    ].map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`).join("");
  }

  // ---------- Compact tap-to-expand rows (thin, so the whole board fits without side-scrolling;
  // tapping a row reveals the full breakdown that used to live in extra table columns) ----------
  const list = document.getElementById("leaderboard-list");
  if (!rows.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-trophy"></i></div><p>${mode === "exam" ? "No one has taken this exam yet" : "No exam results yet"}</p></div>`;
  } else {
    list.innerHTML = rows
      .map((r, i) => {
        const u = usersMap[r.uid];
        const name = u?.displayName || u?.email || "Unknown User";
        const initial = (u?.displayName || u?.email || "?").trim().charAt(0).toUpperCase();
        const avatar = u?.photoURL ? `<img src="${u.photoURL}" alt="">` : `<span>${escapeHtml(initial)}</span>`;
        return `
        <div class="lb-row">
          <button type="button" class="lb-row-main" aria-expanded="false">
            ${lbRankBadge(i + 1)}
            <span class="lb-avatar">${avatar}</span>
            <span class="lb-row-id">
              <span class="lb-row-name">${escapeHtml(name)}</span>
              <span class="lb-row-email">${escapeHtml(u?.email || "")}</span>
            </span>
            ${lbScoreBadge(r, mode)}
            <i class="fa-solid fa-chevron-down lb-row-caret"></i>
          </button>
          <div class="lb-row-detail hidden">${lbDetailHtml(r, mode)}</div>
        </div>`;
      })
      .join("");
  }

  document.getElementById("lb-export-btn").onclick = () => exportLeaderboardCsv(mode, rows, usersMap, examId);
  document.getElementById("lb-export-pdf-btn").onclick = () => exportLeaderboardPdf(mode, rows, usersMap, examId);
}

// Event delegation — the list is fully re-rendered on every filter/sort/search
// change, so a single listener on the container (bound once, below) handles
// taps for whichever rows currently exist rather than rebinding per-row.
function handleLeaderboardListClick(e) {
  const btn = e.target.closest(".lb-row-main");
  if (!btn) return;
  const row = btn.closest(".lb-row");
  const detail = row?.querySelector(".lb-row-detail");
  if (!detail) return;
  const isOpen = !detail.classList.contains("hidden");
  detail.classList.toggle("hidden", isOpen);
  btn.setAttribute("aria-expanded", String(!isOpen));
  row.classList.toggle("open", !isOpen);
}
document.getElementById("leaderboard-list")?.addEventListener("click", handleLeaderboardListClick);

/* ---------- Export the currently-shown leaderboard as a CSV file (client-side, no backend needed) ---------- */
function exportLeaderboardCsv(mode, rows, usersMap, examId) {
  if (!rows.length) { toast("Nothing to export", "error"); return; }
  const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  let header, lines;
  if (mode === "exam") {
    header = ["Rank", "Name", "Email", "Score", "Total", "Percent", "Correct", "Wrong", "Unanswered", "Time Taken (s)", "Attempt", "Submitted"];
    lines = rows.map((r, i) => {
      const u = usersMap[r.uid];
      return [i + 1, u?.displayName || "", u?.email || "", formatScore(r.score), r.total, r.percent, r.correctCount ?? "", r.wrongCount ?? "", r.unansweredCount ?? "", r.timeTakenSeconds ?? "", r.attemptNumber, formatDateTime(r.submittedAt)].map(csvCell).join(",");
    });
  } else {
    header = ["Rank", "Name", "Email", "Total Score", "Total Max", "Exams Taken", "Total Time (s)", "Last Activity"];
    lines = rows.map((r, i) => {
      const u = usersMap[r.uid];
      return [i + 1, u?.displayName || "", u?.email || "", formatScore(r.totalScore), r.totalMax, r.examsTaken, r.totalTime, r.lastSubmittedTs ? formatDateTime(r.lastSubmittedTs) : ""].map(csvCell).join(",");
    });
  }
  const csv = [header.map(csvCell).join(","), ...lines].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const examLabel = examId ? (currentExams.find((e) => e.id === examId)?.title || "exam") : "all-exams";
  a.href = url;
  a.download = `leaderboard-${examLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById("lb-exam-select")?.addEventListener("change", renderLeaderboard);
document.getElementById("lb-sort-select")?.addEventListener("change", renderLeaderboard);
document.getElementById("lb-search-input")?.addEventListener("input", renderLeaderboard);

/* ---------- Export the currently-shown leaderboard as a PDF, with the site
   logo as a faint rotated watermark on every page (uses jsPDF + autoTable,
   loaded via CDN in admin.html). ---------- */
let lbLogoImgCache = null;
export function loadLeaderboardLogo() {
  if (lbLogoImgCache !== null) return Promise.resolve(lbLogoImgCache);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { lbLogoImgCache = img; resolve(img); };
    img.onerror = () => { lbLogoImgCache = false; resolve(false); };
    img.src = "assets/logo.png";
  });
}

async function exportLeaderboardPdf(mode, rows, usersMap, examId) {
  if (!rows.length) { toast("Nothing to export", "error"); return; }
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast("Couldn't load the PDF engine. Check your connection and try again.", "error"); return; }

  const pdfBtn = document.getElementById("lb-export-pdf-btn");
  pdfBtn.disabled = true;
  pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing...';

  try {
    const logoImg = await loadLeaderboardLogo();
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    // Load Noto Sans Bengali so Bengali text renders as real glyphs instead
    // of garbled symbols; bnFont falls back to undefined (jsPDF default)
    // only if the font failed to load.
    const bnLoaded = await useBengaliFont(doc);
    const bnFont = bnLoaded ? "NotoSansBengali" : undefined;
    // jsPDF's embedded-TTF text has no OpenType shaping, so Bengali names/
    // titles still come out broken even with the font above registered —
    // canvasFont lets us rasterize just the Bengali cells/labels below as
    // crisp images (real browser shaping) instead, exactly like the exam
    // result PDF already does. IMPORTANT: this must never fall back to
    // null/falsy — that was the bug behind the broken "Tech Verse Course —
    // Leaderboard" subtitle: a null canvasFont silently skipped
    // rasterization for the exam-title/date line below and let it fall
    // through to native unshaped text instead, which is exactly what looks
    // "broken up". Falling back to the browser's generic "sans-serif" (a
    // real, always-available font name) keeps rasterization on no matter
    // what, matching exam-pdf.js's already-correct behavior.
    const canvasFont = await loadBengaliCanvasFont().catch(() => "sans-serif");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const examLabel = examId ? (currentExams.find((e) => e.id === examId)?.title || "Exam") : "All Exams (Combined)";

    const drawWatermark = () => {
      if (!logoImg) return;
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.07 }));
      const wmSize = 260;
      doc.addImage(logoImg, "PNG", (pageWidth - wmSize) / 2, (pageHeight - wmSize) / 2, wmSize, wmSize, undefined, undefined, 30);
      doc.restoreGraphicsState();
    };

    const drawHeader = () => {
      if (logoImg) doc.addImage(logoImg, "PNG", 30, 20, 30, 30);
      doc.setFontSize(15);
      doc.setFont(bnFont, "bold");
      doc.setTextColor(0, 0, 0);
      doc.text("Tech Verse Course — Leaderboard", logoImg ? 68 : 30, 38);
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 110);
      const metaText = `${examLabel}  •  Generated ${new Date().toLocaleString()}`;
      const metaX = logoImg ? 68 : 30;
      if (canvasFont && hasBengaliText(metaText)) {
        // Exam titles are often typed in Bengali — rasterize this line too,
        // or it would garble exactly like the table cells used to.
        const raster = rasterizeTextLine(metaText, { fontPt: 9, colorRgb: [110, 110, 110], canvasFont });
        doc.addImage(raster.dataUrl, "PNG", metaX, 52 - raster.baselinePt, raster.widthPt, raster.heightPt);
      } else {
        doc.setFont(bnFont, "normal");
        doc.text(metaText, metaX, 52);
      }
      doc.setTextColor(0, 0, 0);
    };

    // Gold / silver / bronze row tints for the top 3 — mirrors the on-screen
    // lb-rank-1/2/3 badge colors so the "who's winning" highlight the admin
    // sees on the page is also visible at a glance in the exported PDF.
    const RANK_HIGHLIGHT = {
      1: { fill: [255, 244, 214], text: [122, 79, 0] },   // gold
      2: { fill: [240, 241, 245], text: [46, 46, 54] },   // silver
      3: { fill: [250, 231, 214], text: [78, 45, 10] },   // bronze
    };

    let head, body;
    if (mode === "exam") {
      head = [["Rank", "Name", "Email", "Score", "Percent", "Correct", "Wrong", "Unanswered", "Time Taken", "Attempt", "Submitted"]];
      body = rows.map((r, i) => {
        const u = usersMap[r.uid];
        return [
          i + 1,
          u?.displayName || "—",
          u?.email || "—",
          `${formatScore(r.score)}/${r.total}`,
          `${Math.max(0, Math.min(100, r.percent))}%`,
          r.correctCount ?? "—",
          r.wrongCount ?? "—",
          r.unansweredCount ?? "—",
          r.timeTakenSeconds != null ? formatDuration(r.timeTakenSeconds) : "—",
          r.attemptNumber,
          formatDateTime(r.submittedAt),
        ];
      });
    } else {
      head = [["Rank", "Name", "Email", "Total Score", "Exams Taken", "Avg Score", "Total Time", "Last Activity"]];
      body = rows.map((r, i) => {
        const u = usersMap[r.uid];
        const avgPct = r.totalMax > 0 ? Math.max(0, Math.min(100, Math.round((r.totalScore / r.totalMax) * 100))) : 0;
        return [
          i + 1,
          u?.displayName || "—",
          u?.email || "—",
          `${formatScore(r.totalScore)}/${r.totalMax}`,
          r.examsTaken,
          `${avgPct}%`,
          formatDuration(r.totalTime),
          r.lastSubmittedTs ? formatDateTime(r.lastSubmittedTs) : "—",
        ];
      });
    }

    doc.autoTable({
      head,
      body,
      startY: 66,
      margin: { left: 30, right: 30 },
      styles: { fontSize: 8.5, cellPadding: 5 },
      headStyles: { fillColor: [124, 92, 252], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 246, 250] },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const rank = data.row.index + 1;
        const highlight = RANK_HIGHLIGHT[rank];
        if (highlight) {
          data.cell.styles.fillColor = highlight.fill;
          data.cell.styles.textColor = highlight.text;
          if (data.column.index === 0 || data.column.index === 1) data.cell.styles.fontStyle = "bold";
        }
        // Bengali text has no shaping in native jsPDF/autoTable glyphs and
        // renders broken — blank the native text here and draw it as a
        // rasterized (properly shaped) image in didDrawCell instead.
        if (canvasFont && typeof data.cell.raw === "string" && hasBengaliText(data.cell.raw)) {
          data.cell.text = [];
        }
      },
      didDrawCell: (data) => {
        if (data.section !== "body") return;
        const raw = data.cell.raw;
        if (!canvasFont || typeof raw !== "string" || !hasBengaliText(raw)) return;
        const rank = data.row.index + 1;
        const highlight = RANK_HIGHLIGHT[rank];
        const bold = !!highlight && (data.column.index === 0 || data.column.index === 1);
        const colorRgb = highlight ? highlight.text : [30, 30, 36];
        const raster = rasterizeTextLine(raw, { fontPt: 8.5, bold, colorRgb, canvasFont });
        const maxWidthPt = data.cell.width - data.cell.padding("left") - data.cell.padding("right");
        let { widthPt, heightPt } = raster;
        if (widthPt > maxWidthPt) {
          const scale = maxWidthPt / widthPt;
          widthPt *= scale;
          heightPt *= scale;
        }
        const x = data.cell.x + data.cell.padding("left");
        const y = data.cell.y + (data.cell.height - heightPt) / 2;
        doc.addImage(raster.dataUrl, "PNG", x, y, widthPt, heightPt);
      },
      didDrawPage: () => {
        drawWatermark();
        drawHeader();
      },
    });

    const safeLabel = examLabel.replace(/[^a-z0-9\u0980-\u09FF]+/gi, "-").toLowerCase().slice(0, 60);
    safeSavePdf(doc, `leaderboard-${safeLabel || "results"}.pdf`);
  } catch (err) {
    console.error("Leaderboard PDF failed:", err);
    toast("Failed to generate the PDF. Please try again.", "error");
  } finally {
    pdfBtn.disabled = false;
    pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
  }
}

