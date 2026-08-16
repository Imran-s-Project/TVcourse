// js/page-terms.js
// Content for the #/terms SPA route (previously terms.html, now removed).
// Rendered by app.js's router directly into index.html — this route no
// longer exists as its own HTML file at all.

export const title = "Terms & Conditions — Tech Verse Course";

export function render() {
  return `
  <header class="static-hero">
    <div class="container">
      <span class="eyebrow"><i class="fa-solid fa-file-contract"></i> Terms &amp; Conditions</span>
      <h1>Terms &amp; Conditions</h1>
      <p>Last updated: August 2026. Please read these terms before using Tech Verse Course.</p>
    </div>
  </header>

  <main class="static-content">
    <h2>1. Accounts</h2>
    <p>You must create an account to access lessons, exams, and your progress. You're responsible for keeping your login details secure and for all activity under your account.</p>

    <h2>2. Course access &amp; purchases</h2>
    <p>Some courses are free; others are paid. For paid courses, you submit a purchase request along with your payment details. Once the admin verifies your payment, an access code is emailed to you to unlock the course and its exam. Access is granted at the admin's discretion after verification.</p>

    <h2>3. Acceptable use</h2>
    <ul>
      <li>Don't share your account, access codes, or paid course content with others</li>
      <li>Don't attempt to copy, redistribute, or resell course videos, slides, or exam material</li>
      <li>Don't attempt to bypass the exam or progress-tracking system</li>
      <li>Don't use the platform for any unlawful purpose</li>
    </ul>

    <h2>4. Exams &amp; results</h2>
    <p>Exams are provided to help you evaluate your own understanding of a course. Results are recorded against your account and may be reviewed by the admin.</p>

    <h2>5. Intellectual property</h2>
    <p>All videos, slides, exam content, branding, and platform design belong to Tech Verse Course and its creator unless otherwise stated. You may not reproduce or distribute this material outside the platform.</p>

    <h2>6. Refunds</h2>
    <p>Because course access is granted manually after payment verification, refund requests are handled on a case-by-case basis — contact us via the <a href="#/help">Help &amp; Support</a> page.</p>

    <h2>7. Account termination</h2>
    <p>You may delete your account at any time from your Profile page. We reserve the right to suspend or terminate accounts that violate these terms.</p>

    <h2>8. Changes to these terms</h2>
    <p>We may update these terms as the platform grows. Continued use of Tech Verse Course after an update means you accept the revised terms.</p>

    <h2>9. Contact</h2>
    <p>Questions about these terms can be sent to <a href="mailto:project.developer.tech@gmail.com">project.developer.tech@gmail.com</a>.</p>
  </main>`;
}
