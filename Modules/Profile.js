import { API_URL } from './Constants.js';

let overlay = null;

export async function openProfileModal() {
    if (overlay) return;
    try {
        const res = await fetch(`${API_URL}/profile`, { credentials: 'include' });
        if (!res.ok) return;
        buildModal(await res.json());
    } catch { /* network error — silently bail */ }
}

function buildModal(profile) {
    overlay = document.createElement('div');
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.45);
        display:flex;align-items:center;justify-content:center;z-index:9000;overflow-y:auto;padding:20px 0;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background:#fff;border-radius:6px;padding:28px 32px;width:420px;max-width:95vw;
        box-shadow:0 6px 24px rgba(0,0,0,0.25);
        font-family:'Lucida Sans',Geneva,Verdana,sans-serif;font-size:14px;
    `;

    box.innerHTML = `
        <h2 style="font-family:'Gill Sans',Calibri,sans-serif;font-size:18pt;font-weight:normal;color:#222;margin:0 0 20px;">Your Profile</h2>

        <!-- Personal details -->
        <h3 style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:0 0 10px;">Personal Details</h3>
        <div style="display:flex;gap:10px;margin-bottom:10px;">
            <div style="flex:1;">
                <label class="pf-label">First name</label>
                <input class="pf-input" id="pf-firstname" type="text" value="${esc(profile.first_name)}">
            </div>
            <div style="flex:1;">
                <label class="pf-label">Last name</label>
                <input class="pf-input" id="pf-lastname" type="text" value="${esc(profile.last_name)}">
            </div>
        </div>
        <div style="margin-bottom:14px;">
            <label class="pf-label">Email</label>
            <input class="pf-input" type="email" value="${esc(profile.email)}" disabled style="background:#f5f5f5;color:#888;">
        </div>
        <button class="pf-btn-primary" id="pf-save-details">Save Details</button>
        <p class="pf-msg" id="pf-details-msg"></p>

        <hr style="border:none;border-top:1px solid #eee;margin:22px 0;">

        <!-- Change password -->
        <h3 style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:0 0 10px;">Change Password</h3>
        <div style="margin-bottom:10px;">
            <label class="pf-label">Current password</label>
            <input class="pf-input" id="pf-current-pw" type="password" autocomplete="current-password">
        </div>
        <div style="margin-bottom:10px;">
            <label class="pf-label">New password</label>
            <input class="pf-input" id="pf-new-pw" type="password" autocomplete="new-password">
        </div>
        <div style="margin-bottom:14px;">
            <label class="pf-label">Confirm new password</label>
            <input class="pf-input" id="pf-confirm-pw" type="password" autocomplete="new-password">
        </div>
        <button class="pf-btn-primary" id="pf-change-pw">Change Password</button>
        <p class="pf-msg" id="pf-pw-msg"></p>

        <hr style="border:none;border-top:1px solid #eee;margin:22px 0;">

        <!-- Two-factor authentication -->
        <h3 style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:0 0 10px;">Two-Factor Authentication</h3>
        <p style="font-size:13px;color:#555;margin:0 0 12px;line-height:1.5;">When enabled, you will be sent a one-time code each time you sign in.</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
                <input type="radio" name="pf-2fa" id="pf-2fa-off"   value=""      ${!profile.two_fa_method      ? 'checked' : ''}>
                Disabled
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
                <input type="radio" name="pf-2fa" id="pf-2fa-email" value="email" ${profile.two_fa_method==='email' ? 'checked' : ''}>
                Email — send a code to <strong>${esc(profile.email)}</strong>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#aaa;cursor:default;">
                <input type="radio" name="pf-2fa" value="sms" disabled>
                SMS (coming soon)
            </label>
        </div>
        <button class="pf-btn-primary" id="pf-save-2fa">Save Security Settings</button>
        <p class="pf-msg" id="pf-2fa-msg"></p>

        <hr style="border:none;border-top:1px solid #eee;margin:22px 0;">
        <div style="text-align:right;">
            <button class="pf-btn-secondary" id="pf-close">Close</button>
        </div>
    `;

    // Inject scoped styles
    const style = document.createElement('style');
    style.dataset.pf = '';
    style.textContent = `
        .pf-label { display:block;font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:4px; }
        .pf-input  { width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:14px;font-family:inherit;box-sizing:border-box; }
        .pf-input:focus { outline:none;border-color:#007bff; }
        .pf-btn-primary   { padding:7px 18px;background:#007bff;color:#fff;border:none;border-radius:4px;font-size:13px;cursor:pointer;font-family:inherit; }
        .pf-btn-primary:hover { background:#0056b3; }
        .pf-btn-secondary { padding:7px 18px;background:#f0f0f0;color:#333;border:1px solid #bbb;border-radius:4px;font-size:13px;cursor:pointer;font-family:inherit; }
        .pf-btn-secondary:hover { background:#e0e0e0; }
        .pf-msg { font-size:13px;margin:8px 0 0;min-height:18px; }
    `;
    document.head.appendChild(style);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);

    // Wire up buttons
    box.querySelector('#pf-close').addEventListener('click', closeModal);

    box.querySelector('#pf-save-details').addEventListener('click', async () => {
        const msg = box.querySelector('#pf-details-msg');
        const first_name = box.querySelector('#pf-firstname').value.trim();
        const last_name  = box.querySelector('#pf-lastname').value.trim();
        if (!first_name) { setMsg(msg, 'First name is required.', false); return; }
        const res = await fetch(`${API_URL}/profile`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ first_name, last_name }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(msg, body.error || 'Failed to save.', false); return; }
        setMsg(msg, 'Details saved.', true);
        // Update visible username if the element exists on the page
        const usernameEl = document.getElementById('username');
        if (usernameEl) usernameEl.textContent = [first_name, last_name].filter(Boolean).join(' ');
    });

    box.querySelector('#pf-change-pw').addEventListener('click', async () => {
        const msg         = box.querySelector('#pf-pw-msg');
        const current     = box.querySelector('#pf-current-pw').value;
        const newPw       = box.querySelector('#pf-new-pw').value;
        const confirmPw   = box.querySelector('#pf-confirm-pw').value;
        if (!current || !newPw || !confirmPw) { setMsg(msg, 'All three fields are required.', false); return; }
        if (newPw !== confirmPw)              { setMsg(msg, 'New passwords do not match.', false); return; }
        if (newPw.length < 8)                { setMsg(msg, 'New password must be at least 8 characters.', false); return; }
        const res = await fetch(`${API_URL}/profile/password`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password: current, new_password: newPw }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(msg, body.error || 'Failed to change password.', false); return; }
        setMsg(msg, 'Password changed.', true);
        box.querySelector('#pf-current-pw').value = '';
        box.querySelector('#pf-new-pw').value     = '';
        box.querySelector('#pf-confirm-pw').value = '';
    });

    box.querySelector('#pf-save-2fa').addEventListener('click', async () => {
        const msg          = box.querySelector('#pf-2fa-msg');
        const two_fa_method = box.querySelector('input[name="pf-2fa"]:checked')?.value || null;
        const res = await fetch(`${API_URL}/profile`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ two_fa_method: two_fa_method || null }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(msg, body.error || 'Failed to save.', false); return; }
        const label = two_fa_method === 'email' ? 'Two-factor authentication enabled (email).' : 'Two-factor authentication disabled.';
        setMsg(msg, label, true);
    });
}

function setMsg(el, text, success) {
    el.textContent = text;
    el.style.color = success ? '#28a745' : '#dc3545';
}

function esc(str) {
    return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function closeModal() {
    overlay?.remove();
    // Remove the scoped style tag we injected
    document.head.querySelector('style[data-pf]')?.remove();
    overlay = null;
}
