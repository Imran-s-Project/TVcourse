// ==========================================================================
// rich-text.js — হালকা "লেখা বোর্ড" (lite rich-text) সাপোর্ট
// কোর্স ডেসক্রিপশনের মতো লম্বা লেখার জন্য: হেডিং, বোল্ড/ইটালিক, বুলেট/নাম্বার
// লিস্ট, কোট, ডিভাইডার লাইন এবং প্যারাগ্রাফ গ্যাপ — কোনো গ্লো/শ্যাডো ইফেক্ট ছাড়াই।
//
// renderRichText(raw)  → নিরাপদ HTML স্ট্রিং (সবসময় escape করেই বসানো হয়)
// initRichEditor(textarea) → টেক্সটএরিয়ার উপরে টুলবার + Write/Preview ট্যাব বসায়
// ==========================================================================
import { escapeHtml } from "./utils.js";

const EMOJI_SET = ["🚀", "📝", "🎯", "🔥", "✅", "📊", "🏆", "🌟", "🔹", "⭐", "👉", "📌", "🎓", "💡", "📚", "🕒"];

/* ---------- ইনলাইন ফরম্যাটিং: **bold**, *italic* ---------- */
function renderInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_(?!_)([^_]+?)_(?!_)/g, "$1<em>$2</em>");
}

/* ---------- মূল রেন্ডারার: raw টেক্সট → নিরাপদ HTML ---------- */
export function renderRichText(raw) {
  const text = (raw || "").trim();
  if (!text) return "";
  const escaped = escapeHtml(text);
  const lines = escaped.split(/\r\n|\r|\n/);

  let html = "";
  let list = null; // "ul" | "ol" | null
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html += `<p>${paragraph.map(renderInline).join("<br>")}</p>`;
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      html += list === "ul" ? "</ul>" : "</ol>";
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "") {
      flushParagraph();
      closeList();
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushParagraph();
      closeList();
      html += `<hr class="rte-hr">`;
      continue;
    }

    let m;
    if ((m = line.match(/^###\s+(.*)$/))) {
      flushParagraph();
      closeList();
      html += `<h4 class="rte-h4">${renderInline(m[1])}</h4>`;
      continue;
    }
    if ((m = line.match(/^##\s+(.*)$/))) {
      flushParagraph();
      closeList();
      html += `<h3 class="rte-h3">${renderInline(m[1])}</h3>`;
      continue;
    }
    if ((m = line.match(/^#\s+(.*)$/))) {
      flushParagraph();
      closeList();
      html += `<h2 class="rte-h2">${renderInline(m[1])}</h2>`;
      continue;
    }
    if ((m = line.match(/^&gt;\s?(.*)$/))) {
      flushParagraph();
      closeList();
      html += `<blockquote class="rte-quote">${renderInline(m[1])}</blockquote>`;
      continue;
    }
    if ((m = line.match(/^[-•]\s+(.*)$/))) {
      flushParagraph();
      if (list !== "ul") {
        closeList();
        html += `<ul class="rte-ul">`;
        list = "ul";
      }
      html += `<li>${renderInline(m[1])}</li>`;
      continue;
    }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flushParagraph();
      if (list !== "ol") {
        closeList();
        html += `<ol class="rte-ol">`;
        list = "ol";
      }
      html += `<li>${renderInline(m[1])}</li>`;
      continue;
    }

    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return html;
}

/* ==========================================================================
   ছোট এডিটর টুলবার — একটা প্লেইন <textarea>-কে "লেখা বোর্ড"-এ রূপান্তর করে
   ========================================================================== */
function getSel(ta) {
  return { start: ta.selectionStart, end: ta.selectionEnd, value: ta.value };
}
function applyValue(ta, value, selStart, selEnd, onChange) {
  ta.value = value;
  ta.selectionStart = selStart;
  ta.selectionEnd = selEnd;
  ta.focus();
  onChange();
}
function wrapSelection(ta, marker, placeholder, onChange) {
  const { start, end, value } = getSel(ta);
  const selected = value.slice(start, end) || placeholder;
  const before = value.slice(0, start);
  const after = value.slice(end);
  applyValue(ta, before + marker + selected + marker + after, start + marker.length, start + marker.length + selected.length, onChange);
}
function prefixLines(ta, prefixFn, onChange) {
  const { start, end, value } = getSel(ta);
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const newBlock = block.split("\n").map(prefixFn).join("\n");
  applyValue(ta, value.slice(0, lineStart) + newBlock + value.slice(lineEnd), lineStart, lineStart + newBlock.length, onChange);
}
function insertAtCursor(ta, text, onChange) {
  const { start, end, value } = getSel(ta);
  const pos = start + text.length;
  applyValue(ta, value.slice(0, start) + text + value.slice(end), pos, pos, onChange);
}

export function initRichEditor(textarea) {
  if (!textarea || textarea.dataset.rteInit) return;
  textarea.dataset.rteInit = "1";

  const wrap = document.createElement("div");
  wrap.className = "rte-wrap";
  textarea.parentNode.insertBefore(wrap, textarea);

  const toolbar = document.createElement("div");
  toolbar.className = "rte-toolbar";
  toolbar.innerHTML = `
    <button type="button" class="rte-btn" data-rte="bold" title="Bold"><i class="fa-solid fa-bold"></i></button>
    <button type="button" class="rte-btn" data-rte="italic" title="Italic"><i class="fa-solid fa-italic"></i></button>
    <span class="rte-sep"></span>
    <button type="button" class="rte-btn rte-btn-text" data-rte="h2" title="Heading">H2</button>
    <button type="button" class="rte-btn rte-btn-text" data-rte="h3" title="Sub-heading">H3</button>
    <span class="rte-sep"></span>
    <button type="button" class="rte-btn" data-rte="ul" title="Bullet list"><i class="fa-solid fa-list-ul"></i></button>
    <button type="button" class="rte-btn" data-rte="ol" title="Numbered list"><i class="fa-solid fa-list-ol"></i></button>
    <button type="button" class="rte-btn" data-rte="quote" title="Quote"><i class="fa-solid fa-quote-left"></i></button>
    <button type="button" class="rte-btn" data-rte="hr" title="Divider line"><i class="fa-solid fa-minus"></i></button>
    <span class="rte-sep"></span>
    <div class="rte-emoji-wrap">
      <button type="button" class="rte-btn" data-rte="emoji" title="Emoji">🙂</button>
      <div class="rte-emoji-pop" hidden>${EMOJI_SET.map((e) => `<button type="button" class="rte-emoji-item">${e}</button>`).join("")}</div>
    </div>
    <span class="rte-flex-spacer"></span>
    <div class="rte-tabs">
      <button type="button" class="rte-tab active" data-rte-tab="write">Write</button>
      <button type="button" class="rte-tab" data-rte-tab="preview">Preview</button>
    </div>
  `;

  wrap.appendChild(toolbar);
  wrap.appendChild(textarea);
  textarea.classList.add("rte-textarea");

  const preview = document.createElement("div");
  preview.className = "rte-preview rte-content";
  preview.hidden = true;
  wrap.appendChild(preview);

  const hint = document.createElement("div");
  hint.className = "rte-hint";
  hint.textContent = "** bold **  •  # Heading  •  - bullet  •  --- divider line";
  wrap.appendChild(hint);

  const emojiPop = toolbar.querySelector(".rte-emoji-pop");
  const updatePreview = () => {
    preview.innerHTML = renderRichText(textarea.value) || `<p class="rte-empty">Nothing to preview yet</p>`;
  };
  const setTab = (tab) => {
    toolbar.querySelectorAll("[data-rte-tab]").forEach((b) => b.classList.toggle("active", b.dataset.rteTab === tab));
    if (tab === "preview") {
      updatePreview();
      textarea.hidden = true;
      preview.hidden = false;
      hint.hidden = true;
    } else {
      textarea.hidden = false;
      preview.hidden = true;
      hint.hidden = false;
      textarea.focus();
    }
  };

  toolbar.addEventListener("click", (e) => {
    const emojiItem = e.target.closest(".rte-emoji-item");
    if (emojiItem) {
      insertAtCursor(textarea, emojiItem.textContent, updatePreview);
      emojiPop.hidden = true;
      return;
    }
    const tabBtn = e.target.closest("[data-rte-tab]");
    if (tabBtn) {
      setTab(tabBtn.dataset.rteTab);
      return;
    }
    const btn = e.target.closest("[data-rte]");
    if (!btn) return;
    switch (btn.dataset.rte) {
      case "bold":
        wrapSelection(textarea, "**", "bold text", updatePreview);
        break;
      case "italic":
        wrapSelection(textarea, "*", "italic text", updatePreview);
        break;
      case "h2":
        prefixLines(textarea, (l) => `# ${l.replace(/^#+\s*/, "")}`, updatePreview);
        break;
      case "h3":
        prefixLines(textarea, (l) => `## ${l.replace(/^#+\s*/, "")}`, updatePreview);
        break;
      case "ul":
        prefixLines(textarea, (l) => (l.trim() ? `- ${l.replace(/^[-•]\s*/, "")}` : l), updatePreview);
        break;
      case "ol":
        prefixLines(textarea, (l) => (l.trim() ? `1. ${l.replace(/^\d+[.)]\s*/, "")}` : l), updatePreview);
        break;
      case "quote":
        prefixLines(textarea, (l) => `> ${l.replace(/^>\s*/, "")}`, updatePreview);
        break;
      case "hr":
        insertAtCursor(textarea, "\n\n---\n\n", updatePreview);
        break;
      case "emoji":
        emojiPop.hidden = !emojiPop.hidden;
        break;
    }
  });

  document.addEventListener("click", (e) => {
    if (!toolbar.contains(e.target)) emojiPop.hidden = true;
  });
}
