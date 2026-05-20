import { API_URL } from './Constants.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let selectedProductionId = null;
let activeColorInput     = null;
let activeColorPreview   = null;
let currentSpeakers      = [];   // { scriptName, firstName, lastName, initials, color }

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const productionList      = document.getElementById('production-list');
const detailEmpty         = document.getElementById('detail-empty');
const detailContent       = document.getElementById('detail-content');
const productionNameEl    = document.getElementById('production-name');
const imageSection        = document.getElementById('image-section');
const imageFileInput      = document.getElementById('image-file-input');
const imagePreview        = document.getElementById('image-preview');
const textFileInput       = document.getElementById('text-file-input');
const scriptStatus        = document.getElementById('script-status');
const speakersSection     = document.getElementById('speakers-section');
const speakersTbody       = document.getElementById('speakers-tbody');
const colorPickerPopup    = document.getElementById('color-picker-popup');
const colorGrid           = document.getElementById('color-grid');
const colorSearch         = document.getElementById('color-search');
const openPlayBlockerBtn  = document.getElementById('open-playblocker-btn');

// ---------------------------------------------------------------------------
// CSS named colors (148)
// ---------------------------------------------------------------------------
const CSS_COLORS = [
    'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque',
    'black','blanchedalmond','blue','blueviolet','brown','burlywood',
    'cadetblue','chartreuse','chocolate','coral','cornflowerblue','cornsilk',
    'crimson','cyan','darkblue','darkcyan','darkgoldenrod','darkgray',
    'darkgreen','darkgrey','darkkhaki','darkmagenta','darkolivegreen',
    'darkorange','darkorchid','darkred','darksalmon','darkseagreen',
    'darkslateblue','darkslategray','darkslategrey','darkturquoise',
    'darkviolet','deeppink','deepskyblue','dimgray','dimgrey','dodgerblue',
    'firebrick','floralwhite','forestgreen','fuchsia','gainsboro','ghostwhite',
    'gold','goldenrod','gray','green','greenyellow','grey','honeydew',
    'hotpink','indianred','indigo','ivory','khaki','lavender','lavenderblush',
    'lawngreen','lemonchiffon','lightblue','lightcoral','lightcyan',
    'lightgoldenrodyellow','lightgray','lightgreen','lightgrey','lightpink',
    'lightsalmon','lightseagreen','lightskyblue','lightslategray',
    'lightslategrey','lightsteelblue','lightyellow','lime','limegreen',
    'linen','magenta','maroon','mediumaquamarine','mediumblue','mediumorchid',
    'mediumpurple','mediumseagreen','mediumslateblue','mediumspringgreen',
    'mediumturquoise','mediumvioletred','midnightblue','mintcream','mistyrose',
    'moccasin','navajowhite','navy','oldlace','olive','olivedrab','orange',
    'orangered','orchid','palegoldenrod','palegreen','paleturquoise',
    'palevioletred','papayawhip','peachpuff','peru','pink','plum',
    'powderblue','purple','rebeccapurple','red','rosybrown','royalblue',
    'saddlebrown','salmon','sandybrown','seagreen','seashell','sienna',
    'silver','skyblue','slateblue','slategray','slategrey','snow',
    'springgreen','steelblue','tan','teal','thistle','tomato','turquoise',
    'violet','wheat','white','whitesmoke','yellow','yellowgreen',
];

function buildColorGrid(filter = '') {
    colorGrid.innerHTML = '';
    const lower = filter.toLowerCase();
    CSS_COLORS
        .filter(c => !lower || c.includes(lower))
        .forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = color;
            swatch.title = color;
            swatch.addEventListener('click', () => pickColor(color));
            colorGrid.appendChild(swatch);
        });
}

buildColorGrid();

colorSearch.addEventListener('input', () => buildColorGrid(colorSearch.value));

function pickColor(color) {
    if (activeColorInput) {
        activeColorInput.value = color;
        const idx = parseInt(activeColorInput.dataset.index);
        currentSpeakers[idx].color = color;
    }
    if (activeColorPreview) {
        activeColorPreview.style.backgroundColor = color;
    }
    colorPickerPopup.hidden = true;
}

document.addEventListener('click', (e) => {
    if (!colorPickerPopup.hidden &&
        !colorPickerPopup.contains(e.target) &&
        !e.target.classList.contains('color-btn')) {
        colorPickerPopup.hidden = true;
    }
});

// ---------------------------------------------------------------------------
// Session validation
// ---------------------------------------------------------------------------
async function validateSession() {
    try {
        const res = await fetch(`${API_URL}/validate`, { method: 'GET', credentials: 'include' });
        if (!res.ok) { window.location.href = '/index.html'; return; }
        const data = await res.json();
        document.getElementById('username').textContent =
            [data.first_name, data.last_name].filter(Boolean).join(' ');
    } catch {
        window.location.href = '/index.html';
    }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch(`${API_URL}/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = '/index.html';
});

// ---------------------------------------------------------------------------
// Production list
// ---------------------------------------------------------------------------
async function loadProductions() {
    const res = await fetch(`${API_URL}/productions`, { credentials: 'include' });
    if (!res.ok) return;
    const productions = await res.json();
    renderProductionList(productions);
}

function renderProductionList(productions) {
    productionList.innerHTML = '';
    productions.forEach(p => {
        const li = document.createElement('li');
        li.className = 'production-item';
        li.textContent = p.name;
        li.dataset.id = p.id;
        if (p.id === selectedProductionId) li.classList.add('selected');
        li.addEventListener('click', () => selectProduction(p.id));
        productionList.appendChild(li);
    });
}

document.getElementById('new-production-btn').addEventListener('click', async () => {
    const name = prompt('Production name:');
    if (!name || !name.trim()) return;
    const res = await fetch(`${API_URL}/productions`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) { alert('Failed to create production.'); return; }
    const production = await res.json();
    await loadProductions();
    selectProduction(production.id);
});

// ---------------------------------------------------------------------------
// Select a production
// ---------------------------------------------------------------------------
async function selectProduction(id) {
    selectedProductionId = id;

    const [prodRes, speakerRes] = await Promise.all([
        fetch(`${API_URL}/productions/${id}`, { credentials: 'include' }),
        fetch(`${API_URL}/speakers?productionId=${id}`, { credentials: 'include' }),
    ]);

    if (!prodRes.ok) { alert('Failed to load production.'); return; }
    const production      = await prodRes.json();
    const existingSpeakers = speakerRes.ok ? await speakerRes.json() : [];

    document.querySelectorAll('.production-item').forEach(li => {
        li.classList.toggle('selected', parseInt(li.dataset.id) === id);
    });

    detailEmpty.hidden   = true;
    detailContent.hidden = false;
    productionNameEl.value = production.name;

    openPlayBlockerBtn.href = `PlayBlocker.html?productionId=${id}`;

    if (production.stage_image) {
        imagePreview.src    = production.stage_image;
        imagePreview.hidden = false;
    } else {
        imagePreview.src    = '';
        imagePreview.hidden = true;
    }

    if (production.script_body) {
        scriptStatus.textContent = 'Script loaded.';
        imageSection.hidden = false;
        buildSpeakerList(production.script_body, existingSpeakers);
    } else {
        scriptStatus.textContent = '';
        currentSpeakers = [];
        speakersSection.hidden = true;
        imageSection.hidden = true;
    }
}

// ---------------------------------------------------------------------------
// Production name save / delete
// ---------------------------------------------------------------------------
document.getElementById('save-name-btn').addEventListener('click', async () => {
    const name = productionNameEl.value.trim();
    if (!name || !selectedProductionId) return;
    const res = await fetch(`${API_URL}/productions/${selectedProductionId}`, {
        method:      'PUT',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ name }),
    });
    if (!res.ok) { alert('Failed to save name.'); return; }
    await loadProductions();
});

document.getElementById('delete-production-btn').addEventListener('click', async () => {
    if (!selectedProductionId) return;
    if (!confirm('Delete this production? This cannot be undone.')) return;
    const res = await fetch(`${API_URL}/productions/${selectedProductionId}`, {
        method:      'DELETE',
        credentials: 'include',
    });
    if (!res.ok) { alert('Failed to delete production.'); return; }
    selectedProductionId = null;
    currentSpeakers      = [];
    detailEmpty.hidden   = false;
    detailContent.hidden = true;
    await loadProductions();
});

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------
imageFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedProductionId) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        const dataUrl = event.target.result;
        imagePreview.src    = dataUrl;
        imagePreview.hidden = false;

        const res = await fetch(`${API_URL}/productions/${selectedProductionId}/image`, {
            method:      'PUT',
            credentials: 'include',
            headers:     { 'Content-Type': 'application/json' },
            body:        JSON.stringify({ image: dataUrl }),
        });
        if (!res.ok) alert('Failed to save image.');
    };
    reader.readAsDataURL(file);
});

// ---------------------------------------------------------------------------
// Text-to-script converter
// ---------------------------------------------------------------------------
function convertTextScript(text) {
    const CLASS_MAP = { p: 'PageBreak', a: 'Act', n: 'Scene', d: 'StageDirection', c: 'Speaker', s: 'Speech' };
    const WRAP_INLINE = new Set(['StageDirection', 'Speech']);

    function wrapInlineDirections(str) {
        return str.replace(/\(([^)]*)\)/g, "<span class='InLineDirection'>($1)</span>");
    }

    const paragraphs = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const m = line.match(/^([pancds]):\s*(.*)/);
        if (m) {
            const content = m[1] === 'c' ? m[2].trim().toUpperCase() : m[2];
            paragraphs.push({ cls: CLASS_MAP[m[1]], content });
        } else {
            paragraphs.push({ cls: 'ParseError', content: line });
        }
    }

    return paragraphs.map(({ cls, content }) => {
        if (cls === 'PageBreak') {
            return `<p class='PageBreak'>  --------------------Page ${escHtml(content.trim())}--------------------  </p>`;
        }
        if (cls === 'ParseError') {
            return `<p class='ParseError'>PARSING ERROR — Each paragraph must begin with a tag: ${escHtml(content)}</p>`;
        }
        const inner = WRAP_INLINE.has(cls) ? wrapInlineDirections(escHtml(content)) : escHtml(content);
        return `<p class='${cls}'>${inner}</p>`;
    }).join('\n');
}

textFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedProductionId) return;

    const bodyHtml = convertTextScript(await file.text());
    e.target.value = '';

    if (!bodyHtml.trim()) {
        alert('No recognized content found. Make sure each line starts with p:, a:, n:, d:, c:, or s:');
        return;
    }

    const res = await fetch(`${API_URL}/productions/${selectedProductionId}/script`, {
        method:      'PUT',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ scriptBody: bodyHtml }),
    });
    if (!res.ok) { alert('Failed to save script.'); return; }

    scriptStatus.textContent = 'Script converted and saved.';
    imageSection.hidden = false;
    const speakerRes       = await fetch(`${API_URL}/speakers?productionId=${selectedProductionId}`, { credentials: 'include' });
    const existingSpeakers = speakerRes.ok ? await speakerRes.json() : [];
    buildSpeakerList(bodyHtml, existingSpeakers);
});

// ---------------------------------------------------------------------------
// Speaker list: parse script → merge with DB → render form
// ---------------------------------------------------------------------------
function buildSpeakerList(scriptBody, dbSpeakers) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(`<html><body>${scriptBody}</body></html>`, 'text/html');

    const scriptNames = new Set();
    doc.querySelectorAll('p.Speaker').forEach(p => {
        const name = p.textContent.trim();
        if (name) scriptNames.add(name);
    });

    // Match DB rows by script_name (case-insensitive so uppercase conversion doesn't lose data)
    const dbMap = new Map(dbSpeakers.map(s => [s.script_name.toUpperCase(), s]));

    currentSpeakers = Array.from(scriptNames).map(scriptName => {
        const db = dbMap.get(scriptName.toUpperCase());
        return {
            scriptName,
            firstName: db?.first_name ?? '',
            lastName:  db?.last_name  ?? '',
            initials:  db?.initials   ?? '',
            color:     db?.color      ?? '',
        };
    });

    speakersSection.hidden = currentSpeakers.length === 0;
    renderSpeakerForm();
}

// ---------------------------------------------------------------------------
// Speaker form rendering
// ---------------------------------------------------------------------------
function escHtml(str) {
    return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSpeakerForm() {
    speakersTbody.innerHTML = '';

    currentSpeakers.forEach((speaker, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="col-script">${escHtml(speaker.scriptName)}</td>
            <td class="col-fname">
                <input class="speaker-input" data-field="firstName" data-index="${i}"
                       type="text" value="${escHtml(speaker.firstName)}" placeholder="First">
            </td>
            <td class="col-lname">
                <input class="speaker-input" data-field="lastName" data-index="${i}"
                       type="text" value="${escHtml(speaker.lastName)}" placeholder="Last">
            </td>
            <td class="col-init">
                <input class="speaker-input" data-field="initials" data-index="${i}"
                       type="text" maxlength="3" value="${escHtml(speaker.initials)}" placeholder="AB">
            </td>
            <td class="col-color">
                <div class="color-input-group">
                    <span class="color-preview" style="background:${escHtml(speaker.color)}"></span>
                    <input class="speaker-input color-text-input" data-field="color" data-index="${i}"
                           type="text" value="${escHtml(speaker.color)}" placeholder="e.g. cornflowerblue">
                    <button class="color-btn" data-index="${i}" title="Choose from palette">▼</button>
                </div>
            </td>
        `;
        speakersTbody.appendChild(tr);
    });

    // Text input changes
    speakersTbody.querySelectorAll('.speaker-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const idx   = parseInt(e.target.dataset.index);
            const field = e.target.dataset.field;
            currentSpeakers[idx][field] = e.target.value;

            if (field === 'color') {
                const preview = e.target.closest('.color-input-group').querySelector('.color-preview');
                preview.style.backgroundColor = e.target.value;
            }
        });
    });

    // Color palette buttons
    speakersTbody.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx    = parseInt(btn.dataset.index);
            const group  = btn.closest('.color-input-group');
            activeColorInput   = group.querySelector('.color-text-input');
            activeColorPreview = group.querySelector('.color-preview');

            colorSearch.value = '';
            buildColorGrid();

            const rect = btn.getBoundingClientRect();
            colorPickerPopup.style.top  = (rect.bottom + 4) + 'px';
            const left = Math.max(4, rect.right - 300);
            colorPickerPopup.style.left = left + 'px';
            colorPickerPopup.hidden = false;
            colorSearch.focus();
        });
    });
}

// ---------------------------------------------------------------------------
// Save speakers
// ---------------------------------------------------------------------------
document.getElementById('save-speakers-btn').addEventListener('click', async () => {
    if (!selectedProductionId) return;

    const payload = currentSpeakers.map(s => ({
        scriptName: s.scriptName,
        firstName:  s.firstName,
        lastName:   s.lastName,
        initials:   s.initials,
        color:      s.color,
    }));

    const res = await fetch(`${API_URL}/productions/${selectedProductionId}/speakers`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(payload),
    });

    if (!res.ok) { alert('Failed to save speakers.'); return; }
    alert('Speakers saved.');
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
await validateSession();
await loadProductions();
