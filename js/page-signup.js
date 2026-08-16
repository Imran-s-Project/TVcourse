// js/page-signup.js
// Markup for the #/signup SPA route (previously signup.html, now removed —
// there is no signup page as an HTML file anywhere in this project anymore).
// Rendered by app.js's router directly into index.html; js/auth.js's
// exported initSignupPage() binds the form + Google button behavior onto
// this markup, the same split page-profile.js/profile.js already use.

export const title = "Sign Up — Tech Verse Course";

export function render() {
  return `
  <div class="auth-wrap">
    <div class="auth-card card">
      <div class="auth-head">
        <img src="assets/logo.png" alt="TVcourse" style="height:52px;width:auto;">
        <h1>Start Your Journey</h1>
        <p>Create an account to access all courses</p>
      </div>

      <form id="signup-form" novalidate>
        <div class="field">
          <label for="signup-name">Full Name</label>
          <input type="text" id="signup-name" placeholder="Your name" required autocomplete="name">
        </div>
        <div class="field">
          <label for="signup-email">Email</label>
          <input type="email" id="signup-email" placeholder="you@example.com" required autocomplete="email">
        </div>
        <div class="field">
          <label for="signup-password">Password</label>
          <input type="password" id="signup-password" placeholder="At least 6 characters" required autocomplete="new-password">
        </div>
        <div class="form-error" id="signup-error"></div>
        <button type="submit" class="btn btn-primary btn-block" id="signup-btn">Create Account</button>
      </form>

      <div class="auth-divider">or</div>
      <button type="button" class="btn-google" id="google-btn">
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.94v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.71A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.71V4.96H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.04l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.96l3.01 2.33C4.66 5.16 6.65 3.58 9 3.58z"/></svg>
        Sign up with Google
      </button>

      <div class="auth-switch">Already have an account? <a href="#/login">Log in</a></div>
    </div>
  </div>`;
}
