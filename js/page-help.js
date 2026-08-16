// js/page-help.js
// Content for the #/help SPA route (previously help.html, now removed).
// Rendered by app.js's router directly into index.html — this route no
// longer exists as its own HTML file at all.

export const title = "Help & Support — Tech Verse Course";

export function render() {
  return `
  <header class="static-hero">
    <div class="container">
      <span class="eyebrow"><i class="fa-solid fa-life-ring"></i> Help &amp; Support</span>
      <h1>We're here to help</h1>
      <p>Common questions are below — or reach us directly through any of the channels on this page.</p>
    </div>
  </header>

  <main class="static-content" style="max-width: 980px;">
    <div class="help-grid">
      <div class="help-card">
        <i class="fa-solid fa-cart-shopping"></i>
        <h3>How do I buy a course?</h3>
        <p>Open a paid course and submit a purchase request with your payment details. Once verified, you'll receive an access code by email.</p>
      </div>
      <div class="help-card">
        <i class="fa-solid fa-key"></i>
        <h3>I didn't get my access code</h3>
        <p>Verification is manual and can take a little time. If it's been a while, contact us directly and we'll check your request.</p>
        <a class="help-link" href="mailto:project.developer.tech@gmail.com">Email support <i class="fa-solid fa-arrow-right"></i></a>
      </div>
      <div class="help-card">
        <i class="fa-solid fa-lock"></i>
        <h3>I forgot my password</h3>
        <p>Use the "Forgot password" option on the Login page to reset it, or sign in with Google if you originally signed up that way.</p>
        <a class="help-link" href="#/login">Go to Login <i class="fa-solid fa-arrow-right"></i></a>
      </div>
      <div class="help-card">
        <i class="fa-solid fa-file-pen"></i>
        <h3>How do exams work?</h3>
        <p>Each course can include an exam tied to its lessons. Once unlocked, you can take it and see your results from your Profile.</p>
      </div>
      <div class="help-card">
        <i class="fa-solid fa-user-gear"></i>
        <h3>How do I update my profile?</h3>
        <p>Go to your Profile page to update your name, profile picture, or password, or to permanently delete your account.</p>
        <a class="help-link" href="#/profile">Go to Profile <i class="fa-solid fa-arrow-right"></i></a>
      </div>
      <div class="help-card">
        <i class="fa-solid fa-comments"></i>
        <h3>Something else?</h3>
        <p>Message us on WhatsApp or Facebook for the fastest response, or send an email and we'll get back to you.</p>
      </div>
    </div>

    <h2>Talk to us directly</h2>
    <ul>
      <li><i class="fa-brands fa-whatsapp"></i> WhatsApp: <a href="https://wa.me/8801957329211" target="_blank" rel="noopener">What's app</a></li>
      <li><i class="fa-solid fa-phone"></i> Phone: <a href="tel:+8801957329211">call</a></li>
      <li><i class="fa-solid fa-envelope"></i> Email: <a href="mailto:project.developer.tech@gmail.com">support web admin</a></li>
      <li><i class="fa-brands fa-facebook-f"></i> Facebook: <a href="https://www.facebook.com/irnahmed360" target="_blank" rel="noopener">Tech Verse</a></li>
      <li><i class="fa-brands fa-youtube"></i> YouTube: <a href="https://www.youtube.com/@imran.ahmedd" target="_blank" rel="noopener">Imran Ahmed</a></li>
    </ul>
  </main>`;
}
