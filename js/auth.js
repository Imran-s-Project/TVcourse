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
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  increment,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, waitForAuth } from "./utils.js";
import { navigate } from "./router.js";

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

/* If someone is already logged in and lands on #/login or #/signup (typed the
   hash directly, used the browser back button, etc.), bounce them home
   instead of showing the form again. Returns true if it redirected. */
async function redirectIfAlreadyAuthed() {
  const user = await waitForAuth();
  if (user) {
    navigate("#/home");
    return true;
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

/* Shared by both the login and signup card — wires the "Log in / Sign up
   with Google" button that sits under the divider on each form. */
function bindGoogleButton() {
  document.getElementById("google-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await ensureUserDoc(cred.user);
      await recordDeviceLogin(cred.user);
      toast("Logged in successfully", "success");
      setTimeout(() => navigate("#/home"), 500);
    } catch (err) {
      toast("Google login failed", "error");
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });
}

/* ── Public entry point — called by app.js's router every time #/login
   is visited (the mount point's innerHTML is fully replaced on each visit,
   so there's no risk of double-binding listeners onto stale elements). ── */
export async function initLoginPage() {
  if (await redirectIfAlreadyAuthed()) return;

  const loginForm = document.getElementById("login-form");
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("login-error");
    const btn = document.getElementById("login-btn");
    errorEl.textContent = "";
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await ensureUserDoc(cred.user);
      await recordDeviceLogin(cred.user);
      toast("Logged in successfully", "success");
      setTimeout(() => navigate("#/home"), 500);
    } catch (err) {
      errorEl.textContent = mapAuthError(err.code);
      btn.disabled = false;
      btn.textContent = "Log In";
    }
  });

  bindGoogleButton();
}

/* ── Public entry point — called by app.js's router every time #/signup
   is visited. Same re-render-then-bind pattern as initLoginPage above. ── */
export async function initSignupPage() {
  if (await redirectIfAlreadyAuthed()) return;

  const signupForm = document.getElementById("signup-form");
  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("signup-error");
    const btn = document.getElementById("signup-btn");
    errorEl.textContent = "";
    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;

    if (password.length < 6) {
      errorEl.textContent = "Password must be at least 6 characters";
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await ensureUserDoc(cred.user, { displayName: name });
      await recordDeviceLogin(cred.user);
      toast('Account created! Welcome <i class="fa-solid fa-champagne-glasses"></i>', "success");
      setTimeout(() => navigate("#/home"), 600);
    } catch (err) {
      errorEl.textContent = mapAuthError(err.code);
      btn.disabled = false;
      btn.textContent = "Create Account";
    }
  });

  bindGoogleButton();
}
