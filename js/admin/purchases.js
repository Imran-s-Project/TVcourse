// ==========================================================================
// admin/purchases.js — Purchase Requests + payment settings + access code
// email (EmailJS)
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, escapeHtml, formatDateTime, openModal, confirmAction, useBengaliFont } from "../utils.js";
import { loadLeaderboardLogo } from "./leaderboard.js";
import { invalidateAnalyticsCache } from "./analytics.js";

/* ==========================================================================
   Purchase Requests + payment settings + access code email
   ========================================================================== */
let currentPurchases = [];

export async function loadPaymentSettings() {
  const snap = await getDoc(doc(db, "settings", "payment"));
  const s = snap.exists() ? snap.data() : {};
  document.getElementById("ps-bkash").value = s.bkashNumber || "";
  document.getElementById("ps-nagad").value = s.nagadNumber || "";
  document.getElementById("ps-rocket").value = s.rocketNumber || "";
  document.getElementById("ps-type").value = s.paymentType || "Send Money";

  document.getElementById("payment-settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("payment-settings-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await setDoc(doc(db, "settings", "payment"), {
        bkashNumber: document.getElementById("ps-bkash").value.trim(),
        nagadNumber: document.getElementById("ps-nagad").value.trim(),
        rocketNumber: document.getElementById("ps-rocket").value.trim(),
        paymentType: document.getElementById("ps-type").value.trim() || "Send Money",
      }, { merge: true });
      toast("Payment settings saved", "success");
    } catch {
      toast("Could not save", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });
}

export async function loadPurchasesTable() {
  const tbody = document.querySelector("#purchases-table tbody");
  try {
    // Fetched without orderBy() on purpose — see the note in exam.js loadExamList().
    const snap = await getDocs(collection(db, "purchaseRequests"));
    currentPurchases = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  } catch {
    currentPurchases = [];
  }

  const pendingCount = currentPurchases.filter((p) => p.status === "pending").length;
  const badge = document.getElementById("nav-pending-badge");
  if (badge) {
    badge.textContent = pendingCount;
    badge.classList.toggle("hidden", pendingCount === 0);
  }

  if (!currentPurchases.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon"><i class="fa-solid fa-money-bill-wave"></i></div><p>No purchase requests yet</p></div></td></tr>`;
    return;
  }

  const statusBadge = (s) =>
    s === "approved" ? `<span class="badge badge-teal">Approved</span>` :
    s === "rejected" ? `<span class="badge badge-coral">Rejected</span>` :
    `<span class="badge badge-amber">Pending</span>`;

  tbody.innerHTML = currentPurchases
    .map((p) => `
    <tr>
      <td data-label="User"><div class="cell-title"><div><div class="t">${escapeHtml(p.userName || "")}</div><div class="s">${escapeHtml(p.userEmail || "")}${p.phone ? " · " + escapeHtml(p.phone) : ""}</div></div></div></td>
      <td data-label="Course">${escapeHtml(p.courseTitle || "")}</td>
      <td data-label="Payment">${escapeHtml(p.paymentMethod || "")}${p.senderNumber ? `<div class="s" style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(p.senderNumber)}${p.transactionId ? " · TxnID: " + escapeHtml(p.transactionId) : ""}</div>` : ""}</td>
      <td data-label="Amount">৳${p.amount || 0}${p.couponCode ? `<div class="s" style="font-size:0.78rem;color:var(--accent-teal)"><i class="fa-solid fa-tag"></i> ${escapeHtml(p.couponCode)} · -৳${p.discountAmount || 0}</div>` : ""}</td>
      <td data-label="Status">${statusBadge(p.status)}</td>
      <td data-label=""><div class="row-actions">
        ${p.status === "pending" ? `
          <button class="icon-btn" data-approve="${p.id}" title="Approve"><i class="fa-solid fa-check"></i></button>
          <button class="icon-btn danger" data-reject="${p.id}" title="Reject"><i class="fa-solid fa-xmark"></i></button>
        ` : `<button class="icon-btn" data-view="${p.id}" title="Details"><i class="fa-solid fa-eye"></i></button>`}
        <button class="icon-btn" data-pdf="${p.id}" title="Download PDF"><i class="fa-solid fa-file-pdf"></i></button>
      </div></td>
    </tr>`)
    .join("");

  tbody.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => approvePurchase(b.dataset.approve)));
  tbody.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => rejectPurchase(b.dataset.reject)));
  tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewPurchaseDetail(b.dataset.view)));
  tbody.querySelectorAll("[data-pdf]").forEach((b) => b.addEventListener("click", () => downloadPurchasePdf(b.dataset.pdf, b)));
}

function viewPurchaseDetail(id) {
  const p = currentPurchases.find((x) => x.id === id);
  if (!p) return;
  const overlay = openModal(`
    <div class="modal-head"><h3>Purchase Request Details</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <div class="purchase-detail-list">
      <div><b>User:</b> ${escapeHtml(p.userName || "")} (${escapeHtml(p.userEmail || "")})</div>
      <div><b>Phone:</b> ${escapeHtml(p.phone || "")}</div>
      <div><b>Course:</b> ${escapeHtml(p.courseTitle || "")}</div>
      <div><b>Method:</b> ${escapeHtml(p.paymentMethod || "")} — ${escapeHtml(p.senderNumber || "")}</div>
      ${p.couponCode ? `<div><b>Coupon:</b> ${escapeHtml(p.couponCode)} (-৳${p.discountAmount || 0}, original ৳${p.originalAmount || p.amount || 0})</div>` : ""}
      <div><b>Amount:</b> ৳${p.amount || 0}</div>
      ${p.transactionId ? `<div><b>Transaction ID:</b> ${escapeHtml(p.transactionId)}</div>` : ""}
      <div><b>Status:</b> ${escapeHtml(p.status)}</div>
      ${p.accessCode ? `<div><b>Access Code:</b> ${escapeHtml(formatAccessCodeForDisplay(p.accessCode))}</div>` : ""}
    </div>
    <button type="button" class="btn btn-primary btn-block mt-16" id="purchase-detail-pdf-btn"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
  `);
  overlay.querySelector("#purchase-detail-pdf-btn")?.addEventListener("click", (e) => downloadPurchasePdf(p.id, e.currentTarget));
}

/* ---------- Export a single purchase/order as a PDF receipt — one course,
   one user, one order. Card-style box layout with colour-coded status badge. ---------- */
async function downloadPurchasePdf(id, triggerBtn) {
  const p = currentPurchases.find((x) => x.id === id);
  if (!p) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast("Couldn't load the PDF engine. Check your connection and try again.", "error"); return; }

  const originalHtml = triggerBtn?.innerHTML;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  }

  try {
    const logoImg = await loadLeaderboardLogo();

    /* ── Canvas size: compact card, not A4 ── */
    const W = 440, H = 620;
    const doc = new jsPDF({ unit: "pt", format: [W, H], orientation: "portrait" });
    // Load Noto Sans Bengali so Bengali text renders as real glyphs instead
    // of garbled symbols; bnFont falls back to undefined (jsPDF default)
    // only if the font failed to load.
    const bnLoaded = await useBengaliFont(doc);
    const bnFont = bnLoaded ? "NotoSansBengali" : undefined;

    /* ── Helpers ── */
    const hex = (h) => {
      h = h.replace("#", "");
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    };
    const setFill  = (c) => { const [r,g,b]=hex(c); doc.setFillColor(r,g,b); };
    const setDraw  = (c) => { const [r,g,b]=hex(c); doc.setDrawColor(r,g,b); };
    const setTxt   = (c) => { const [r,g,b]=hex(c); doc.setTextColor(r,g,b); };

    /* ── Palette ── */
    const BG       = "#f4f6fb";
    const CARD     = "#ffffff";
    const ACCENT   = "#4f46e5";   // indigo
    const LABEL_C  = "#6b7280";
    const VAL_C    = "#111827";
    const DIV_C    = "#e5e7eb";
    const STATUS_COLORS = {
      approved : { bg: "#d1fae5", text: "#065f46", dot: "#10b981" },
      rejected : { bg: "#fee2e2", text: "#991b1b", dot: "#ef4444" },
      pending  : { bg: "#fef3c7", text: "#92400e", dot: "#f59e0b" },
    };

    /* ── Background ── */
    setFill(BG);
    doc.rect(0, 0, W, H, "F");

    /* ── Main card ── */
    const pad = 24, cardX = pad, cardY = 16, cardW = W - pad*2, cardH = H - 32;
    setFill(CARD);
    setDraw(DIV_C);
    doc.setLineWidth(0.5);
    doc.roundedRect(cardX, cardY, cardW, cardH, 10, 10, "FD");

    /* ── Header band ── */
    setFill(ACCENT);
    doc.roundedRect(cardX, cardY, cardW, 72, 10, 10, "F");
    // cover bottom-rounded corners of header band
    setFill(ACCENT);
    doc.rect(cardX, cardY + 52, cardW, 20, "F");

    /* logo + brand */
    if (logoImg) {
      doc.addImage(logoImg, "PNG", cardX + 16, cardY + 16, 34, 34);
    }
    doc.setFont(bnFont, "bold");
    doc.setFontSize(15);
    setTxt("#ffffff");
    doc.text("Tech Verse Course", cardX + (logoImg ? 58 : 16), cardY + 34);
    doc.setFont(bnFont, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(200, 200, 240);
    doc.text("Course Purchase Receipt", cardX + (logoImg ? 58 : 16), cardY + 48);

    /* ── Status badge (top-right of card) ── */
    const statusKey = (p.status === "approved" || p.status === "rejected") ? p.status : "pending";
    const sc = STATUS_COLORS[statusKey];
    const statusLabel = statusKey.charAt(0).toUpperCase() + statusKey.slice(1);
    const badgeW = 72, badgeH = 20, badgeX = cardX + cardW - badgeW - 14, badgeY = cardY + 26;
    const [bR,bG,bB] = hex(sc.bg);
    doc.setFillColor(bR, bG, bB);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 4, 4, "F");
    const [tR,tG,tB] = hex(sc.text);
    doc.setTextColor(tR, tG, tB);
    const [dR,dG,dB] = hex(sc.dot);
    doc.setFillColor(dR, dG, dB);
    doc.circle(badgeX + 10, badgeY + 10, 3.5, "F");
    doc.setFont(bnFont, "bold");
    doc.setFontSize(8.5);
    doc.text(statusLabel, badgeX + 17, badgeY + 13.5);

    /* ── Course title block ── */
    let y = cardY + 88;
    setTxt(ACCENT);
    doc.setFont(bnFont, "bold");
    doc.setFontSize(13);
    const courseName = p.courseTitle || "Course";
    const courseLines = doc.splitTextToSize(courseName, cardW - 32);
    doc.text(courseLines, cardX + 16, y);
    y += courseLines.length * 17 + 6;

    /* Order ID pill */
    setFill("#eef2ff");
    doc.roundedRect(cardX + 16, y, cardW - 32, 18, 4, 4, "F");
    setTxt("#4338ca");
    doc.setFont(bnFont, "normal");
    doc.setFontSize(7.5);
    doc.text(`ORDER ID: ${p.id}`, cardX + 22, y + 12);
    y += 28;

    /* ── Divider ── */
    setDraw(DIV_C);
    doc.setLineWidth(0.5);
    doc.line(cardX + 16, y, cardX + cardW - 16, y);
    y += 16;

    /* ── Info rows in two columns ── */
    const col1X = cardX + 16;
    const col2X = cardX + cardW / 2 + 4;
    const colW  = cardW / 2 - 24;

    const infoCell = (label, value, x, cy) => {
      doc.setFont(bnFont, "normal");
      doc.setFontSize(7.5);
      setTxt(LABEL_C);
      doc.text(label.toUpperCase(), x, cy);
      cy += 12;
      doc.setFont(bnFont, "bold");
      doc.setFontSize(9.5);
      setTxt(VAL_C);
      const vLines = doc.splitTextToSize(String(value || "—"), colW);
      doc.text(vLines, x, cy);
      return cy + vLines.length * 12 + 10;
    };

    /* Row 1: Name | Email */
    const r1L = infoCell("Student Name", p.userName, col1X, y);
    const r1R = infoCell("Email", p.userEmail, col2X, y);
    y = Math.max(r1L, r1R);

    /* Row 2: Phone | Payment Method */
    const payVal = `${p.paymentMethod || "—"}${p.senderNumber ? ` (${p.senderNumber})` : ""}`;
    const r2L = infoCell("Phone", p.phone, col1X, y);
    const r2R = infoCell("Payment Method", payVal, col2X, y);
    y = Math.max(r2L, r2R);

    /* Row 3: Transaction ID | Amount */
    const amountLabel = p.couponCode ? `Amount Paid (Coupon ${p.couponCode} · -\u09F3${p.discountAmount || 0})` : "Amount Paid";
    if (p.transactionId) {
      const r3L = infoCell("Transaction ID", p.transactionId, col1X, y);
      const r3R = infoCell(amountLabel, `\u09F3${p.amount || 0}`, col2X, y);
      y = Math.max(r3L, r3R);
    } else {
      y = infoCell(amountLabel, `\u09F3${p.amount || 0}`, col1X, y);
    }

    /* Row 4: Requested On | Reviewed On */
    const r4L = infoCell("Requested On", formatDateTime(p.createdAt), col1X, y);
    const r4R = p.reviewedAt ? infoCell("Reviewed On", formatDateTime(p.reviewedAt), col2X, y) : y;
    y = Math.max(r4L, typeof r4R === "number" ? r4R : y);

    /* ── Access Code highlighted box (if approved) ── */
    if (p.status === "approved" && p.accessCode) {
      y += 4;
      setDraw(DIV_C);
      doc.line(cardX + 16, y, cardX + cardW - 16, y);
      y += 14;

      setFill("#f0fdf4");
      const [acR,acG,acB] = hex("#bbf7d0");
      doc.setDrawColor(acR, acG, acB);
      doc.setLineWidth(1);
      doc.roundedRect(cardX + 16, y, cardW - 32, 44, 6, 6, "FD");

      doc.setFont(bnFont, "normal");
      doc.setFontSize(7.5);
      setTxt("#166534");
      doc.text("ACCESS CODE", cardX + 26, y + 14);

      doc.setFont(bnFont, "bold");
      doc.setFontSize(14);
      setTxt("#15803d");
      doc.text(formatAccessCodeForDisplay(p.accessCode), cardX + 26, y + 33);
      y += 56;
    }

    /* ── Footer ── */
    y = cardY + cardH - 30;
    setDraw(DIV_C);
    doc.line(cardX + 16, y, cardX + cardW - 16, y);
    y += 14;
    setTxt(LABEL_C);
    doc.setFont(bnFont, "normal");
    doc.setFontSize(7.5);
    doc.text("Thank you for your purchase · Tech Verse Course", cardX + 16, y);
    doc.setFontSize(7);
    doc.text(`Generated ${new Date().toLocaleDateString("en-GB")}`, cardX + cardW - 16, y, { align: "right" });

    /* ── Watermark ── */
    if (logoImg) {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.04 }));
      const wmS = 220;
      doc.addImage(logoImg, "PNG", (W - wmS)/2, (H - wmS)/2, wmS, wmS, undefined, undefined, 30);
      doc.restoreGraphicsState();
    }

    const safeName   = (p.userName   || "user"  ).replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 40);
    const safeCourse = (p.courseTitle || "course").replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 40);
    doc.save(`${safeName}_${safeCourse}_receipt.pdf`);
  } catch (err) {
    console.error(err);
    toast("Failed to generate the PDF. Please try again.", "error");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = originalHtml;
    }
  }
}

/* Generate a random 25-character access code — retries if the code is already taken */
export async function generateUniqueAccessCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Easy to read — excludes confusing characters (0,O,1,I)
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "";
    for (let i = 0; i < 25; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const snap = await getDoc(doc(db, "accessCodes", code));
    if (!snap.exists()) return code;
  }
  throw new Error("Could not generate code");
}

/* Insert a dash every 5 characters, purely for display/email — e.g. XXXXX-XXXXX-XXXXX-XXXXX-XXXXX */
export function formatAccessCodeForDisplay(code) {
  return code.replace(/(.{5})(?=.)/g, "$1-");
}

async function approvePurchase(id) {
  const p = currentPurchases.find((x) => x.id === id);
  if (!p) return;
  if (!(await confirmAction(`Approve "${p.userName}"'s request to purchase "${p.courseTitle}"? An access code will be sent to their email.`, { danger: false, confirmLabel: "Yes, Approve" }))) return;

  try {
    const code = await generateUniqueAccessCode();
    await setDoc(doc(db, "accessCodes", code), {
      uid: p.uid,
      courseId: p.courseId,
      requestId: p.id,
      used: false,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "purchaseRequests", p.id), {
      status: "approved",
      accessCode: code,
      reviewedAt: serverTimestamp(),
    });

    const emailSent = await sendAccessCodeEmail(p, code);
    toast(emailSent ? "Approved and email sent" : "Approved, but the email could not be sent — please send the code manually", emailSent ? "success" : "error");
    invalidateAnalyticsCache(); // revenue/enrollment numbers just changed — force a fresh read next time Analytics is opened
    loadPurchasesTable();
  } catch (err) {
    toast("Could not approve, please try again", "error");
  }
}

async function rejectPurchase(id) {
  const p = currentPurchases.find((x) => x.id === id);
  if (!p) return;
  if (!(await confirmAction(`Reject "${p.userName}"'s request?`))) return;
  try {
    await updateDoc(doc(db, "purchaseRequests", p.id), { status: "rejected", reviewedAt: serverTimestamp() });
    toast("Request rejected", "success");
    invalidateAnalyticsCache(); // pending-request count just changed — force a fresh read next time Analytics is opened
    loadPurchasesTable();
  } catch {
    toast("Could not reject", "error");
  }
}

/* ---------- Send the access-code email via EmailJS ----------
   Create a Service and Template in the EmailJS dashboard and put the two IDs below.
   Use these variables in your template:
   {{to_name}}, {{to_email}}, {{course_title}}, {{access_code}}, {{site_url}} */
const EMAILJS_SERVICE_ID = "service_z81iazm";
const EMAILJS_TEMPLATE_ID = "template_ubim59m";

export async function sendAccessCodeEmail(purchase, code) {
  if (typeof emailjs === "undefined") return false;
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_name: purchase.userName || "",
      to_email: purchase.userEmail || "",
      course_title: purchase.courseTitle || "",
      access_code: formatAccessCodeForDisplay(code),
      site_url: window.location.origin + "/#/course?id=" + purchase.courseId,
    });
    return true;
  } catch (err) {
    console.error("EmailJS send failed:", err);
    return false;
  }
}

