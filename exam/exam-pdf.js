// ==========================================================================
// exam-pdf.js — "Download PDF" on the result screen. Uses jsPDF (loaded via
// CDN in index.html's <head> as window.jspdf, shared by the whole SPA).
//
// Bengali text handling: jsPDF embeds TTF fonts glyph-by-glyph with no
// OpenType shaping, so Bengali questions/options (whatever language the
// admin typed them in) came out visually broken — conjuncts and vowel
// signs (matras) in the wrong place — even with a Bengali font registered.
// Fix: any line containing Bengali characters is rasterized on an offscreen
// canvas (which uses the browser's real text-shaping engine) and embedded
// as a small PNG image instead of native PDF text. Pure-English/number
// lines keep using fast, crisp, selectable native jsPDF text.
// ==========================================================================
import { toast, formatScore, formatDuration, loadBengaliCanvasFont } from "../js/utils.js";
import { state } from "./exam-engine.js";

const BENGALI_RE = /[\u0980-\u09FF]/;
const hasBengali = (text) => BENGALI_RE.test(text || "");

// Rasterize at higher resolution than the final point-size for crisp print output.
const RASTER_SCALE = 3;

function loadLogoImage() {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "assets/logo.png";
  });
}

/* Greedy word-wrap using real canvas text measurement (so wrapping matches
   how the text will actually be shaped/rendered, unlike jsPDF's own
   splitTextToSize which only knows Latin glyph widths). */
function wrapByWidth(ctx, text, maxWidthPx) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidthPx) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function rasterizeLine(text, { fontPt, bold, colorRgb, canvasFont }) {
  const px = fontPt * RASTER_SCALE;
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  mctx.font = `${bold ? "700" : "400"} ${px}px "${canvasFont}", sans-serif`;
  const width = Math.max(4, Math.ceil(mctx.measureText(text).width) + 6);
  const height = Math.ceil(px * 1.5);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.font = `${bold ? "700" : "400"} ${px}px "${canvasFont}", sans-serif`;
  ctx.fillStyle = `rgb(${colorRgb.join(",")})`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, 2, px * 1.02);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthPt: width / RASTER_SCALE,
    heightPt: height / RASTER_SCALE,
  };
}

/* Draws one logical block of text (already prefixed, e.g. "1. Question…"),
   word-wrapped to maxWidthPt, starting at (x, y). Each wrapped line is
   drawn either as native jsPDF text (fast path, pure English/numbers) or
   as a rasterized image (any Bengali present), and handles page breaks as
   it goes. Returns the y position after the block. */
function drawBlock(pdfDoc, ctx, text, opts) {
  const { x, y: startY, fontPt, bold = false, colorRgb = [0, 0, 0], maxWidthPt, canvasFont, pageHeight, marginBottom, onPageBreak } = opts;
  let y = startY;
  ctx.font = `${bold ? "700" : "400"} ${fontPt * RASTER_SCALE}px "${canvasFont}", sans-serif`;
  const lines = wrapByWidth(ctx, text, maxWidthPt * RASTER_SCALE);
  const lineHeight = fontPt * 1.4;

  lines.forEach((lineText) => {
    if (y + lineHeight > pageHeight - marginBottom) {
      y = onPageBreak();
    }
    if (hasBengali(lineText)) {
      const raster = rasterizeLine(lineText, { fontPt, bold, colorRgb, canvasFont });
      pdfDoc.addImage(raster.dataUrl, "PNG", x, y - fontPt * 0.82, raster.widthPt, raster.heightPt);
    } else {
      pdfDoc.setFont("helvetica", bold ? "bold" : "normal");
      pdfDoc.setFontSize(fontPt);
      pdfDoc.setTextColor(...colorRgb);
      pdfDoc.text(lineText, x, y);
    }
    y += lineHeight;
  });

  return y;
}

export async function downloadResultPDF(score, total, percent, examTitle, breakdown = {}) {
  const pdfBtn = document.getElementById("exs-download-pdf");
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    toast("Couldn't load the PDF engine. Check your internet connection and try again.", "error");
    return;
  }
  if (pdfBtn) {
    pdfBtn.disabled = true;
    pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Working</span>';
  }

  try {
    const { correctCount = 0, wrongCount = 0, unansweredCount = 0, negativeMarking = 0, timeTakenSeconds = 0 } = breakdown;
    const logoImg = await loadLogoImage();
    const canvasFont = await loadBengaliCanvasFont().catch(() => "sans-serif");
    const measureCanvas = document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");

    const pdfDoc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdfDoc.internal.pageSize.getWidth();
    const pageHeight = pdfDoc.internal.pageSize.getHeight();
    const marginX = 40;
    const contentWidth = pageWidth - marginX * 2;

    const drawWatermark = () => {
      if (!logoImg) return;
      pdfDoc.saveGraphicsState();
      pdfDoc.setGState(new pdfDoc.GState({ opacity: 0.08 }));
      const wmSize = 300;
      pdfDoc.addImage(logoImg, "PNG", (pageWidth - wmSize) / 2, (pageHeight - wmSize) / 2, wmSize, wmSize, undefined, undefined, 30);
      pdfDoc.restoreGraphicsState();
    };
    const startNewPage = () => {
      pdfDoc.addPage();
      drawWatermark();
      return 50;
    };

    drawWatermark();

    let y = 55;
    if (logoImg) pdfDoc.addImage(logoImg, "PNG", marginX, 30, 36, 36);
    pdfDoc.setFontSize(17);
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.setTextColor(0, 0, 0);
    pdfDoc.text("Tech Verse Course", marginX + 46, 50);
    pdfDoc.setFontSize(10);
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.setTextColor(110, 110, 110);
    pdfDoc.text("Exam Result Report", marginX + 46, 65);
    pdfDoc.setTextColor(0, 0, 0);

    y = 100;
    pdfDoc.setDrawColor(210);
    pdfDoc.line(marginX, y, pageWidth - marginX, y);
    y += 28;

    y = drawBlock(pdfDoc, ctx, examTitle || "Exam", {
      x: marginX, y, fontPt: 14, bold: true, maxWidthPt: contentWidth, canvasFont, pageHeight, marginBottom: 40, onPageBreak: startNewPage,
    });
    y += 8;

    pdfDoc.setFontSize(11);
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.setTextColor(0, 0, 0);
    const studentLine = `Student: ${state.currentUser?.displayName || state.currentUser?.email || "-"}`;
    pdfDoc.text(studentLine, marginX, y); y += 16;
    pdfDoc.text(`Date: ${new Date().toLocaleString()}`, marginX, y); y += 16;
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.text(`Score: ${formatScore(score)} / ${total}  (${percent}%)`, marginX, y); y += 16;
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.text(`Correct: ${correctCount}   Wrong: ${wrongCount}   Unanswered: ${unansweredCount}`, marginX, y); y += 16;
    pdfDoc.text(`Time Taken: ${formatDuration(timeTakenSeconds)}`, marginX, y); y += 16;
    if (negativeMarking > 0) {
      pdfDoc.text(`Negative Marking: ${formatScore(negativeMarking)} per wrong answer`, marginX, y); y += 16;
    }
    y += 14;

    pdfDoc.setFontSize(13);
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.text("Answer Review", marginX, y);
    y += 20;

    state.questions.forEach((q, i) => {
      if (y + 40 > pageHeight - 40) y = startNewPage();

      const userAns = state.answers[q.id];
      const correct = userAns === q.correctIndex;
      const hasExplanation = !!(q.explanation && q.explanation.trim());

      y = drawBlock(pdfDoc, ctx, `${i + 1}. ${q.text}`, {
        x: marginX, y, fontPt: 10, bold: true, colorRgb: [0, 0, 0],
        maxWidthPt: contentWidth, canvasFont, pageHeight, marginBottom: 40, onPageBreak: startNewPage,
      });

      const yourAnsColor = correct ? [20, 130, 70] : [195, 45, 45];
      y = drawBlock(pdfDoc, ctx, `Your answer: ${userAns !== undefined ? q.options[userAns] : "No answer given"}`, {
        x: marginX + 10, y, fontPt: 10, colorRgb: yourAnsColor,
        maxWidthPt: contentWidth - 10, canvasFont, pageHeight, marginBottom: 40, onPageBreak: startNewPage,
      });

      if (!correct) {
        y = drawBlock(pdfDoc, ctx, `Correct answer: ${q.options[q.correctIndex]}`, {
          x: marginX + 10, y, fontPt: 10, colorRgb: [20, 130, 70],
          maxWidthPt: contentWidth - 10, canvasFont, pageHeight, marginBottom: 40, onPageBreak: startNewPage,
        });
      }
      if (hasExplanation) {
        y = drawBlock(pdfDoc, ctx, `Explanation: ${q.explanation}`, {
          x: marginX + 10, y, fontPt: 10, colorRgb: [120, 90, 20],
          maxWidthPt: contentWidth - 10, canvasFont, pageHeight, marginBottom: 40, onPageBreak: startNewPage,
        });
      }
      pdfDoc.setTextColor(0, 0, 0);
      y += 10;
    });

    const safeTitle = (examTitle || "exam").replace(/[^a-z0-9\u0980-\u09FF]+/gi, "_").slice(0, 60);
    pdfDoc.save(`${safeTitle}_result.pdf`);
  } catch (err) {
    console.error("Exam result PDF failed:", err);
    toast("Couldn't generate the PDF. Please try again.", "error");
  } finally {
    if (pdfBtn) {
      pdfBtn.disabled = false;
      pdfBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i><span>PDF</span>';
    }
  }
}
