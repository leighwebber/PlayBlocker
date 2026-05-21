import { API_URL } from './Constants.js';
import { openFeedbackModal } from './Feedback.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let selectedProductionId = null;
let activeColorInput     = null;
let activeColorPreview   = null;
let currentSpeakers      = [];   // { scriptName, firstName, lastName, initials, color }
let currentRoleId        = null; // 1=Owner, 2=Editor, 3=Viewer, null=AppOwner (unrestricted)
let isAppOwner           = false;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const productionList      = document.getElementById('production-list');
const detailEmpty         = document.getElementById('detail-empty');
const detailContent       = document.getElementById('detail-content');
const productionNameEl    = document.getElementById('production-name');
const textFileInput       = document.getElementById('text-file-input');
const scriptStatus        = document.getElementById('script-status');
const speakersSection     = document.getElementById('speakers-section');
const speakersTbody       = document.getElementById('speakers-tbody');
const scenesSection          = document.getElementById('scenes-section');
const scenesGrid             = document.getElementById('scenes-grid');
const collaboratorsSection   = document.getElementById('collaborators-section');
const collaboratorsList      = document.getElementById('collaborators-list');
const addCollaboratorForm    = document.getElementById('add-collaborator-form');
const collabMsg              = document.getElementById('collab-msg');
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
        isAppOwner = !!data.is_app_owner;
        if (isAppOwner) document.getElementById('username').title = 'App Owner';
    } catch {
        window.location.href = '/index.html';
    }
}

document.getElementById('feedback-btn').addEventListener('click', () => openFeedbackModal());

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

const ROLE_LABELS = { 1: 'Owner', 2: 'Editor', 3: 'Viewer' };

function renderProductionList(productions) {
    productionList.innerHTML = '';
    productions.forEach(p => {
        const li = document.createElement('li');
        li.className = 'production-item';
        li.dataset.id = p.id;
        if (p.id === selectedProductionId) li.classList.add('selected');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        li.appendChild(nameSpan);

        if (isAppOwner && p.owner_email) {
            // AppOwner view: show the owner's email address under the production name
            const ownerSpan = document.createElement('span');
            ownerSpan.className = 'production-owner-email';
            ownerSpan.textContent = p.owner_email;
            li.appendChild(ownerSpan);
        } else if (p.role_id && p.role_id !== 1) {
            // Non-owner: show role badge so the user knows their access level
            const badge = document.createElement('span');
            badge.className = 'role-badge';
            badge.textContent = ROLE_LABELS[p.role_id] || '';
            li.appendChild(badge);
        }

        li.addEventListener('click', () => selectProduction(p.id, p.role_id ?? null));
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
async function selectProduction(id, roleId) {
    selectedProductionId = id;
    currentRoleId = isAppOwner ? null : (roleId ?? 1); // null = unrestricted (AppOwner)

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

    // Gate editing controls based on role
    const canEdit   = isAppOwner || currentRoleId <= 2; // Owner or Editor
    const canDelete = isAppOwner || currentRoleId === 1; // Owner only
    document.getElementById('save-name-btn').hidden        = !canEdit;
    document.getElementById('delete-production-btn').hidden = !canDelete;
    document.getElementById('text-file-input').closest('label').hidden = !canEdit;
    document.getElementById('autofill-speakers-btn').hidden = !canEdit;
    document.getElementById('save-speakers-btn').hidden    = !canEdit;

    // Collaborators section: visible to Owner and AppOwner only
    const canManageRoles = isAppOwner || currentRoleId === 1;
    collaboratorsSection.hidden = !canManageRoles;
    if (canManageRoles) {
        collabMsg.textContent = '';
        await loadCollaborators(id);
    }

    if (production.script_body) {
        scriptStatus.textContent = 'Script loaded.';
        buildSpeakerList(production.script_body, existingSpeakers);
        await loadAndRenderScenes(id);
    } else {
        scriptStatus.textContent = '';
        currentSpeakers = [];
        speakersSection.hidden = true;
        scenesSection.hidden = true;
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
    await syncScenes(selectedProductionId, bodyHtml);
    const speakerRes       = await fetch(`${API_URL}/speakers?productionId=${selectedProductionId}`, { credentials: 'include' });
    const existingSpeakers = speakerRes.ok ? await speakerRes.json() : [];
    buildSpeakerList(bodyHtml, existingSpeakers);
});

// ---------------------------------------------------------------------------
// Scene structure: extract → sync → render
// ---------------------------------------------------------------------------

function extractSceneStructure(scriptHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<html><body>${scriptHtml}</body></html>`, 'text/html');
    const acts = [];
    let currentAct = null;
    let actNumber  = 0;

    for (const p of doc.querySelectorAll('p')) {
        if (p.className === 'Act') {
            actNumber++;
            currentAct = { actNumber, actTitle: p.textContent.trim(), scenes: [] };
            acts.push(currentAct);
        } else if (p.className === 'Scene') {
            if (!currentAct) {
                actNumber++;
                currentAct = { actNumber, actTitle: '', scenes: [] };
                acts.push(currentAct);
            }
            currentAct.scenes.push({
                sceneNumber: currentAct.scenes.length + 1,
                sceneTitle:  p.textContent.trim(),
            });
        }
    }
    return acts;
}

async function syncScenes(productionId, scriptHtml) {
    const acts = extractSceneStructure(scriptHtml);
    if (!acts.length) { scenesSection.hidden = true; return; }
    let savedActs;
    try {
        const res = await fetch(`${API_URL}/productions/${productionId}/scenes`, {
            method:      'POST',
            credentials: 'include',
            headers:     { 'Content-Type': 'application/json' },
            body:        JSON.stringify(acts),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        ({ acts: savedActs } = await res.json());
    } catch (err) {
        console.error('syncScenes failed:', err);
        scriptStatus.textContent = `Scene sync failed (${err.message}) — server may need to be restarted.`;
        return;
    }
    renderSceneGrid(savedActs);
}

async function loadAndRenderScenes(productionId) {
    try {
        const res = await fetch(`${API_URL}/productions/${productionId}/scenes`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const acts = await res.json();
        renderSceneGrid(acts);
    } catch (err) {
        console.error('loadAndRenderScenes failed:', err);
        scenesSection.hidden = true;
    }
}

function renderSceneGrid(acts) {
    scenesGrid.innerHTML = '';
    if (!acts || !acts.length) { scenesSection.hidden = true; return; }

    scenesSection.hidden = false;

    for (const act of acts) {
        const header = document.createElement('div');
        header.className = 'scene-act-header';
        header.textContent = act.actTitle || `Act ${act.actNumber}`;
        scenesGrid.appendChild(header);

        for (const scene of act.scenes) {
            const row = document.createElement('div');
            row.className = 'scene-row';

            const title = document.createElement('span');
            title.className = 'scene-title';
            title.textContent = scene.sceneTitle || `Scene ${scene.sceneNumber}`;
            row.appendChild(title);

            // Thumbnail (shown when an image already exists)
            const thumb = document.createElement('img');
            thumb.className = 'scene-thumb';
            thumb.alt = 'Scene image';
            if (scene.image) {
                thumb.src = scene.image;
            } else {
                thumb.hidden = true;
            }
            row.appendChild(thumb);

            // Upload label/button
            const label = document.createElement('label');
            label.className = 'upload-label';
            label.style.flexShrink = '0';
            label.textContent = scene.image ? 'Replace' : 'Upload';
            const fileInput = document.createElement('input');
            fileInput.type   = 'file';
            fileInput.accept = 'image/*';
            fileInput.hidden = true;
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const dataUrl = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = ev => resolve(ev.target.result);
                    reader.readAsDataURL(file);
                });
                const saveRes = await fetch(`${API_URL}/scenes/${scene.id}/image`, {
                    method:      'PUT',
                    credentials: 'include',
                    headers:     { 'Content-Type': 'application/json' },
                    body:        JSON.stringify({ image: dataUrl }),
                });
                if (!saveRes.ok) { alert('Failed to save scene image.'); return; }
                thumb.src    = dataUrl;
                thumb.hidden = false;
                label.textContent = 'Replace';
                fileInput.value   = '';
            });
            label.appendChild(fileInput);
            row.appendChild(label);

            scenesGrid.appendChild(row);
        }
    }
}

// ---------------------------------------------------------------------------
// Speaker list: parse script → merge with DB → render form
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Speaker autofill
// ---------------------------------------------------------------------------

const AUTOFILL_FIRST_NAMES = [
    'Montgomery', 'Cornelius', 'Reginald', 'Percival', 'Horatio',
    'Thaddeus', 'Archibald', 'Wellington', 'Fitzgerald', 'Barnabas',
    'Evangeline', 'Millicent', 'Prudence', 'Clementine', 'Arabella',
    'Cordelia', 'Lavinia', 'Rosalind', 'Imogen', 'Peregrine',
    'Algernon', 'Septimus', 'Clarence', 'Ferdinand', 'Ignatius',
];

const AUTOFILL_LAST_NAMES = [
    'Crumpet', 'Shufflebottom', 'Bumblington', 'Snodgrass', 'Wigglebottom',
    'Thistlethwaite', 'Pumpernickel', 'Cheesewright', 'Blunderbuss', 'Faversham',
    'Ffortescue', 'Featherstone', 'Witherspoon', 'Mifflington', 'Ponsonby',
    'Boggle', 'Trumpington', 'Dithering', 'Rumbold', 'Cholmondeley',
    'Bottomsworth', 'Wobblethorpe', 'Crankshaw', 'Frogmorton', 'Plunkett',
];

const AUTOFILL_COLORS = [
    'darkred', 'darkblue', 'darkgreen', 'darkmagenta', 'saddlebrown',
    'teal', 'indigo', 'darkgoldenrod', 'darkslategray', 'maroon',
    'midnightblue', 'darkolivegreen', 'darkviolet', 'seagreen', 'crimson',
    'darkcyan', 'chocolate', 'darkslateblue', 'sienna', 'navy',
];

function autofillSpeakers() {
    const usedInitials = new Set(
        currentSpeakers.filter(s => s.initials).map(s => s.initials.toUpperCase())
    );

    function makeInitials(scriptName) {
        const letters = scriptName.replace(/[^A-Za-z]/g, '').toUpperCase();
        const first = letters[0] || 'X';
        // Try first letter paired with each subsequent letter in the script name
        for (let i = 1; i < letters.length; i++) {
            const candidate = first + letters[i];
            if (!usedInitials.has(candidate)) {
                usedInitials.add(candidate);
                return candidate;
            }
        }
        // Fallback: first letter + digit
        for (let n = 2; n <= 9; n++) {
            const candidate = first + n;
            if (!usedInitials.has(candidate)) {
                usedInitials.add(candidate);
                return candidate;
            }
        }
        return first + '?';
    }

    let colorIdx = currentSpeakers.filter(s => s.color).length % AUTOFILL_COLORS.length;

    currentSpeakers.forEach((speaker, i) => {
        if (!speaker.firstName) speaker.firstName = AUTOFILL_FIRST_NAMES[i % AUTOFILL_FIRST_NAMES.length];
        if (!speaker.lastName)  speaker.lastName  = AUTOFILL_LAST_NAMES[i  % AUTOFILL_LAST_NAMES.length];
        if (!speaker.initials)  speaker.initials  = makeInitials(speaker.scriptName);
        if (!speaker.color)   { speaker.color     = AUTOFILL_COLORS[colorIdx % AUTOFILL_COLORS.length]; colorIdx++; }
    });

    renderSpeakerForm();
    document.getElementById('speakers-msg').textContent = 'Fields autofilled — review and adjust before saving.';
}

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
document.getElementById('autofill-speakers-btn').addEventListener('click', autofillSpeakers);

document.getElementById('save-speakers-btn').addEventListener('click', async () => {
    if (!selectedProductionId) return;

    const speakersMsg = document.getElementById('speakers-msg');
    speakersMsg.style.color = '#555';
    speakersMsg.textContent = '';

    // Skip speakers where every editable field is blank
    const toSave = currentSpeakers.filter(s =>
        s.firstName.trim() || s.lastName.trim() || s.initials.trim() || s.color.trim()
    );

    // Block save if any included speaker is missing initials
    const missingInitials = toSave.filter(s => !s.initials.trim()).map(s => s.scriptName);
    if (missingInitials.length) {
        speakersMsg.style.color = '#dc3545';
        speakersMsg.textContent = `Missing initials: ${missingInitials.join(', ')}. Initials are required.`;
        return;
    }

    // Block save if initials are not unique
    const initialsArr = toSave.map(s => s.initials.trim().toUpperCase());
    const duplicates  = initialsArr.filter((v, i) => initialsArr.indexOf(v) !== i);
    if (duplicates.length) {
        speakersMsg.style.color = '#dc3545';
        speakersMsg.textContent = `Duplicate initials: ${[...new Set(duplicates)].join(', ')}. Each speaker needs unique initials.`;
        return;
    }

    const payload = toSave.map(s => ({
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

    if (!res.ok) { speakersMsg.style.color = '#dc3545'; speakersMsg.textContent = 'Failed to save speakers.'; return; }
    speakersMsg.style.color = '#28a745';
    speakersMsg.textContent = `${toSave.length} speaker${toSave.length !== 1 ? 's' : ''} saved.`;
});

// ---------------------------------------------------------------------------
// Collaborators
// ---------------------------------------------------------------------------

const ROLE_BADGE_CLASS = { 1: 'owner', 2: 'editor', 3: 'viewer' };

async function loadCollaborators(productionId) {
    const res = await fetch(`${API_URL}/productions/${productionId}/roles`, { credentials: 'include' });
    if (!res.ok) return;
    renderCollaborators(await res.json());
}

function renderCollaborators(collaborators) {
    collaboratorsList.innerHTML = '';
    if (collaborators.length === 0) {
        collaboratorsList.innerHTML = '<p style="font-size:13px;color:#999;">No collaborators yet.</p>';
        return;
    }
    collaborators.forEach(c => {
        const row = document.createElement('div');
        row.className = 'collab-row';

        const badgeClass = ROLE_BADGE_CLASS[c.role_id] || 'viewer';
        const canRevoke  = c.role_id !== 1 && (isAppOwner || currentRoleId === 1);

        row.innerHTML = `
            <span class="collab-name">${escHtml([c.first_name, c.last_name].filter(Boolean).join(' '))}</span>
            <span class="collab-email">${escHtml(c.email)}</span>
            <span class="collab-role-badge ${badgeClass}">${escHtml(c.role_name)}</span>
            ${canRevoke ? `<button class="link-btn danger" style="padding:3px 10px;font-size:12px;" data-user-id="${c.user_id}">Revoke</button>` : ''}
        `;
        collaboratorsList.appendChild(row);
    });

    // Wire revoke buttons
    collaboratorsList.querySelectorAll('[data-user-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Revoke this user\'s access to the production?')) return;
            const userId = btn.dataset.userId;
            const res = await fetch(`${API_URL}/productions/${selectedProductionId}/roles/${userId}`, {
                method: 'DELETE', credentials: 'include',
            });
            if (!res.ok) { setCollabMsg('Failed to revoke access.', false); return; }
            await loadCollaborators(selectedProductionId);
            setCollabMsg('Access revoked.', true);
        });
    });
}

function setCollabMsg(text, success) {
    collabMsg.textContent  = text;
    collabMsg.style.color  = success ? '#28a745' : '#dc3545';
}

addCollaboratorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setCollabMsg('', true);
    const email   = document.getElementById('collab-email').value.trim();
    const role_id = parseInt(document.getElementById('collab-role').value);
    if (!email || !selectedProductionId) return;

    const res = await fetch(`${API_URL}/productions/${selectedProductionId}/roles`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email, role_id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setCollabMsg(body.error || 'Failed to add collaborator.', false); return; }

    document.getElementById('collab-email').value = '';
    await loadCollaborators(selectedProductionId);
    setCollabMsg(`${email} added.`, true);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
await validateSession();
await loadProductions();
