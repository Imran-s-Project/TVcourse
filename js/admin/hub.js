// ==========================================================================
// hub.js — "Learning Hub" SPA route (#/hub): Achievements (badges),
// Discussion, and Flashcards, all in one place. Mirrors the page-profile.js
// + profile.js split: this file owns markup + tab wiring, and delegates the
// actual per-tab content to badges.js / discussion.js / flashcards.js.
// ==========================================================================
import { requireAuth, getUserProfile, isFeatureSeen, markFeatureSeen, newPillHtml } from "./utils.js";

export const title = "Learning Hub — Tech Verse Course";

const TABS = [
  { key: "badges",     label: "Achievements", icon: "fa-trophy",   featureKey: "hub_tab_badges" },
  { key: "discussion", label: "Discussion",   icon: "fa-comments", featureKey: "hub_tab_discussion" },
  { key: "flashcards", label: "Flashcards",   icon: "fa-clone",    featureKey: "hub_tab_flashcards" },
];

export function render() {
  return `
  <main class="container">
    <div class="hub-header">
      <h1><i class="fa-solid fa-layer-group"></i> Learning Hub</h1>
      <p class="muted">Earn badges, join course discussions, and review flashcards with spaced repetition.</p>
    </div>

    <div class="tab-row" id="hub-tab-row">
      ${TABS.map((t, i) => `
        <button class="tab-btn ${i === 0 ? "active" : ""}" data-hub-tab="${t.key}">
          <i class="fa-solid ${t.icon}"></i> ${t.label} ${newPillHtml(t.featureKey)}
        </button>`).join("")}
    </div>

    ${TABS.map((t, i) => `<div id="hub-tab-${t.key}" class="tab-panel ${i === 0 ? "" : "hidden"}"></div>`).join("")}
  </main>`;
}

let loaded = { badges: false, discussion: false, flashcards: false };

export async function initHubPage() {
  const user = await requireAuth();
  if (!user) return;
  const profile = await getUserProfile(user.uid);

  markFeatureSeen("hub_nav");

  document.querySelectorAll('#hub-tab-row [data-hub-tab]').forEach((btn) => {
    btn.addEventListener("click", () => activateHubTab(btn.dataset.hubTab, user, profile));
  });

  await loadTab("badges", user, profile);
}

async function loadTab(key, user, profile) {
  if (loaded[key]) return;
  loaded[key] = true;
  const container = document.getElementById(`hub-tab-${key}`);
  if (!container) return;
  if (key === "badges") {
    const { renderBadgesTab } = await import("./badges.js");
    await renderBadgesTab(container, user.uid, profile);
  } else if (key === "discussion") {
    const { renderDiscussionTab } = await import("./discussion.js");
    await renderDiscussionTab(container, user, profile);
  } else if (key === "flashcards") {
    const { renderFlashcardsTab } = await import("./flashcards.js");
    await renderFlashcardsTab(container, user, profile);
  }
}

function activateHubTab(key, user, profile) {
  document.querySelectorAll('#hub-tab-row [data-hub-tab]').forEach((b) => b.classList.toggle("active", b.dataset.hubTab === key));
  TABS.forEach((t) => {
    const panel = document.getElementById(`hub-tab-${t.key}`);
    if (panel) panel.classList.toggle("hidden", t.key !== key);
  });
  const tabDef = TABS.find((t) => t.key === key);
  if (tabDef && !isFeatureSeen(tabDef.featureKey)) {
    markFeatureSeen(tabDef.featureKey);
    document.querySelector(`#hub-tab-row [data-hub-tab="${key}"] .new-pill`)?.remove();
  }
  loadTab(key, user, profile);
}
