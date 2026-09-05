// js/page-about.js
// Content for the #/about SPA route (previously about.html, now removed).
// Rendered by app.js's router directly into index.html — this route no
// longer exists as its own HTML file at all.

export const title = "About Us — Tech Verse Course";

export function render() {
  return `
  <header class="static-hero">
    <div class="container">
      <span class="eyebrow"><i class="fa-solid fa-graduation-cap"></i> About Us</span>
      <h1>A well-organized place to actually finish what you start</h1>
      <p>Tech Verse Course was built with one simple frustration in mind: learning material scattered across a dozen tabs, group links, and downloads. Here, everything lives in one place.</p>
    </div>
  </header>

  <main class="static-content">
    <h2>Who we are</h2>
    <p>Tech Verse Course is an online learning platform where video lessons, slide decks, and exams are bundled together for every course — organized by lesson, trackable by progress, and accessible any time.</p>

    <h2>What we offer</h2>
    <ul>
      <li>Structured video lessons with accompanying slides for every topic</li>
      <li>Exams tied directly to each course so you can test what you've learned</li>
      <li>Progress tracking so you always know where you left off</li>
      <li>Both free and paid courses, with a simple, transparent purchase process</li>
    </ul>

    <h2>Our mission</h2>
    <p>We want learning to feel organized instead of overwhelming. Every course on this platform is structured so you can move from lesson to lesson without losing track of what's next, and every exam exists to help you confirm your own understanding — not just to test you.</p>

    <h2>Built by</h2>
    <p>Tech Verse Course is designed and developed by Imran Ahmed. You can read more about the people behind the platform on the <a href="#/credits">Credits</a> page, or reach out any time via the <a href="#/help">Help &amp; Support</a> page.</p>
  </main>`;
}
