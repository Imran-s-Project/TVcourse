// js/page-credits.js
// Content for the #/credits SPA route (previously credits.html, now removed).
// Rendered by app.js's router directly into index.html — this route no
// longer exists as its own HTML file at all.

export const title = "Credits — Tech Verse Course";

export function render() {
  return `
  <header class="static-hero">
    <div class="container">
      <span class="eyebrow"><i class="fa-solid fa-award"></i> Credits</span>
      <h1>The people behind Tech Verse Course</h1>
      <p>Meet the team that designs, builds, and maintains this platform.</p>
    </div>
  </header>

  <main class="static-content" style="max-width: 980px;">
    <div class="credits-grid">
      <!-- To add a real photo for a team member, replace the <div class="credit-avatar"> icon
           with: <img class="credit-avatar" src="Https://tvcourse.vercel.app/assets/team/founder_imran.webp" alt="NAME"> -->
      <div class="credit-card">
        <div class="credit-avatar"><i class="fa-solid fa-user"></i></div>
        <div class="credit-name">Imran Ahmed</div>
        <div class="credit-role">Founder &amp; Lead Developer</div>
        <div class="credit-edu">Full-stack developer — design, development &amp; administration</div>
        <div class="footer-social">
          <a href="https://www.facebook.com/irnahmed360" target="_blank" rel="noopener" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a>
          <a href="https://www.youtube.com/@imran.ahmedd" target="_blank" rel="noopener" aria-label="YouTube"><i class="fa-brands fa-youtube"></i></a>
        </div>
      </div>
    </div>

    <p class="muted-note">More team members will be added here as the team grows. Want to be featured, or need to update a credit? Reach out via <a href="#/help">Help &amp; Support</a>.</p>
  </main>`;
}
