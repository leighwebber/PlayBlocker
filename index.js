const API_URL = "https://lwebber.ca/api";

function showError(msg) {
    const el = document.getElementById('error-msg');
    el.textContent = msg;
    el.style.display = 'block';
}

function hideError() {
    document.getElementById('error-msg').style.display = 'none';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const data = Object.fromEntries(new FormData(e.target));
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            showError('Incorrect email or password. Please try again.');
            return;
        }
        window.location.href = '/Pages/Productions.html';
    } catch {
        showError('Could not reach the server. Check your connection and try again.');
    }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const data = Object.fromEntries(new FormData(e.target));
    try {
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            showError(`Registration failed (${res.status}). Please try again.`);
            return;
        }
        // Auto-login after registration
        const loginRes = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email: data.email, password: data.password })
        });
        if (loginRes.ok) {
            window.location.href = '/Pages/Productions.html';
        } else {
            document.getElementById('registerSection').style.display = 'none';
            document.getElementById('loginSection').style.display = 'block';
            showError('Account created! Please sign in.');
        }
    } catch {
        showError('Could not reach the server. Check your connection and try again.');
    }
});
