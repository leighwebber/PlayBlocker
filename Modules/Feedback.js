import { API_URL } from './Constants.js';

let overlay = null;

function buildModal() {
    overlay = document.createElement('div');
    overlay.id = 'fb-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.45);
        display: flex; align-items: center; justify-content: center;
        z-index: 9000;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: #fff; border-radius: 6px; padding: 24px;
        width: 380px; max-width: 95vw;
        box-shadow: 0 6px 24px rgba(0,0,0,0.25);
        font-family: 'Lucida Sans', Geneva, Verdana, sans-serif; font-size: 14px;
    `;

    const heading = document.createElement('p');
    heading.textContent = 'Send Feedback';
    heading.style.cssText = 'margin: 0 0 12px; font-size: 15px; font-weight: bold; color: #333;';

    const textarea = document.createElement('textarea');
    textarea.id = 'fb-message';
    textarea.placeholder = 'Type your comments here…';
    textarea.style.cssText = `
        width: 100%; height: 120px; padding: 8px 10px;
        border: 1px solid #ccc; border-radius: 4px;
        font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box;
    `;

    const status = document.createElement('p');
    status.id = 'fb-status';
    status.style.cssText = 'margin: 8px 0 0; font-size: 13px; color: #555; min-height: 18px;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
        padding: 6px 16px; border: 1px solid #bbb; border-radius: 4px;
        background: #f0f0f0; cursor: pointer; font-size: 13px;
    `;
    cancelBtn.addEventListener('click', closeModal);

    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = `
        padding: 6px 16px; border: none; border-radius: 4px;
        background: #007bff; color: white; cursor: pointer; font-size: 13px;
    `;
    sendBtn.addEventListener('click', async () => {
        const message = textarea.value.trim();
        if (!message) { status.textContent = 'Please enter a message.'; return; }

        sendBtn.disabled = true;
        cancelBtn.disabled = true;
        status.textContent = 'Sending…';

        try {
            const res = await fetch(`${API_URL}/feedback`, {
                method:      'POST',
                credentials: 'include',
                headers:     { 'Content-Type': 'application/json' },
                body:        JSON.stringify({ message }),
            });
            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
            status.style.color = '#28a745';
            status.textContent = 'Feedback sent. Thank you!';
            setTimeout(closeModal, 1500);
        } catch (err) {
            status.style.color = '#dc3545';
            status.textContent = `Error: ${err.message}`;
            sendBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    });

    btnRow.append(cancelBtn, sendBtn);
    box.append(heading, textarea, status, btnRow);
    overlay.appendChild(box);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
}

function closeModal() {
    overlay?.remove();
    overlay = null;
}

export function openFeedbackModal() {
    if (overlay) return;
    buildModal();
    document.getElementById('fb-message').focus();
}
