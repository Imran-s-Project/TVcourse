// js/page-profile.js
// Markup for the #/profile SPA route (previously profile.html, now removed).
// Rendered once by app.js's router directly into index.html; js/profile.js
// then binds all the tab/form/account behavior onto this markup via its
// exported initProfilePage(). This route no longer exists as its own HTML
// file at all.

export const title = "Profile — Tech Verse Course";

export function render() {
  return `
  <main class="container">
    <div class="profile-header">
      <div class="profile-avatar" id="profile-avatar"></div>
      <div class="profile-name">
        <h1 id="profile-name">Loading...</h1>
        <p id="profile-email"></p>
        <div class="profile-meta" id="profile-meta"></div>
      </div>
      <a href="admin.html" class="btn btn-outline btn-sm admin-shortcut hidden" id="admin-shortcut-btn"><i class="fa-solid fa-gear"></i> Admin Panel</a>
    </div>

    <div class="profile-stats" id="profile-stats"></div>

    <div class="tab-row">
      <button class="tab-btn active" data-tab="tab-courses"><i class="fa-solid fa-book-open"></i> My Courses</button>
      <button class="tab-btn" data-tab="tab-purchases"><i class="fa-solid fa-receipt"></i> Purchase History</button>
      <button class="tab-btn" data-tab="tab-results"><i class="fa-solid fa-file-pen"></i> Exam Results</button>
      <button class="tab-btn" data-tab="tab-settings"><i class="fa-solid fa-user-pen"></i> Settings</button>
      <button class="tab-btn" data-tab="tab-security"><i class="fa-solid fa-shield-halved"></i> Security</button>
    </div>

    <div id="tab-courses" class="tab-panel">
      <div id="my-courses-list"></div>
    </div>

    <div id="tab-purchases" class="tab-panel hidden">
      <div id="purchases-list"></div>
    </div>

    <div id="tab-results" class="tab-panel hidden">
      <div id="results-list"></div>
    </div>

    <div id="tab-settings" class="tab-panel hidden">
      <form id="settings-form" class="card" style="max-width:480px">
        <h3 class="panel-title"><i class="fa-solid fa-user-pen"></i> Profile Information</h3>
        <div class="field">
          <label for="settings-name">Full Name</label>
          <input type="text" id="settings-name" required>
        </div>
        <div class="field">
          <label for="settings-avatar">Profile Picture</label>
          <input type="file" id="settings-avatar" accept="image/*">
        </div>
        <button type="submit" class="btn btn-primary" id="settings-save-btn">Save</button>
      </form>
    </div>

    <div id="tab-security" class="tab-panel hidden">
      <div class="security-grid">
        <form id="password-form" class="card">
          <h3 class="panel-title"><i class="fa-solid fa-key"></i> Change Password</h3>
          <p class="muted panel-desc">For security, you must confirm with your current password before setting a new one.</p>
          <div class="field">
            <label for="current-password">Current Password</label>
            <input type="password" id="current-password" required autocomplete="current-password">
          </div>
          <div class="field">
            <label for="new-password">New Password</label>
            <input type="password" id="new-password" required minlength="6" autocomplete="new-password">
          </div>
          <div class="field">
            <label for="confirm-password">Confirm New Password</label>
            <input type="password" id="confirm-password" required minlength="6" autocomplete="new-password">
          </div>
          <div class="form-error" id="password-error"></div>
          <button type="submit" class="btn btn-primary" id="password-save-btn">Update Password</button>
        </form>

        <div class="card danger-zone">
          <h3 class="panel-title"><i class="fa-solid fa-triangle-exclamation"></i> Danger Zone</h3>
          <p class="muted panel-desc">Deleting your account will permanently remove your profile, profile picture, and login information — this cannot be undone. Records of purchased courses and exam results may be retained by the admin for verification.</p>
          <button type="button" class="btn btn-danger btn-block" id="delete-account-btn"><i class="fa-solid fa-trash"></i> Permanently Delete Account</button>
        </div>
      </div>
    </div>
  </main>`;
}
