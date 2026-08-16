// js/footer.js
// Shared site footer, rendered from JS into every <div data-footer></div>
// placeholder found on the page. Edit the markup here once and every page
// (index, course, login, signup, exam, profile, 404) updates automatically —
// no more copy-pasting the footer HTML into each file.
//
// About / Credits / Help / Privacy / Terms no longer exist as their own
// .html files at all — they're SPA routes (#/about, #/credits, #/help,
// #/privacy, #/terms) handled entirely by js/app.js + js/page-*.js inside
// index.html. A bare "#/about" only works while already on index.html
// (that's where the router lives), so from any other page we link to
// "index.html#/about" instead — mirrors the same homeHref logic in
// js/utils.js's initNav().

(function () {
  const onIndexPage = /(^|\/)(index\.html)?$/.test(window.location.pathname);
  function routeHref(route) {
    return onIndexPage ? `#/${route}` : `index.html#/${route}`;
  }

  function footerMarkup() {
    return `
  <footer class="site-footer">
    <div class="container footer-grid">
      <div class="footer-brand">
        <a href="index.html"><img src="assets/logo.png" alt="Tech Verse Course" class="footer-logo"></a>
        <p class="footer-about">Tech Verse Course is an all-in-one learning platform where video lessons, slides, and exams live together — organized, accessible, and built to help you actually finish what you start.</p>
        <div class="footer-social">
          <a href="https://www.facebook.com/irnahmed360" target="_blank" rel="noopener" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a>
          <a href="https://www.youtube.com/@imran.ahmedd" target="_blank" rel="noopener" aria-label="YouTube"><i class="fa-brands fa-youtube"></i></a>
          <a href="https://wa.me/8801957329211" target="_blank" rel="noopener" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>
        </div>
      </div>

      <div class="footer-col">
        <h4>Quick Links</h4>
        <ul>
          <li><a href="${routeHref('about')}">About Us</a></li>
          <li><a href="${routeHref('privacy')}">Privacy Policy</a></li>
          <li><a href="${routeHref('terms')}">Terms &amp; Conditions</a></li>
          <li><a href="${routeHref('help')}">Help &amp; Support</a></li>
          <li><a href="${routeHref('credits')}">Credits</a></li>
        </ul>
      </div>

      <div class="footer-col">
        <h4>Contact Us</h4>
        <ul class="footer-contact">
          <li><a href="https://www.facebook.com/irnahmed360" target="_blank" rel="noopener"><i class="fa-brands fa-facebook-f"></i> Facebook</a></li>
          <li><a href="https://www.youtube.com/@imran.ahmedd" target="_blank" rel="noopener"><i class="fa-brands fa-youtube"></i> YouTube Channel</a></li>
          <li><a href="https://wa.me/8801957329211" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a></li>
          <li><a href="mailto:project.developer.tech@gmail.com"><i class="fa-solid fa-envelope"></i> project.developer.tech@gmail.com</a></li>
          <li><a href="tel:+8801957329211"><i class="fa-solid fa-phone"></i>call</a></li>
        </ul>
      </div>
    </div>

    <div class="footer-bottom container">
      <span>© <span class="js-year"></span> Tech Verse Course. All rights reserved.</span>
      <span class="footer-credit">Designed &amp; developed by <a href="https://www.facebook.com/imran.ahmedddddd" target="_blank" rel="noopener">Imran Ahmed</a></span>
    </div>
  </footer>`;
  }

  function renderFooters() {
    document.querySelectorAll('[data-footer]').forEach(function (placeholder) {
      placeholder.outerHTML = footerMarkup();
    });
    document.querySelectorAll('.js-year').forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderFooters);
  } else {
    renderFooters();
  }
})();
