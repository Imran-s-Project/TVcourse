// ==========================================================================
// auth.js — Sign up / login logic for the #/login and #/signup SPA routes
// Markup comes from js/page-login.js and js/page-signup.js; app.js's router
// mounts that markup into index.html and then calls the exported
// initLoginPage() / initSignupPage() below to wire up the form + Google
// button — the same render()-then-init() split js/page-profile.js and
// js/profile.js already use for #/profile. login.html and signup.html no
// longer exist; there is nothing left to reach with a page reload here —
// every redirect below is a hash change within the same SPA.
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  GoogleAuthProvider,
  FacebookAuthProvider,
  GithubAuthProvider,
  OAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  increment,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, waitForAuth, consumePostLoginRedirect, getUserProfile } from "./utils.js";
import { navigate } from "./router.js";
import { linkChildByCode } from "./parent-data.js";

/* ==========================================================================
   Device detection — records which phones/browsers were used to log in/sign up
   ========================================================================== */

/* A persistent ID for this browser/device — once created it stays in localStorage,
   so logging in repeatedly on the same phone doesn't count as a new device. A
   different phone/browser has its own localStorage, so it's picked up as new. */
function getDeviceId() {
  try {
    let id = localStorage.getItem("tv_device_id");
    if (!id) {
      id = "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("tv_device_id", id);
    }
    return id;
  } catch {
    return "dev_unknown";
  }
}

/* ==========================================================================
   Remembered account type — powers the "auto-recommend" Student/Guardian
   tab on #/login. Every time a login *succeeds* (password or OAuth, and
   only after the strict role check below has passed) we stamp which type
   of account it actually was onto localStorage. The next time this same
   browser opens #/login, bindLoginRoleToggle() reads it back and
   pre-selects that tab instead of always defaulting to "Student" — a
   Guardian who only ever uses the Guardian tab never has to click it again.
   Purely a convenience default; it never bypasses the real check below,
   it only decides which tab is highlighted before the person even types.
   ========================================================================== */
const LAST_ROLE_KEY = "tv_last_role";

function getLastRole() {
  try {
    const v = localStorage.getItem(LAST_ROLE_KEY);
    return v === "parent" ? "parent" : v === "student" ? "student" : null;
  } catch {
    return null;
  }
}

function setLastRole(role) {
  try {
    localStorage.setItem(LAST_ROLE_KEY, role === "parent" ? "parent" : "student");
  } catch {
    // Storage unavailable (private browsing, etc.) — the toggle just falls
    // back to its default "Student" state next time, nothing else breaks.
  }
}

/* Extract readable device info from the user-agent (simple pattern matching, no external library) */
function parseDeviceInfo() {
  const ua = navigator.userAgent || "";

  let os = "Unknown OS";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "Unknown Browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = "Opera";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";

  const deviceType = /mobile/i.test(ua) ? "Mobile" : /tablet|ipad/i.test(ua) ? "Tablet" : "Desktop";

  return { os, browser, deviceType, userAgent: ua };
}

/* On login/signup, save this device's info to users/{uid}/devices/{deviceId}.
   If it's a new device, increment deviceCount on the user document, used to
   show alerts in the admin panel. */
async function recordDeviceLogin(user) {
  try {
    const deviceId = getDeviceId();
    const info = parseDeviceInfo();
    const devRef = doc(db, "users", user.uid, "devices", deviceId);
    const devSnap = await getDoc(devRef);
    if (!devSnap.exists()) {
      await setDoc(devRef, {
        ...info,
        firstSeen: serverTimestamp(),
        lastSeen: serverTimestamp(),
        loginCount: 1,
      });
      await updateDoc(doc(db, "users", user.uid), { deviceCount: increment(1) }).catch(() => {});
    } else {
      await setDoc(
        devRef,
        { ...info, lastSeen: serverTimestamp(), loginCount: increment(1) },
        { merge: true }
      );
    }
  } catch (err) {
    console.error("Could not record device info:", err);
  }
}

async function ensureUserDoc(user, extra = {}) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName || extra.displayName || user.email.split("@")[0],
      email: user.email,
      photoURL: user.photoURL || "",
      isAdmin: false,
      // Left empty here on purpose — utils.js's phone gate forces every
      // non-admin account to fill this in right after first login, and
      // once set it's locked (see course.js's buy modal).
      phone: "",
      enrolledCourses: [],
      createdAt: serverTimestamp(),
      ...extra,
    });
  }
}

/* A parent account has no use for the course-browsing home page — it always
   lands on its own dashboard instead. Every "where do we send them after
   auth succeeds" spot below goes through this one helper. */
function defaultLandingHref(profile) {
  return profile?.role === "parent" ? "#/parent" : "#/home";
}

/* If someone is already logged in and lands on #/login or #/signup (typed the
   hash directly, used the browser back button, etc.), bounce them home
   instead of showing the form again. Returns true if it redirected. */
async function redirectIfAlreadyAuthed() {
  const user = await waitForAuth();
  if (user) {
    const profile = await getUserProfile(user.uid).catch(() => null);
    navigate(consumePostLoginRedirect() || defaultLandingHref(profile));
    return true;
  }
  return false;
}

/* ==========================================================================
   Strict Student/Guardian separation — the tab picked on #/login is no
   longer just a friendly label. If the account's real, permanent role
   (set once at signup and never changed by this toggle) doesn't match the
   tab someone tried to log in through, the sign-in is REJECTED outright:
   we immediately sign the freshly-authenticated Firebase user back out
   (both the password flow and every OAuth popup already fully authenticate
   before this check runs, so undoing it is mandatory — otherwise a
   mismatched session would sit there even though the UI shows an error)
   and surface a clear, specific message telling them which tab to use.
   Returns true if the login should proceed, false if it was blocked
   (and already signed out + the error message already shown). ---------- */
async function enforceStrictRoleOrReject(profile, selectedRole, errorEl) {
  const actualRole = profile?.role === "parent" ? "parent" : "student";
  if (actualRole === selectedRole) return true;

  await signOut(auth).catch(() => {});
  const message =
    actualRole === "parent"
      ? "This is a Guardian account. It can't log in from the Student tab — switch to \"Guardian\" above and try again."
      : "This is a Student account. It can't log in from the Guardian tab — switch to \"Student\" above and try again.";
  if (errorEl) {
    errorEl.textContent = message;
  } else {
    toast(message, "error");
  }
  return false;
}

function mapAuthError(code) {
  const map = {
    "auth/email-already-in-use": "An account already exists with this email",
    "auth/invalid-email": "Please enter a valid email",
    "auth/weak-password": "Password is too weak",
    "auth/user-not-found": "No account found with this email",
    "auth/wrong-password": "Incorrect password",
    "auth/invalid-credential": "Incorrect email or password",
    "auth/too-many-requests": "Too many attempts, please try again later",
  };
  return map[code] || "Something went wrong, please try again";
}

/* ==========================================================================
   Forgot password — #/forgot-password
   No CAPTCHA here on purpose (kept deliberately simple/frictionless per
   product decision), but it's not wide open either:
     - the email is format-checked before Firebase is ever called
     - the button goes into a 30s cooldown after every send, so the same
       browser can't fire off requests back-to-back
     - whether or not the email actually has an account, the UI always
       shows the exact same "check your inbox" success state — an
       auth/user-not-found error is swallowed rather than shown, so this
       form can never be used to probe which emails are registered
   ========================================================================== */
function startResendCooldown(btn, seconds, idleLabel) {
  let remaining = seconds;
  btn.disabled = true;
  btn.textContent = `Resend in ${remaining}s`;
  const tick = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(tick);
      btn.disabled = false;
      btn.textContent = idleLabel;
    } else {
      btn.textContent = `Resend in ${remaining}s`;
    }
  }, 1000);
}

export async function initForgotPasswordPage() {
  if (await redirectIfAlreadyAuthed()) return;

  const form = document.getElementById("forgot-form");
  const errorEl = document.getElementById("forgot-error");
  const successEl = document.getElementById("forgot-success");
  const btn = document.getElementById("forgot-btn");
  const idleLabel = "Send Reset Link";

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    successEl.classList.add("hidden");

    const email = document.getElementById("forgot-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = "Please enter a valid email address";
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      if (err.code !== "auth/user-not-found") {
        errorEl.textContent = mapAuthError(err.code);
        btn.disabled = false;
        btn.textContent = idleLabel;
        return;
      }
      // auth/user-not-found falls through deliberately — see comment above.
    }
    form.reset();
    successEl.classList.remove("hidden");
    startResendCooldown(btn, 30, idleLabel);
  });
}

/* All OAuth providers that appear on the login/signup cards.
   Each entry maps a button id → a Firebase provider factory.
   Adding a new provider only requires one new entry here. */
const OAUTH_PROVIDERS = [
  {
    btnId: "google-btn",
    label: "Google",
    make: () => new GoogleAuthProvider(),
  },
  {
    btnId: "github-btn",
    label: "GitHub",
    make: () => new GithubAuthProvider(),
  },
  {
    btnId: "facebook-btn",
    label: "Facebook",
    make: () => new FacebookAuthProvider(),
  },
  {
    btnId: "yahoo-btn",
    label: "Yahoo",
    make: () => new OAuthProvider("yahoo.com"),
  },
  {
    btnId: "apple-btn",
    label: "Apple",
    make: () => new OAuthProvider("apple.com"),
  },
];

/* Shared by both the login and signup card — wires every social/OAuth button
   that sits under the divider on each form. One click handler per button,
   no duplication. */
function bindOAuthButtons() {
  OAUTH_PROVIDERS.forEach(({ btnId, label, make }) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      // Whichever tab is on-screen right now — #/login's or #/signup's —
      // whichever exists is the one that applies; the other is always null.
      const roleToggleInput = document.getElementById("login-role") || document.getElementById("signup-role");
      const errorEl = document.getElementById("login-error") || document.getElementById("signup-error");
      const selectedRole = roleToggleInput?.value === "parent" ? "parent" : "student";
      try {
        const cred = await signInWithPopup(auth, make());
        const isNewAccount = !!getAdditionalUserInfo(cred)?.isNewUser;
        // Brand-new account via OAuth: there's nothing to mismatch yet, so
        // it's created AS the tab that was selected (exactly like a normal
        // signup would) instead of silently defaulting to Student.
        await ensureUserDoc(cred.user, isNewAccount ? { role: selectedRole } : {});
        await recordDeviceLogin(cred.user);
        const profile = await getUserProfile(cred.user.uid).catch(() => null);

        // Existing account logging back in through the wrong tab — reject
        // it outright and sign back out, same as the password form below.
        if (roleToggleInput && !isNewAccount) {
          const ok = await enforceStrictRoleOrReject(profile, selectedRole, errorEl);
          if (!ok) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            return;
          }
        }

        const actualRole = profile?.role === "parent" ? "parent" : "student";
        if (roleToggleInput) setLastRole(actualRole);
        toast(isNewAccount ? 'Account created! Welcome <i class="fa-solid fa-champagne-glasses"></i>' : "Logged in successfully", "success");
        const redirectTo = consumePostLoginRedirect();
        setTimeout(() => navigate(redirectTo || defaultLandingHref(profile)), 500);
      } catch (err) {
        // auth/popup-closed-by-user / auth/cancelled-popup-request are silent —
        // the user just closed the popup, no need for an error toast.
        if (
          err.code !== "auth/popup-closed-by-user" &&
          err.code !== "auth/cancelled-popup-request"
        ) {
          toast(`${label} login failed`, "error");
        }
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    });
  });
}

/* ── Public entry point — called by app.js's router every time #/login
   is visited (the mount point's innerHTML is fully replaced on each visit,
   so there's no risk of double-binding listeners onto stale elements). ── */
export async function initLoginPage() {
  if (await redirectIfAlreadyAuthed()) return;

  bindLoginRoleToggle();

  const loginForm = document.getElementById("login-form");
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("login-error");
    const btn = document.getElementById("login-btn");
    errorEl.textContent = "";
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const selectedRole = document.getElementById("login-role")?.value === "parent" ? "parent" : "student";
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await ensureUserDoc(cred.user);
      await recordDeviceLogin(cred.user);
      const profile = await getUserProfile(cred.user.uid).catch(() => null);
      // Strict separation: the tab picked here MUST match the account's
      // real, permanent role (set once at signup — this toggle never
      // changes it). A mismatch is rejected outright and the freshly
      // authenticated session is signed straight back out — a Guardian
      // account can never end up inside the Student experience, and a
      // Student account can never end up inside the Guardian Dashboard.
      const ok = await enforceStrictRoleOrReject(profile, selectedRole, errorEl);
      if (!ok) {
        btn.disabled = false;
        btn.textContent = "Log In";
        return;
      }
      setLastRole(selectedRole);
      toast("Logged in successfully", "success");
      const redirectTo = consumePostLoginRedirect();
      setTimeout(() => navigate(redirectTo || defaultLandingHref(profile)), 500);
    } catch (err) {
      errorEl.textContent = mapAuthError(err.code);
      btn.disabled = false;
      btn.textContent = "Log In";
    }
  });

  bindOAuthButtons();
}

/* Student/Guardian toggle on the login form — which heading/subtext shows,
   what gets written to login-role, AND (unlike the plain cosmetic toggle
   on signup) which tab is pre-selected when the page first loads. The
   actual login still runs through one email+password form; the account's
   real role (strictly enforced after auth succeeds, above) is what decides
   whether it's allowed through — this toggle only decides which tab is
   highlighted by default and which experience the copy above the form
   describes. */
function bindLoginRoleToggle() {
  const toggle = document.getElementById("login-role-toggle");
  const heading = document.getElementById("login-heading");
  const subheading = document.getElementById("login-subheading");
  const hint = document.getElementById("login-role-hint");
  // No hidden input exists yet the first time this runs — create one so
  // the submit handler above has somewhere to read the selection from.
  let roleInput = document.getElementById("login-role");
  if (!roleInput) {
    roleInput = document.createElement("input");
    roleInput.type = "hidden";
    roleInput.id = "login-role";
    roleInput.value = "student";
    toggle?.appendChild(roleInput);
  }
  const copy = {
    student: { heading: "Welcome Back", sub: "Pick up right where you left off" },
    parent: { heading: "Guardian Login", sub: "Log in to view your child's progress" },
  };

  function selectRole(role, { recommended = false } = {}) {
    toggle?.querySelectorAll(".account-type-btn").forEach((b) => b.classList.toggle("active", b.dataset.role === role));
    roleInput.value = role;
    if (heading) heading.textContent = copy[role].heading;
    if (subheading) subheading.textContent = copy[role].sub;
    if (hint) {
      hint.textContent = recommended
        ? `Recommended — you last logged in as ${role === "parent" ? "Guardian" : "Student"} on this device`
        : "";
      hint.classList.toggle("hidden", !recommended);
    }
  }

  // Auto-recommend: pre-select whichever tab this browser last logged in
  // as successfully, instead of always defaulting to Student. First-ever
  // visit (nothing remembered yet) keeps the plain "Student" default.
  const lastRole = getLastRole();
  selectRole(lastRole || "student", { recommended: !!lastRole });

  toggle?.querySelectorAll(".account-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectRole(btn.dataset.role === "parent" ? "parent" : "student"));
  });
}

/* ── Public entry point — called by app.js's router every time #/signup
   is visited. Same re-render-then-bind pattern as initLoginPage above. ── */
export async function initSignupPage() {
  if (await redirectIfAlreadyAuthed()) return;

  bindSignupRoleToggle();

  const signupForm = document.getElementById("signup-form");
  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("signup-error");
    const btn = document.getElementById("signup-btn");
    errorEl.textContent = "";
    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    const role = document.getElementById("signup-role")?.value === "parent" ? "parent" : "student";
    const parentCode = document.getElementById("signup-parent-code")?.value.trim();

    if (password.length < 6) {
      errorEl.textContent = "Password must be at least 6 characters";
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await ensureUserDoc(cred.user, { displayName: name, role });
      await recordDeviceLogin(cred.user);

      // A parent who already has their child's code can link right away —
      // if the code turns out to be wrong, the account still gets created;
      // they can just try again from the Parent Dashboard's "Add Child".
      if (role === "parent" && parentCode) {
        await linkChildByCode(cred.user.uid, parentCode).catch((err) => {
          toast(err.message || "Account created, but that link code didn't work — you can try again from your dashboard.", "error");
        });
      }

      setLastRole(role);
      toast('Account created! Welcome <i class="fa-solid fa-champagne-glasses"></i>', "success");
      const redirectTo = consumePostLoginRedirect();
      setTimeout(() => navigate(redirectTo || defaultLandingHref({ role })), 600);
    } catch (err) {
      errorEl.textContent = mapAuthError(err.code);
      btn.disabled = false;
      btn.textContent = "Create Account";
    }
  });

  bindOAuthButtons();
}

/* Student/Parent account-type toggle on the signup form — purely a UI
   concern (which fields show, what gets written to signup-role), no
   Firestore involved here. */
function bindSignupRoleToggle() {
  const toggle = document.getElementById("signup-role-toggle");
  const roleInput = document.getElementById("signup-role");
  const codeWrap = document.getElementById("signup-parent-code-wrap");
  toggle?.querySelectorAll(".account-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggle.querySelectorAll(".account-type-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const role = btn.dataset.role;
      roleInput.value = role;
      codeWrap?.classList.toggle("hidden", role !== "parent");
    });
  });
}
