const API_URL = "https://lwebber.ca/api";

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

function showError(msg) {
    const el = document.getElementById('error-msg');
    el.textContent = msg;
    el.style.display = 'block';
    document.getElementById('info-msg').style.display = 'none';
}

function showInfo(msg) {
    const el = document.getElementById('info-msg');
    el.textContent = msg;
    el.style.display = 'block';
    document.getElementById('error-msg').style.display = 'none';
}

function hideMessages() {
    document.getElementById('error-msg').style.display = 'none';
    document.getElementById('info-msg').style.display = 'none';
}

// ---------------------------------------------------------------------------
// Query-param banners (verified=true|invalid|error, reason=session_expired etc.)
// ---------------------------------------------------------------------------

(function handleQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get('verified');
    const reason   = params.get('reason');

    if (verified === 'true') {
        showInfo('Your email has been confirmed. You can now sign in.');
    } else if (verified === 'invalid') {
        showError('That confirmation link has expired or is invalid. Enter your email below to request a new one.');
        showResendForm();
    } else if (verified === 'error') {
        showError('Something went wrong confirming your email. Please try again or request a new link.');
        showResendForm();
    } else if (reason === 'session_expired') {
        showError('Your session has expired. Please sign in again.');
    } else if (reason === 'network_error') {
        showError('Could not reach the server. Please check your connection and sign in again.');
    }
})();

// ---------------------------------------------------------------------------
// Section switchers
// ---------------------------------------------------------------------------

function showLogin() {
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('registerSection').style.display = 'none';
    document.getElementById('resendSection').style.display = 'none';
}

function showRegister() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('registerSection').style.display = 'block';
    document.getElementById('resendSection').style.display = 'none';
}

function showResendForm() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('registerSection').style.display = 'none';
    document.getElementById('resendSection').style.display = 'block';
}

document.getElementById('show-register').addEventListener('click', (e) => { e.preventDefault(); hideMessages(); showRegister(); });
document.getElementById('show-login').addEventListener('click',    (e) => { e.preventDefault(); hideMessages(); showLogin(); });
document.getElementById('show-login-2').addEventListener('click',  (e) => { e.preventDefault(); hideMessages(); showLogin(); });
document.getElementById('show-resend').addEventListener('click',   (e) => { e.preventDefault(); hideMessages(); showResendForm(); });

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessages();
    const data = Object.fromEntries(new FormData(e.target));
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data),
        });
        if (res.ok) {
            window.location.href = '/Pages/Productions.html';
            return;
        }
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.message === 'email_not_verified') {
            showError('Please confirm your email address before signing in.');
            document.getElementById('resend-email-prefill').value = data.email;
            document.getElementById('resend-hint').style.display = 'block';
        } else {
            showError('Incorrect email or password. Please try again.');
        }
    } catch {
        showError('Could not reach the server. Check your connection and try again.');
    }
});

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessages();
    const data = Object.fromEntries(new FormData(e.target));
    try {
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
            showError('That email address is already registered. Please sign in.');
            showLogin();
            return;
        }
        if (!res.ok) {
            showError(body.message || `Registration failed (${res.status}). Please try again.`);
            return;
        }
        // Success — show confirmation message, switch to login panel
        showLogin();
        showInfo('Account created! Check your inbox for a confirmation email. You must confirm your address before signing in.');
        e.target.reset();
    } catch {
        showError('Could not reach the server. Check your connection and try again.');
    }
});

// ---------------------------------------------------------------------------
// Resend verification
// ---------------------------------------------------------------------------

document.getElementById('resendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessages();
    const email = document.getElementById('resend-email').value.trim();
    try {
        await fetch(`${API_URL}/resend-verification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        // Always show the neutral message to avoid enumeration
        showInfo('If that address is registered and unverified, a new confirmation link has been sent. Please check your inbox.');
        showLogin();
    } catch {
        showError('Could not reach the server. Check your connection and try again.');
    }
});
