// js/page-forgot-password.js
// Markup for the #/forgot-password SPA route. Same render()-then-init()
// split as page-login.js/js/auth.js — auth.js's exported
// initForgotPasswordPage() binds the form onto this markup once app.js's
// router mounts it into index.html.

export const title = "Reset Password — Tech Verse Course";

export function render() {
  return `
  <div class="auth-wrap">
    <div class="auth-card card">
      <div class="auth-head">
        <img src="assets/logo.png" alt="TVcourse" style="height:52px;width:auto;">
        <h1>Reset Your Password</h1>
        <p>Enter the email on your account and we'll send you a link to set a new password</p>
      </div>

      <form id="forgot-form" novalidate>
        <div class="field">
          <label for="forgot-email">Email</label>
          <input type="email" id="forgot-email" placeholder="you@example.com" required autocomplete="email">
        </div>
        <div class="form-error" id="forgot-error"></div>
        <div class="form-success hidden" id="forgot-success">
          <i class="fa-solid fa-circle-check"></i>
          <span>If an account exists for that email, a reset link is on its way — check your inbox (and spam folder).</span>
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="forgot-btn">Send Reset Link</button>
      </form>

      <div class="auth-switch"><a href="#/login"><i class="fa-solid fa-arrow-left"></i> Back to Log In</a></div>
    </div>
  </div>`;
}
