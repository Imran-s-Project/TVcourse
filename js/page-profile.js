// js/page-profile.js
// Markup for the #/profile SPA route (previously profile.html, now removed).
// Rendered once by app.js's router directly into index.html; js/profile.js
// then binds all the tab/form/account behavior onto this markup via its
// exported initProfilePage(). This route no longer exists as its own HTML
// file at all.

export const title = "Profile — Tech Verse Course";

export function render() {
  return `
  <main class="container profile-page">
    <div class="profile-card">
      <div class="profile-cover"></div>
      <div class="profile-header">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar" id="profile-avatar"></div>
          <button type="button" class="avatar-edit-btn" id="avatar-edit-trigger" title="Change profile picture">
            <i class="fa-solid fa-camera"></i>
          </button>
        </div>
        <div class="profile-name">
          <h1 id="profile-name">Loading...</h1>
          <p id="profile-email"></p>
          <div class="profile-meta" id="profile-meta"></div>
        </div>
        <a href="admin.html" class="btn btn-outline btn-sm admin-shortcut hidden" id="admin-shortcut-btn"><i class="fa-solid fa-gear"></i> Admin Panel</a>
      </div>
    </div>

    <div class="profile-stats" id="profile-stats"></div>

    <div class="tab-row">
      <button class="tab-btn active" data-tab="tab-purchases"><i class="fa-solid fa-receipt"></i> Purchase History</button>
      <button class="tab-btn" data-tab="tab-results"><i class="fa-solid fa-file-pen"></i> Exam Results</button>
      <button class="tab-btn" data-tab="tab-settings"><i class="fa-solid fa-user-pen"></i> Settings</button>
      <button class="tab-btn" data-tab="tab-security"><i class="fa-solid fa-shield-halved"></i> Security</button>
    </div>

    <div id="tab-purchases" class="tab-panel">
      <div id="purchases-list"></div>
    </div>

    <div id="tab-results" class="tab-panel hidden">
      <div id="results-list"></div>
    </div>

    <div id="tab-settings" class="tab-panel hidden">
      <form id="settings-form" class="card settings-card">
        <h3 class="panel-title"><i class="fa-solid fa-user-pen"></i> Profile Information</h3>
        <p class="muted panel-desc">Update your name and profile picture — this is how you'll appear across Tech Verse Course.</p>

        <div class="avatar-picker">
          <div class="avatar-picker-preview" id="avatar-picker-preview"></div>
          <div class="avatar-picker-actions">
            <label for="settings-avatar" class="btn btn-outline btn-sm avatar-picker-btn"><i class="fa-solid fa-upload"></i> Choose Photo</label>
            <input type="file" id="settings-avatar" accept="image/*" hidden>
            <span class="muted avatar-picker-hint" id="avatar-picker-filename">JPG or PNG, up to 5MB</span>
          </div>
        </div>

        <div class="field">
          <label for="settings-name">Full Name</label>
          <input type="text" id="settings-name" required>
        </div>

        <div class="field locked-field">
          <label>Phone Number</label>
          <input type="tel" id="settings-phone" readonly tabindex="-1">
          <span class="field-lock-note"><i class="fa-solid fa-lock"></i> Locked to your account for payment verification — contact support to change it</span>
        </div>

        <div class="field">
          <label for="settings-bio">Bio <span class="muted">(optional)</span></label>
          <textarea id="settings-bio" rows="3" maxlength="200" placeholder="A short line about yourself"></textarea>
          <span class="muted form-hint" id="settings-bio-count">0/200</span>
        </div>

        <button type="submit" class="btn btn-primary" id="settings-save-btn">Save Changes</button>
      </form>
    </div>

    <div id="tab-security" class="tab-panel hidden">
      <div class="card linked-accounts-card">
        <div class="linked-accounts-head">
          <div>
            <h3 class="panel-title"><i class="fa-solid fa-link"></i> Linked Accounts</h3>
            <p class="muted panel-desc">দ্রুত ও নিরাপদ লগইনের জন্য আপনার প্রোফাইলের সাথে অন্য অ্যাকাউন্ট যুক্ত করুন। যেকোনো একটি দিয়ে লগইন করতে পারবেন।</p>
          </div>
          <span class="connect-summary" id="connect-summary"></span>
        </div>
        <div id="linked-accounts-list" class="linked-accounts-list"></div>
      </div>

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
          <p class="muted panel-desc">Sensitive account actions — review each carefully before proceeding.</p>

          <div class="danger-action">
            <span class="danger-action-icon danger-action-icon-amber"><i class="fa-solid fa-pause"></i></span>
            <div class="danger-action-body">
              <div class="danger-action-head">
                <h4>Deactivate Account</h4>
                <span class="badge badge-amber">Reversible</span>
              </div>
              <p class="muted">Temporarily hide your account and sign out everywhere. Nothing is deleted — log back in anytime to reactivate.</p>
              <button type="button" class="btn btn-outline btn-sm" id="deactivate-account-btn"><i class="fa-solid fa-pause"></i> Deactivate</button>
            </div>
          </div>

          <div class="danger-divider"></div>

          <div class="danger-action">
            <span class="danger-action-icon danger-action-icon-coral"><i class="fa-solid fa-trash"></i></span>
            <div class="danger-action-body">
              <div class="danger-action-head">
                <h4>Delete Account</h4>
                <span class="badge badge-coral">Irreversible</span>
              </div>
              <p class="muted">Permanently removes your profile, profile picture, and login information. Purchase and exam records may be retained by the admin for verification.</p>
              <button type="button" class="btn btn-danger btn-sm" id="delete-account-btn"><i class="fa-solid fa-trash"></i> Delete Account</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>`;
}
