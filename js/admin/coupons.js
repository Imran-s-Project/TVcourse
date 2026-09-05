// ==========================================================================
// admin/coupons.js — Discount Coupon Code management
// Coupons live in the "coupons" collection, doc ID = the code itself
// (e.g. coupons/EID50). Redemption (usedCount/usedByUsers) is written by
// the buyer's own browser inside a Firestore transaction (see course.js)
// but is locked down by firestore.rules.txt's isValidCouponRedeem() so a
// coupon can never be forged, reused past its limit, reused twice by the
// same account, or applied while inactive/expired — every other field
// here (value, scope, active, maxUses, expiry) can only ever be written
// by an admin.
// ==========================================================================
import { db } from "../firebase-config.js";
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, escapeHtml, openModal, closeModal, confirmAction } from "../utils.js";
import { courses } from "../admin.js";

let couponsCache = [];

export async function loadCouponsTable() {
  const tbody = document.querySelector("#coupons-table tbody");
  if (!tbody) return;
  try {
    const snap = await getDocs(collection(db, "coupons"));
    couponsCache = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  } catch {
    couponsCache = [];
  }

  if (!couponsCache.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon"><i class="fa-solid fa-tags"></i></div><p>No coupons created yet</p></div></td></tr>`;
  } else {
    tbody.innerHTML = couponsCache.map((c) => `
      <tr>
        <td data-label="Code"><code class="coupon-code-pill">${escapeHtml(c.code)}</code></td>
        <td data-label="Discount">${c.type === "fixed" ? `৳${c.value || 0} Off` : `${c.value || 0}% Off`}</td>
        <td data-label="Applies To">${couponScopeLabel(c)}</td>
        <td data-label="Usage">${couponUsageLabel(c)}</td>
        <td data-label="Status">${couponStatusBadge(c)}</td>
        <td data-label=""><div class="row-actions">
          <button class="icon-btn" data-toggle-coupon="${c.id}" title="${c.active ? "Deactivate" : "Activate"}"><i class="fa-solid ${c.active ? "fa-toggle-on" : "fa-toggle-off"}"></i></button>
          <button class="icon-btn" data-edit-coupon="${c.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" data-del-coupon="${c.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`).join("");
  }

  tbody.querySelectorAll("[data-edit-coupon]").forEach((b) => b.addEventListener("click", () => openCouponModal(b.dataset.editCoupon)));
  tbody.querySelectorAll("[data-del-coupon]").forEach((b) => b.addEventListener("click", () => deleteCoupon(b.dataset.delCoupon)));
  tbody.querySelectorAll("[data-toggle-coupon]").forEach((b) => b.addEventListener("click", () => toggleCoupon(b.dataset.toggleCoupon)));
}

document.getElementById("add-coupon-btn-top")?.addEventListener("click", () => openCouponModal(null));

function isExpired(c) {
  return !!(c.expiresAt?.toMillis && Date.now() > c.expiresAt.toMillis());
}
function isMaxedOut(c) {
  return c.maxUses > 0 && (c.usedCount || 0) >= c.maxUses;
}

function couponScopeLabel(c) {
  if (c.scope !== "specific" || !Array.isArray(c.courseIds) || !c.courseIds.length) return "All Courses";
  const titles = c.courseIds.map((id) => courses.find((x) => x.id === id)?.title).filter(Boolean);
  if (!titles.length) return "All Courses";
  return titles.length > 2 ? `${escapeHtml(titles.slice(0, 2).join(", "))} +${titles.length - 2} more` : escapeHtml(titles.join(", "));
}

function couponUsageLabel(c) {
  const used = c.usedCount || 0;
  return c.maxUses > 0 ? `${used} / ${c.maxUses}` : `${used} / ∞`;
}

function couponStatusBadge(c) {
  if (isExpired(c)) return `<span class="badge badge-coral">Expired</span>`;
  if (isMaxedOut(c)) return `<span class="badge badge-coral">Limit Reached</span>`;
  return c.active
    ? `<span class="badge badge-teal">Active</span>`
    : `<span class="badge badge-amber">Inactive</span>`;
}

function generateCouponCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function openCouponModal(couponId) {
  const c = couponId ? couponsCache.find((x) => x.id === couponId) : null;
  const scope = c?.scope === "specific" ? "specific" : "all";
  const expiryValue = c?.expiresAt?.toDate ? c.expiresAt.toDate().toISOString().slice(0, 10) : "";

  const overlay = openModal(`
    <div class="modal-head"><h3>${c ? "Edit Coupon" : "New Discount Coupon"}</h3><button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button></div>
    <form id="coupon-modal-form">

      <div class="modal-section">
        <div class="modal-section-head"><i class="fa-solid fa-tag"></i> কুপন কোড</div>
        <div class="field">
          <label>Code</label>
          <div class="coupon-row">
            <input type="text" id="cm-code" required maxlength="20" placeholder="e.g. EID50" style="text-transform:uppercase;letter-spacing:1px;" value="${c ? escapeHtml(c.code) : ""}" ${c ? "readonly" : ""}>
            ${c ? "" : `<button type="button" class="btn btn-outline btn-sm" id="cm-generate-btn">Generate</button>`}
          </div>
          ${c ? `<span class="field-lock-note"><i class="fa-solid fa-lock"></i> The code itself can't be changed after creation — delete and create a new one instead</span>` : ""}
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-head"><i class="fa-solid fa-percent"></i> ছাড়ের পরিমাণ</div>
        <div class="admin-grid">
          <div class="field">
            <label>Discount Type</label>
            <select id="cm-type">
              <option value="percent" ${!c || c.type === "percent" ? "selected" : ""}>Percentage (%)</option>
              <option value="fixed" ${c?.type === "fixed" ? "selected" : ""}>Fixed Amount (৳)</option>
            </select>
          </div>
          <div class="field"><label>Value</label><input type="number" id="cm-value" min="1" required placeholder="e.g. 20" value="${c ? c.value || "" : ""}"></div>
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-head"><i class="fa-solid fa-book"></i> কোন কোর্সে প্রযোজ্য</div>
        <div class="field">
          <select id="cm-scope">
            <option value="all" ${scope === "all" ? "selected" : ""}>All Courses</option>
            <option value="specific" ${scope === "specific" ? "selected" : ""}>Specific Courses Only</option>
          </select>
        </div>
        <div class="field" id="cm-courses-field" ${scope === "all" ? "hidden" : ""}>
          <div class="lesson-picker" id="cm-course-picker">
            ${courses.map((co) => `
              <label class="lesson-picker-item">
                <input type="checkbox" value="${co.id}" ${c?.courseIds?.includes(co.id) ? "checked" : ""}>
                <span>${escapeHtml(co.title)}</span>
              </label>`).join("")}
          </div>
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-head"><i class="fa-solid fa-shield-halved"></i> ব্যবহারের সীমা</div>
        <p class="form-hint" style="margin-bottom:10px;">Every coupon can only be used once per student account automatically — this is enforced by the security rules, not just the interface.</p>
        <div class="admin-grid">
          <div class="field"><label>Max Total Uses (0 = unlimited)</label><input type="number" id="cm-max-uses" min="0" value="${c ? c.maxUses ?? 0 : 0}"></div>
          <div class="field"><label>Expiry Date (optional)</label><input type="date" id="cm-expiry" value="${expiryValue}"></div>
        </div>
        <label class="lesson-picker-item" style="padding:10px 12px;">
          <input type="checkbox" id="cm-active" ${!c || c.active ? "checked" : ""}>
          <span><i class="fa-solid fa-circle-check"></i> Active (students can use this coupon right now)</span>
        </label>
      </div>

      <div class="form-error" id="cm-error"></div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary" style="flex:1" id="coupon-modal-save-btn">${c ? "Save Changes" : "Create Coupon"}</button>
        ${c ? `<button type="button" class="btn btn-danger" id="cm-delete-btn"><i class="fa-solid fa-trash"></i></button>` : ""}
      </div>
    </form>
  `);

  overlay.querySelector("#cm-generate-btn")?.addEventListener("click", () => {
    overlay.querySelector("#cm-code").value = generateCouponCode();
  });

  overlay.querySelector("#cm-scope").addEventListener("change", (e) => {
    overlay.querySelector("#cm-courses-field").hidden = e.target.value !== "specific";
  });

  overlay.querySelector("#coupon-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector("#coupon-modal-save-btn");
    const errBox = overlay.querySelector("#cm-error");
    errBox.textContent = "";

    const code = overlay.querySelector("#cm-code").value.trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
      errBox.textContent = "Code must be 3-20 characters — letters, numbers, - or _ only.";
      return;
    }
    const scopeVal = overlay.querySelector("#cm-scope").value;
    const courseIds = scopeVal === "specific"
      ? Array.from(overlay.querySelectorAll("#cm-course-picker input:checked")).map((i) => i.value)
      : [];
    if (scopeVal === "specific" && !courseIds.length) {
      errBox.textContent = "Pick at least one course, or switch back to All Courses.";
      return;
    }
    const type = overlay.querySelector("#cm-type").value;
    const value = Number(overlay.querySelector("#cm-value").value) || 0;
    if (value <= 0 || (type === "percent" && value > 100)) {
      errBox.textContent = type === "percent" ? "Percentage must be between 1 and 100." : "Enter a valid discount amount.";
      return;
    }
    const expiryStr = overlay.querySelector("#cm-expiry").value;
    const expiresAt = expiryStr ? Timestamp.fromDate(new Date(expiryStr + "T23:59:59")) : null;

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      if (c) {
        await updateDoc(doc(db, "coupons", c.id), {
          type, value, scope: scopeVal, courseIds,
          maxUses: Number(overlay.querySelector("#cm-max-uses").value) || 0,
          expiresAt,
          active: overlay.querySelector("#cm-active").checked,
        });
        toast("Coupon updated", "success");
      } else {
        // Doc ID = the code itself (matches how course.js looks coupons up
        // by code), so an existing doc means this exact code is taken —
        // check live rather than trusting the local cache.
        const existing = await getDoc(doc(db, "coupons", code));
        if (existing.exists()) {
          errBox.textContent = "A coupon with this code already exists.";
          btn.disabled = false;
          btn.textContent = "Create Coupon";
          return;
        }
        await setDoc(doc(db, "coupons", code), {
          code, type, value, scope: scopeVal, courseIds,
          maxUses: Number(overlay.querySelector("#cm-max-uses").value) || 0,
          expiresAt,
          active: overlay.querySelector("#cm-active").checked,
          usedCount: 0,
          usedByUsers: [],
          createdAt: serverTimestamp(),
        });
        toast("Coupon created", "success");
      }
      closeModal();
      loadCouponsTable();
    } catch (err) {
      errBox.textContent = err.message || "Could not save this coupon.";
      btn.disabled = false;
      btn.textContent = c ? "Save Changes" : "Create Coupon";
    }
  });

  overlay.querySelector("#cm-delete-btn")?.addEventListener("click", () => deleteCoupon(c.id, true));
}

async function toggleCoupon(id) {
  const c = couponsCache.find((x) => x.id === id);
  if (!c) return;
  try {
    await updateDoc(doc(db, "coupons", id), { active: !c.active });
    toast(c.active ? "Coupon deactivated" : "Coupon activated", "success");
    loadCouponsTable();
  } catch {
    toast("Could not update the coupon", "error");
  }
}

async function deleteCoupon(id, fromModal = false) {
  const c = couponsCache.find((x) => x.id === id);
  if (!(await confirmAction(`Delete coupon "${c?.code || ""}"? This can't be undone.`, { title: "Delete Coupon" }))) return;
  try {
    await deleteDoc(doc(db, "coupons", id));
    if (fromModal) closeModal();
    toast("Coupon deleted", "success");
    loadCouponsTable();
  } catch {
    toast("Could not delete", "error");
  }
}
