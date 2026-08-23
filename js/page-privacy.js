// js/page-privacy.js
// Content for the #/privacy SPA route (previously privacy.html, now removed).
// Rendered by app.js's router directly into index.html — this route no
// longer exists as its own HTML file at all.
import { supportMailto, SUPPORT_EMAIL_GMAIL, SUPPORT_EMAIL_YAHOO } from "./utils.js";

export const title = "Privacy Policy — Tech Verse Course";

export function render() {
  return `
  <header class="static-hero">
    <div class="container">
      <span class="eyebrow"><i class="fa-solid fa-shield-halved"></i> Privacy Policy</span>
      <h1>Privacy Policy</h1>
      <p>Last updated: August 2026. This page explains what information Tech Verse Course collects and how it's used.</p>
    </div>
  </header>

  <main class="static-content">
    <h2>Information we collect</h2>
    <p>When you create an account, we collect the information you provide directly — such as your name, email address, and profile picture. When you purchase a course, we collect the payment details you submit for verification purposes only (we do not process payments automatically).</p>

    <h2>How we use your information</h2>
    <ul>
      <li>To create and manage your account</li>
      <li>To give you access to the courses, lessons, and exams you're enrolled in</li>
      <li>To verify manual purchase requests and send access codes</li>
      <li>To track your lesson progress and exam results</li>
      <li>To respond to support requests sent through our contact channels</li>
    </ul>

    <h2>Where your data is stored</h2>
    <p>Account and course data is stored using Firebase (Authentication, Firestore, and Storage), a service operated by Google. Access codes are delivered via EmailJS. We do not sell or share your personal information with third parties for advertising purposes.</p>

    <h2>Cookies &amp; local storage</h2>
    <p>The platform may use local browser storage to keep you signed in and remember basic preferences, such as your light/dark theme choice.</p>

    <h2>Your rights</h2>
    <p>You can review and update your profile information at any time from your Profile page. You may also request permanent deletion of your account and associated data from the same page — note that records of purchases and exam results may be retained by the admin for verification purposes even after deletion.</p>

    <h2>Contact us</h2>
    <p>If you have questions about this Privacy Policy, reach us at <a href="${supportMailto(SUPPORT_EMAIL_GMAIL)}">${SUPPORT_EMAIL_GMAIL}</a> or <a href="${supportMailto(SUPPORT_EMAIL_YAHOO)}">${SUPPORT_EMAIL_YAHOO}</a>, or through the <a href="#/help">Help &amp; Support</a> page.</p>

    <p class="muted-note">This policy may be updated from time to time as the platform evolves. Continued use of Tech Verse Course after changes are posted means you accept the revised policy.</p>
  </main>`;
}
