"use strict";

/**
 * PlayBlocker.js — Front-end controller for the PlayBlocker stage-blocking tool
 *
 * This module owns:
 *  - Page initialisation (DOMContentLoaded)
 *  - Auth forms (register / login / logout)
 *  - Script file loading and iframe management
 *  - Speaker icon setup and drag-and-drop via Interact.js
 *  - Movement annotation workflow (right-click → drag → drop)
 *  - Window resize handling (repositioning icons proportionally)
 *  - Keyboard navigation (arrows, page up/down, Escape)
 *  - Slider-based page navigation
 */

import {
    DataStore, Speaker, speakers, Movement,
    createTextElement,
    createSvgElement, createSpeakerDiv,
    createMovementMarkerDiv,
    MovementList, getMovementListLog,
    createRP,
    speakerObjFromSpeakerDiv,
    redrawChain,
} from "../Modules/Backend.js";

import {
    getCurrentPageNumber, getPageNumberAtMovement,
    getClickedCharacterPosition, getTotalPageCount,
    goToPage
} from "../Modules/ScriptText.js";

import {
    createCircleElement
} from "../Modules/Icons.js";

import {
    fetchSpeakers,
    saveSpeakers,
    saveMovement,
    fetchMovements,
    fetchProduction,
    updateMovement,
    deleteMovement,
} from "../Modules/Database.js";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** True while an Interact.js drag is actively in progress. */
let isDragging = false;

/** True when the script or cursor has changed since the last save. */
let isDirty = false;

/** Sequential counter for movement-marker element ids. */
let markerCount = 0;

/** Initials of the most recently dragged speaker — used to reset its z-index. */
let lastMovedSpeakerInitials = null;

/** Bounding rect of the speaker panel — cached on init and updated on resize. */
let speakerAreaRect   = null;

/** Div element that wraps the stage image (the drop zone). */
let imageAreaDiv      = null;

/** The stage image element. */
let stageImageElement = null;

/** True when the most recent drag was dropped inside the image area. */
let wasDroppedInImageArea = false;

/** Bounding rect of the stage image — cached and updated on resize. */
let stageImageRect = null;

/** Maps span id (e.g. "m-3") → speakerPositions snapshot for click-to-restore. */
const movementPositions = new Map();

/** Maps span id → { paraIndex, textOffset, moverInitials } for span reconstruction on load. */
const movementAnchorData = new Map();

/** Full movement data for editing: spanId → { dbId, moverInitials, shadowRP, endRP, waypoints, speakerPositions } */
const completedMovements = new Map();

/** True while the user is in movement-edit mode. */
let inEditMode = false;

/**
 * Active edit session state, null when not editing.
 * @type {{ spanId, dbId, speakerInitials, originalShadowRP, originalEndRP, originalWaypoints,
 *          currentShadowRP, currentEndRP, currentWaypoints,
 *          shadowDiv, markerDivs, shadowMoved, endMoved } | null}
 */
let editState = null;

/** DOM elements created for the mousedown path-peek; cleared on mouseup. */
let peekElements = [];

/** setTimeout handle for the arrow-key movement-peek; null when inactive. */
let peekTimeoutHandle = null;

/** Capture-phase keydown listener installed during an arrow-key peek; null when inactive. */
let peekCancelListener = null;

/** The speaker panel container element. */
let speakerAreaElement = null;

/** Total number of pages in the loaded script. */
let pageCount = 0;

/** True once a script file has been successfully loaded into the iframe. */
let scriptLoaded = false;

/** The page-navigation slider element. */
let slider = null;

/** The element that displays the current page number alongside the slider. */
let output = null;

// Stage image dimensions — "old" = before a resize, "new" = after
let imgLeftOld = 0, imgTopOld  = 0, imgWidthOld = 0, imgHeightOld = 0;
let imgLeftNew = 0, imgTopNew  = 0, imgWidthNew = 0, imgHeightNew = 0;

/** The script-display iframe element. */
let myIframe = null;

/** Last known iframe scroll position — used to detect scroll direction. */
let lastScrollY = 0;

/** Timer handle for the scroll-idle debounce. */
let scrollIdleTimer = null;

/** True while the user is dragging the page-navigation slider thumb. */
let sliderDragging = false;

/** Central state store for the session. */
let dataStore = null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = "https://lwebber.ca/api";

window.addEventListener("beforeunload", (e) => {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = ""; // required for Chrome to show the dialog
});

// ---------------------------------------------------------------------------
// Auth forms — Register / Login / Logout
// ---------------------------------------------------------------------------

// Only attach handlers when the relevant form elements exist on the page
// (they live on the login page, not the main PlayBlocker page).

if (document.getElementById("registerForm")) {
    /**
     * Submits the registration form to the API.
     * On success, alerts the user to proceed to login.
     */
    document.getElementById("registerForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        const response = await fetch(`${API_URL}/register`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(data)
        });

        if (response.ok) {
            alert("Registration successful! You can now log in.");
        } else {
            alert(`Registration failed: ${response.status}`);
        }
    });
}

/**
 * Logs the current user out by calling the API and alerts on success.
 * Exposed on `window` so it can be called from inline HTML event attributes.
 */
window.logout = async function logout() {
    const response = await fetch(`${API_URL}/logout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" }
    });
    if (response.ok) alert("Logout successful");
};

if (document.getElementById("loginForm")) {
    /**
     * Submits the login form to the API.
     * On success, reveals the protected content area; on failure, alerts the user.
     */
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));

        try {
            const response = await fetch(`${API_URL}/login`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(data)
            });

            if (!response.ok) {
                alert(`Login failed: ${response.status}`);
                return;
            }

            const result = await response.json();
            console.log("Login response:", result);
            document.getElementById("protected-area").style.display = "block";
        } catch (error) {
            alert("Login failed — check your connection and try again.");
        }
    });
}

// ---------------------------------------------------------------------------
// PlayBlocker page initialisation
// ---------------------------------------------------------------------------

/**
 * Sets up all elements, event listeners, and Interact.js drop zones on the
 * PlayBlocker page.  Called by the DOMContentLoaded handler below when the
 * page body id is "playBlockerPage".
 */
async function playBlockerPageSetup() {
    // Create the central state store, referencing the script iframe
    myIframe  = document.getElementById("script-iframe");
    dataStore = new DataStore(myIframe);

    dataStore.productionId = parseInt(new URLSearchParams(window.location.search).get("productionId"), 10) || 1;

    // Speaker panel height (needed for column-wrap in createSpeakerDiv)
    speakerAreaElement = document.getElementById("image-area");
    dataStore.speakerAreaHeight = speakerAreaElement.getBoundingClientRect().height;
    speakerAreaRect = speakerAreaElement.getBoundingClientRect();

    // Stage image geometry — cached for proportional repositioning on resize
    stageImageElement = document.getElementById("stage-image");
    stageImageRect    = stageImageElement.getBoundingClientRect();
    imgLeftOld   = stageImageRect.left;
    imgTopOld    = stageImageRect.top;
    imgWidthOld  = stageImageRect.width;
    imgHeightOld = stageImageRect.height;

    imageAreaDiv = document.getElementById("image-area");

    // Page-navigation slider
    slider = document.getElementById("myRange");
    output = document.getElementById("demo");
    output.innerHTML = slider.value;

    slider.addEventListener("pointerdown", () => { sliderDragging = true;  });
    slider.addEventListener("change",      () => { sliderDragging = false; });
    slider.addEventListener("change", sliderOnChange);
    slider.oninput = function () {
        output.innerHTML = this.value;
        slider.blur();
    };

    document.getElementById("saveScript").addEventListener("click", saveProductionState);

    setHelpBar("Left-click in the script to move the cursor · Right-click a Speech to start a movement · Hold a speaker icon to preview their path");

    // Context menu for speaker/edit artifacts
    const menuEl = document.createElement("div");
    menuEl.id        = "pb-context-menu";
    menuEl.className = "pb-context-menu";
    document.body.appendChild(menuEl);
    document.addEventListener("click", () => hideContextMenu());

    // Confirmation modal
    const confirmOverlay = document.createElement("div");
    confirmOverlay.id        = "pb-confirm-overlay";
    confirmOverlay.className = "pb-confirm-overlay";
    confirmOverlay.innerHTML = `
        <div class="pb-confirm-box">
            <p class="pb-confirm-msg" id="pb-confirm-msg"></p>
            <div class="pb-confirm-buttons">
                <button class="pb-confirm-btn" id="pb-confirm-cancel">Cancel</button>
                <button class="pb-confirm-btn" id="pb-confirm-ok">OK</button>
            </div>
        </div>`;
    document.body.appendChild(confirmOverlay);

    speakerAreaElement.addEventListener("contextmenu", onSpeakerAreaContextMenu);
    speakerAreaElement.addEventListener("mousedown",   onSpeakerDivMouseDown);
    document.addEventListener("mouseup", hideMovementPeek);

    // Block all interaction outside edit artifacts while in edit mode
    ["pointerdown", "click", "contextmenu"].forEach(type =>
        document.addEventListener(type, blockOutsideEditArtifacts, true)
    );

    // Populate speaker icons in the speaker panel
    await insertSpeakers(speakerAreaElement);

    // Keyboard navigation
    window.addEventListener("keydown", handleKeyDown);

    // Window resize — reposition icons proportionally
    window.addEventListener("resize", onResize);

    // Suppress the browser context menu inside the iframe; show ours instead
    myIframe.contentWindow.addEventListener("contextmenu", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Right-clicking a movement marker span opens Delete / Cancel options
        const markerSpan = event.target.closest("span.m-normal");
        if (markerSpan) {
            if (inEditMode || dataStore.newMovement || dataStore.incompleteMovement) return;
            const iframeRect = myIframe.getBoundingClientRect();
            showContextMenu(event.clientX + iframeRect.left, event.clientY + iframeRect.top, [
                { label: "Delete movement", action: () => deleteMovementAtSpan(markerSpan.id) },
                { label: "Cancel", action: () => {
                    // Move cursor to just after the marker span and restore speaker positions
                    const iframeDoc = myIframe.contentDocument;
                    const span = iframeDoc.getElementById(markerSpan.id);
                    if (!span) return;
                    const range = iframeDoc.createRange();
                    range.setStartAfter(span);
                    range.collapse(true);
                    const { targetPositions } = findTargetPositions(iframeDoc, range);
                    commitCursorMove(iframeDoc, range, targetPositions);
                }},
            ]);
            return;
        }

        if (!event.target.classList.contains("Speech") && !event.target.classList.contains("StageDirection")) {
            alert("You can only create a movement inside the text of a Speech or a StageDirection");
            return;
        }

        // Treat this like a left-click first: snap cursor and ask about speaker repositioning
        const iframeDoc  = myIframe.contentDocument;
        const caretRange = iframeDoc.caretRangeFromPoint(event.clientX, event.clientY);
        if (!caretRange) return;

        snapCursorRange(caretRange);

        // Compute paragraph offset BEFORE any DOM changes
        const paragraphOffset = computeOffsetFromRange(caretRange);

        const { targetPositions, targetSpanId } = findTargetPositions(iframeDoc, caretRange);

        if (targetPositions && targetSpanId !== currentEffectiveSpanId(iframeDoc)) {
            const ok = await showConfirm("Speakers will be shown as they were at this point in the script.");
            if (!ok) return;
        }

        commitCursorMove(iframeDoc, caretRange, targetPositions);
        startMovement(event, paragraphOffset);
    });

    // Change cursor when the pointer leaves the iframe during a pending movement
    myIframe.addEventListener("mouseleave", () => {
        document.body.style.cursor = dataStore.newMovement ? "not-allowed" : "default";
    });

    // Update the page slider when the user scrolls the script
    myIframe.contentWindow.addEventListener("scroll", iFrameOnScroll);

    // Register click handler for the script iframe (used for logging click positions)
    attachIFrameListeners();

    // Get-page-number button (diagnostic, currently unused in production UI)
    document.getElementById("get-page-number").addEventListener("click", () => {
        const currentPage = getCurrentPageNumber(myIframe);
        const totalPages  = getTotalPageCount(myIframe);
        console.log(`Current page: ${currentPage} / ${totalPages}`);
    });

    // Auto-load stage image and script from the selected production
    await loadProductionData();

    console.log("PlayBlocker page loaded.");
}

// ---------------------------------------------------------------------------
// Production auto-load
// ---------------------------------------------------------------------------

/**
 * Resolves when the iframe's initial page has fully loaded.
 * If it's already ready, resolves immediately.
 */
function waitForIframe() {
    return new Promise(resolve => {
        if (myIframe.contentDocument?.readyState === "complete") {
            resolve();
        } else {
            myIframe.addEventListener("load", resolve, { once: true });
        }
    });
}

/**
 * Fetches the current production's stage image and script body from the API
 * and loads them into the page, exactly as if the user had uploaded both files.
 */
async function loadProductionData() {
    let production;
    try {
        production = await fetchProduction(dataStore.productionId);
    } catch (err) {
        console.warn("loadProductionData: could not fetch production —", err);
        return;
    }

    // ---- Stage image ----
    if (production.stage_image) {
        await new Promise(resolve => {
            stageImageElement.onload = () => {
                // Recapture geometry with the new image's rendered dimensions
                stageImageRect  = stageImageElement.getBoundingClientRect();
                imgLeftOld  = stageImageRect.left;
                imgTopOld   = stageImageRect.top;
                imgWidthOld = stageImageRect.width;
                imgHeightOld = stageImageRect.height;
                resolve();
            };
            stageImageElement.src = production.stage_image;
        });
    }

    // ---- Script ----
    if (production.script_body) {
        await waitForIframe();
        myIframe.contentDocument.body.innerHTML = production.script_body;

        // Fetch DB movements first so validateScriptConsistency can cross-check.
        await loadMovementPositions();
        const repaired = validateScriptConsistency(myIframe.contentDocument);

        // Advance movementList past the highest validated span ID so new movements
        // always get a never-before-seen id (see comment in earlier commit).
        // Sentinels are safe because every forEach loop guards with !movement.speakerDiv.
        const sentinel = { shadowDiv: null, shadowRP: null, speakerDiv: null };
        let maxMovementId = 0;
        myIframe.contentDocument.querySelectorAll("span.m-normal").forEach(span => {
            const n = parseInt(span.id.replace("m-", ""), 10);
            if (!isNaN(n) && n > maxMovementId) maxMovementId = n;
        });
        while (dataStore.movementList.count() < maxMovementId) {
            dataStore.movementList.add(dataStore.movementList.count(), sentinel);
        }

        attachIFrameListeners();
        restoreAtCursor();

        const startingPage = getCurrentPageNumber(myIframe);
        pageCount          = getTotalPageCount(myIframe);
        dataStore.movementList.pageCount = pageCount;
        dataStore.movementList.startPage = startingPage;
        slider.value     = startingPage;
        output.innerHTML = slider.value;

        document.getElementById("saveScript").style.visibility    = "visible";
        document.getElementById("slidecontainer").style.visibility = "visible";
        scriptLoaded = true;
        isDirty = repaired; // prompt save if validation had to clean anything up
    }
}

// ---------------------------------------------------------------------------
// Script consistency validation
// ---------------------------------------------------------------------------

/**
 * Counts non-m-span text characters before the span with the given id within
 * a paragraph element.  The result is stable: adding or removing m-spans does
 * not change the raw count of surrounding plain text.
 *
 * @param {HTMLElement} paraElement - The containing paragraph
 * @param {string}      spanId      - The id of the target span (e.g. "m-3")
 * @returns {number}                - Raw text offset before the span
 */
function computeRawOffset(paraElement, spanId) {
    let raw   = 0;
    let found = false;

    function walk(node) {
        if (found) return;
        if (node.nodeType === Node.TEXT_NODE) {
            raw += node.length;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.id === spanId) {
                found = true;
            } else if (node.classList.contains("m-normal") || node.classList.contains("m-new")) {
                // Skip m-span text — it does not contribute to raw offset
            } else {
                for (const child of node.childNodes) {
                    walk(child);
                    if (found) break;
                }
            }
        }
    }

    for (const child of paraElement.childNodes) {
        walk(child);
        if (found) break;
    }

    return raw;
}

/**
 * Inserts `span` into `paraElement` at the position described by `rawOffset`
 * (a count of non-m-span text characters from the start of the paragraph).
 *
 * @param {Document}    iframeDoc
 * @param {HTMLElement} paraElement
 * @param {number}      rawOffset
 * @param {HTMLElement} span
 */
function insertSpanAtRawOffset(iframeDoc, paraElement, rawOffset, span) {
    let remaining = rawOffset;
    let inserted  = false;

    function walk(node) {
        if (inserted) return;
        if (node.nodeType === Node.TEXT_NODE) {
            if (remaining <= node.length) {
                const range = iframeDoc.createRange();
                range.setStart(node, remaining);
                range.collapse(true);
                range.insertNode(span);
                inserted = true;
            } else {
                remaining -= node.length;
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList.contains("m-normal") || node.classList.contains("m-new")) {
                // Skip — m-spans don't contribute to raw offset
            } else {
                for (const child of Array.from(node.childNodes)) {
                    walk(child);
                    if (inserted) break;
                }
            }
        }
    }

    for (const child of Array.from(paraElement.childNodes)) {
        walk(child);
        if (inserted) break;
    }

    if (!inserted) {
        // rawOffset exceeds paragraph text length — append at end
        const range = iframeDoc.createRange();
        range.selectNodeContents(paraElement);
        range.collapse(false);
        range.insertNode(span);
    }
}

/**
 * Cross-checks the iframe DOM against the movementPositions Map (populated
 * from the DB) and repairs any inconsistencies found.
 *
 * Rules:
 *  - span.m-new  ("?") → always remove; these are from interrupted movements.
 *  - span.m-normal with no DB record → remove; script drifted ahead of the DB.
 *  - DB record with no span → reconstruct using stored para_index + text_offset anchor data.
 *
 * @param {Document} iframeDoc
 * @returns {boolean} true if any repairs were made (caller should set isDirty)
 */
function validateScriptConsistency(iframeDoc) {
    let repaired = false;

    // Remove stray [?] spans left by interrupted movements
    iframeDoc.querySelectorAll("span.m-new").forEach(span => {
        const parent = span.parentNode;
        span.remove();
        parent?.normalize();
        repaired = true;
        console.warn("validateScriptConsistency: removed stale [?] span.");
    });

    // Remove m-normal spans that have no corresponding DB record
    iframeDoc.querySelectorAll("span.m-normal").forEach(span => {
        if (!movementPositions.has(span.id)) {
            const parent = span.parentNode;
            span.remove();
            parent?.normalize();
            repaired = true;
            console.warn(`validateScriptConsistency: removed orphan span ${span.id} — no DB record.`);
        }
    });

    // Reconstruct DB records whose spans are missing from the script
    movementPositions.forEach((_, spanId) => {
        if (iframeDoc.getElementById(spanId)) return;

        const anchor = movementAnchorData.get(spanId);
        if (!anchor || anchor.paraIndex == null || anchor.textOffset == null) {
            console.warn(`validateScriptConsistency: DB movement ${spanId} has no span and no anchor data — cannot reconstruct.`);
            return;
        }

        const allParas = iframeDoc.querySelectorAll("p");
        const para = allParas[anchor.paraIndex];
        if (!para) {
            console.warn(`validateScriptConsistency: DB movement ${spanId} — paragraph at index ${anchor.paraIndex} not found.`);
            return;
        }

        const span = iframeDoc.createElement("span");
        span.id          = spanId;
        span.className   = "m-normal";
        span.textContent = `[${anchor.moverInitials ?? "?"}]`;
        insertSpanAtRawOffset(iframeDoc, para, anchor.textOffset, span);
        repaired = true;
        console.log(`validateScriptConsistency: reconstructed missing span ${spanId} at para ${anchor.paraIndex}, rawOffset ${anchor.textOffset}.`);
    });

    return repaired;
}

// ---------------------------------------------------------------------------
// Save production state
// ---------------------------------------------------------------------------

/**
 * Saves the current annotated script (including movement spans and the cursor
 * marker) back to production.script_body so the session can be fully restored
 * on the next load.
 */
async function saveProductionState() {
    const scriptBody = myIframe.contentDocument.body.innerHTML;
    const response   = await fetch(`${API_URL}/productions/${dataStore.productionId}/script`, {
        method:      "PUT",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ scriptBody }),
    });
    if (response.ok) isDirty = false;
    showMessage(response.ok ? "Saved." : "Save failed.", response.ok ? "success" : "error");
}

// ---------------------------------------------------------------------------
// Cursor-based restore
// ---------------------------------------------------------------------------

/**
 * Scrolls the iframe to the saved cursor marker, then repositions all
 * speaker divs to the snapshot recorded at the nearest preceding movement.
 * Called automatically when a production is loaded.
 */
function restoreAtCursor() {
    const iframeDoc = myIframe.contentDocument;
    const cursor    = iframeDoc.getElementById("script-cursor");
    if (!cursor) return;

    cursor.scrollIntoView({ behavior: "instant", block: "center" });

    const cursorRange = iframeDoc.createRange();
    cursorRange.selectNode(cursor);

    const { targetPositions } = findTargetPositions(iframeDoc, cursorRange);

    speakerAreaElement.querySelectorAll('[id^="shadow-div-"], .movement-marker').forEach(el => el.remove());

    if (!targetPositions) return;

    // On a fresh load no speaker has been dragged yet, so onImage is false and
    // restoreSpeakerPositions would skip everyone.  Mark each speaker in the
    // snapshot as onImage before calling it.
    targetPositions.forEach(({ initials }) => {
        const speaker = speakers.find(s => s.speakerInitials === initials);
        if (speaker) speaker.onImage = true;
    });
    restoreSpeakerPositions(targetPositions);
}

// ---------------------------------------------------------------------------
// Speaker panel population
// ---------------------------------------------------------------------------

/**
 * Fetches speaker data from the server and populates the speaker panel.
 * Falls back to a hard-coded cast list if the API is unavailable or returns
 * no rows, so the app remains usable during development.
 *
 * Each server row is expected to have: { id, name, initials, color, rpX, rpY }
 * rpX/rpY are null until the speaker has been placed on the stage image.
 *
 * @param {HTMLElement} speakerContainer - The speaker panel div
 */
async function insertSpeakers(speakerContainer) {
    // Hard-coded fallback cast for "And Then There Were None"
    const fallbackCast = [
        ["Philip", "Lombard",    "LO", "green"],
        ["Anthony", "Marston",    "MA", "blue"],
        ["Vera", "Claythorne", "CL", "pink"],
        ["Lawrence", "Wargrave",   "WA", "orange"],
        ["Henry", "Blore",      "BL", "purple"],
        ["Arthur", "McKenzie",   "MK", "cyan"],
        ["Margaret", "Armstrong",  "AR", "yellow"],
        ["Ben", "Rogers",     "RO", "brown"],
        ["Ethel", "Rogers", "RS", "lightgray"],
        ["James", "Narracot",   "NA", "black"],
        ["Emily", "Brent",      "BR", "violet"],
    ];

    // Try to load speakers from the server; fall back to the static list on any error
    let serverRows = [];
    try {
        serverRows = await fetchSpeakers(dataStore.productionId);
    } catch (err) {
        console.warn("fetchSpeakers failed — using hard-coded fallback cast.", err);
    }

    const castData = serverRows.length > 0
        ? serverRows.map((r) => [r.firstName, r.lastName, r.initials, r.color, r.id, r.rpX, r.rpY])
        : fallbackCast.map((r) => [...r, null, null, null]);  // id, rpX, rpY all null

    castData.forEach(([firstName, lastName, initials, color, dbId]) => {
        speakers.push(Speaker.create(firstName, lastName, initials, color));
        speakers[speakers.length - 1].dbId = dbId;
    });

    // Layout parameters for the main icon column
    const divParams    = { currentX: 0,  currentY: 0, yIncrement: 30, bottomOfColumnY: 0, topOfColumnY: 0 };
    // Layout parameters for the shadow (origin-marker) column — offset 70 px to the right
    const shadowParams = { currentX: 70, currentY: 0, yIncrement: 30, bottomOfColumnY: 0, topOfColumnY: 0 };

    const container = document.getElementById("image-area");

    castData.forEach(([firstName, lastName, initials, color, dbId, rpX, rpY], i) => {
        const speaker = speakers[i];

        // Restore stage position if the server returned one
        if (rpX != null && rpY != null) {
            speaker.RP = createRP(rpX, rpY);
        }

        // Create the draggable icon
        const speakerDiv = createSpeakerDiv(dataStore, speaker, divParams, false);
        speaker.speakerDiv = speakerDiv;

        // Create the ghost/shadow icon (shown as the origin during a drag)
        const shadowDiv = createSpeakerDiv(dataStore, speaker, shadowParams, true);
        speaker.shadowDiv = shadowDiv;

        divParams.currentY += divParams.yIncrement;

        container.appendChild(speakerDiv);

        // Record the icon's starting position so it can be reset after a cancelled drag
        speaker.originalX = speakerDiv.getAttribute("data-x");
        speaker.originalY = speakerDiv.getAttribute("data-y");
    });
}

// ---------------------------------------------------------------------------
// Log display (development helper)
// ---------------------------------------------------------------------------

/**
 * Reveals the log panel and populates it with the current movement list log.
 * Currently called via the "Show Log" button (if present in the HTML).
 */
export function showLog() {
    const logContainer = document.getElementById("log-container");
    const logContent   = document.getElementById("log-content");
    logContent.textContent = getMovementListLog("showLog", dataStore);
    logContainer.style.display = "block";
}

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------

/**
 * Responds to window resize events by recalculating the stage image geometry,
 * repositioning all speaker icons proportionally, and redrawing all connector
 * lines so they follow their repositioned waypoints.
 */
function onResize() {
    // Ignore the synthetic resize that fires when the window first opens
    if (dataStore.speakerAreaHeight == null) return;

    dataStore.speakerAreaHeight = document.getElementById("image-area").getBoundingClientRect().height;

    stageImageElement = document.getElementById("stage-image");
    stageImageRect    = stageImageElement.getBoundingClientRect();
    imgLeftNew   = stageImageRect.left;
    imgTopNew    = stageImageRect.top;
    imgWidthNew  = stageImageRect.width;
    imgHeightNew = stageImageRect.height;

    repositionSpeakers(
        imgLeftOld, imgLeftNew,
        imgTopOld,  imgTopNew,
        imgWidthOld, imgWidthNew,
        imgHeightOld, imgHeightNew
    );

    // Reposition markers and redraw all connector chains now that speaker
    // positions have been updated.
    redrawMovementLines(
        imgLeftOld, imgLeftNew,
        imgTopOld,  imgTopNew,
        imgWidthOld, imgWidthNew,
        imgHeightOld, imgHeightNew
    );

    // Update "old" values for the next resize
    imgLeftOld   = imgLeftNew;
    imgTopOld    = imgTopNew;
    imgWidthOld  = imgWidthNew;
    imgHeightOld = imgHeightNew;
}

/**
 * Repositions all speaker icons after a window resize so they remain at their
 * correct proportional location on the stage image.
 *
 * The stage image uses CSS `object-fit: contain`, so when the window resizes both
 * the image's size and its offset within its container can change.  We track both
 * via the six "old" and "new" parameters.
 *
 * @param {number} imgLeftOld   - Image left edge before resize
 * @param {number} imgLeftNew   - Image left edge after resize
 * @param {number} imgTopOld    - Image top edge before resize
 * @param {number} imgTopNew    - Image top edge after resize
 * @param {number} imgWidthOld  - Image width before resize
 * @param {number} imgWidthNew  - Image width after resize
 * @param {number} imgHeightOld - Image height before resize
 * @param {number} imgHeightNew - Image height after resize
 */
function repositionSpeakers(
    imgLeftOld, imgLeftNew, imgTopOld, imgTopNew,
    imgWidthOld, imgWidthNew, imgHeightOld, imgHeightNew
) {
    const speakerDivs = document.querySelectorAll(".speaker");
    const deltaLeft   = imgLeftNew - imgLeftOld;
    const deltaTop    = imgTopNew  - imgTopOld;

    speakerDivs.forEach((speakerDiv) => {
        // Shadow divs share the .speaker class but must not be processed here —
        // they are repositioned below using their own shadowRP.
        // Processing them here would apply the delta a second time (acceleration bug).
        if (speakerDiv.id.startsWith("shadow-div-")) return;

        const speakerObj = speakerObjFromSpeakerDiv(speakerDiv);

        if (!speakerObj.RP) return;
        // If the speaker has not yet been placed on the image, don't reposition it.
        if (!speakerObj.onImage) return;

        const oldPixelX = speakerObj.RP.rX * imgWidthOld;
        const oldPixelY = speakerObj.RP.rY * imgHeightOld;
        const newPixelX = speakerObj.RP.rX * imgWidthNew + deltaLeft;
        const newPixelY = speakerObj.RP.rY * imgHeightNew + deltaTop;

        // Reposition the speakerDiv
        const oldFactors = parseTransform(speakerDiv.style.transform);
        const newX = parseFloat(oldFactors.x) + (newPixelX - oldPixelX);
        const newY = parseFloat(oldFactors.y) + (newPixelY - oldPixelY);
        speakerDiv.style.transform = speakerDiv.style.transform
            .replace(oldFactors.x, `${newX}px`)
            .replace(oldFactors.y, `${newY}px`);
        speakerDiv.setAttribute("data-x", newX);
        speakerDiv.setAttribute("data-y", newY);

        // Reposition the shadowDiv if it's been placed on stage.
        // The shadow marks the movement's *start* point, which may differ from
        // the speaker's final drop position, so we use the movement's shadowRP
        // rather than speakerObj.RP.
        const shadowDiv = speakerObj.shadowDiv;
        if (shadowDiv && shadowDiv.isConnected && shadowDiv.parentElement === speakerAreaElement) {
            // Find the movement that owns this shadow so we can read its shadowRP
            let shadowRP = null;
            dataStore.movementList.forEach((movement) => {
                if (movement.shadowDiv === shadowDiv && movement.shadowRP) {
                    shadowRP = movement.shadowRP;
                }
            });

            if (shadowRP) {
                const oldShadowPixelX = shadowRP.rX * imgWidthOld;
                const oldShadowPixelY = shadowRP.rY * imgHeightOld;
                const newShadowPixelX = shadowRP.rX * imgWidthNew + deltaLeft;
                const newShadowPixelY = shadowRP.rY * imgHeightNew + deltaTop;

                const shadowFactors = parseTransform(shadowDiv.style.transform);
                const shadowX = parseFloat(shadowFactors.x) + (newShadowPixelX - oldShadowPixelX);
                const shadowY = parseFloat(shadowFactors.y) + (newShadowPixelY - oldShadowPixelY);
                shadowDiv.style.transform = shadowDiv.style.transform
                    .replace(shadowFactors.x, `${shadowX}px`)
                    .replace(shadowFactors.y, `${shadowY}px`);
                shadowDiv.setAttribute("data-x", shadowX);
                shadowDiv.setAttribute("data-y", shadowY);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// CSS transform parser
// ---------------------------------------------------------------------------

/**
 * Extracts the x and y values from a CSS `translate(Xpx, Ypx)` transform string.
 * Returns { x: "0px", y: "0px" } if no translate is found.
 *
 * @param {string} transform - CSS transform string, e.g. "translate(100px, 200px)"
 * @returns {{ x: string, y: string }}
 */
function parseTransform(transform) {
    const match = transform.match(/translate\(\s*([^\s,]+)\s*,\s*([^\s,]+)\s*\)/);
    if (match) return { x: match[1], y: match[2] };
    return { x: "0px", y: "0px" };
}

// ---------------------------------------------------------------------------
// Movement-line resize handler
// ---------------------------------------------------------------------------

/**
 * Repositions movement markers and redraws every connector chain after a resize.
 *
 * speakerDivs are already repositioned by repositionSpeakers() before this runs.
 * Each marker stores its own proportional position (markerDiv._rp) set at creation
 * time, so it can be repositioned independently of the speaker's drop position.
 *
 * @param {number} imgLeftOld
 * @param {number} imgLeftNew
 * @param {number} imgTopOld
 * @param {number} imgTopNew
 * @param {number} imgWidthOld
 * @param {number} imgWidthNew
 * @param {number} imgHeightOld
 * @param {number} imgHeightNew
 */
function redrawMovementLines(
    imgLeftOld, imgLeftNew, imgTopOld, imgTopNew,
    imgWidthOld, imgWidthNew, imgHeightOld, imgHeightNew
) {
    const deltaLeft = imgLeftNew - imgLeftOld;
    const deltaTop  = imgTopNew  - imgTopOld;

    dataStore.movementList.forEach((movement) => {
        if (!movement.speakerDiv || !movement.shadowDiv) return;

        const speakerRp = movement.speaker?.RP;
        if (speakerRp && movement.movementMarkers.length > 0) {
            movement.movementMarkers.forEach((markerDiv) => {
                // Each marker has its own RP stored at creation time.
                // Fall back to the speaker's RP only if somehow absent.
                const markerRp = markerDiv._rp || speakerRp;
                const oldMarkerPixelX = markerRp.rX * imgWidthOld;
                const oldMarkerPixelY = markerRp.rY * imgHeightOld;
                const newMarkerPixelX = markerRp.rX * imgWidthNew + deltaLeft;
                const newMarkerPixelY = markerRp.rY * imgHeightNew + deltaTop;
                const dx = newMarkerPixelX - oldMarkerPixelX;
                const dy = newMarkerPixelY - oldMarkerPixelY;

                const x = parseFloat(markerDiv.getAttribute("data-x")) + dx;
                const y = parseFloat(markerDiv.getAttribute("data-y")) + dy;
                markerDiv.style.transform = `translate(${x}px, ${y}px)`;
                markerDiv.setAttribute("data-x", x);
                markerDiv.setAttribute("data-y", y);
            });
        }

        movement.redrawAllLines();
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the speaker initials from a speaker or shadow div's id.
 * Id format: "speaker-div-XX" or "shadow-div-XX".
 *
 * @param {HTMLElement} div
 * @returns {string}
 */
function speakerInitialsFromDiv(div) {
    return div.id.split("-").pop();
}

// ---------------------------------------------------------------------------
// Help bar
// ---------------------------------------------------------------------------

/** Updates the state-aware hint bar above the grid with a workflow prompt. */
function setHelpBar(text) {
    const bar = document.getElementById("pb-help-bar");
    if (bar) bar.textContent = text;
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

/**
 * Displays a status message below the file input.
 *
 * @param {string} message - The message text
 * @param {"error"|"success"} type - Determines the text colour
 */
function showMessage(message, type) {
    const messageDisplay = document.getElementById("message");
    messageDisplay.textContent = message;
    messageDisplay.style.color = type === "error" ? "red" : "green";
}

// ---------------------------------------------------------------------------
// Slider-based page navigation
// ---------------------------------------------------------------------------

/**
 * Fires when the slider value is committed (mouseup / touch end).
 * Navigates the iframe to the corresponding page.
 *
 * @param {Event} e
 */
function sliderOnChange(e) {
    const page = Math.round(pageCount * (e.target.value / 100));
    goToPage(myIframe, page);
    dataStore.currentPage = page;
}

/**
 * Fires while the iframe scrolls.
 * Keeps the slider in sync with the currently visible page.
 */
function iFrameOnScroll() {
    const page = getCurrentPageNumber(myIframe);
    if (page !== dataStore.currentPage) {
        slider.value     = 100 * page / pageCount;
        output.innerHTML = slider.value;
        dataStore.currentPage = page;
    }

    const scrollY      = myIframe.contentWindow.scrollY;
    const scrolledDown = scrollY >= lastScrollY;
    lastScrollY        = scrollY;

    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => repositionCursorIfOffScreen(scrolledDown), 250);
}

/**
 * If the blinking cursor has scrolled out of the iframe viewport, silently moves
 * it to a visible position (near the bottom when scrolling forward, near the top
 * when scrolling backward) and repositions the speakers to match — no confirmation
 * dialog is shown.
 */
function repositionCursorIfOffScreen(scrolledDown) {
    if (dataStore.newMovement || dataStore.incompleteMovement || inEditMode || sliderDragging) return;

    const iframeDoc    = myIframe.contentDocument;
    const iframeWindow = myIframe.contentWindow;
    const cursor       = iframeDoc.getElementById("script-cursor");
    if (!cursor) return;

    // getBoundingClientRect on an element inside an iframe returns coords relative
    // to that iframe's own viewport, which is exactly what we want here.
    const rect       = cursor.getBoundingClientRect();
    const viewHeight = iframeWindow.innerHeight;
    if (rect.bottom > 0 && rect.top < viewHeight) return; // still visible

    const MARGIN    = 60;
    const targetY   = scrolledDown ? viewHeight - MARGIN : MARGIN;
    const viewWidth = iframeWindow.innerWidth;

    // Scan from targetY inward (toward the centre of the viewport) until we
    // land on a text node.  Try several x positions at each y step.
    const step = scrolledDown ? -8 : 8;
    let caretRange = null;
    let y = targetY;

    for (let i = 0; i < 25 && !caretRange; i++, y += step) {
        for (const xFrac of [0.4, 0.5, 0.3, 0.6]) {
            const r = iframeDoc.caretRangeFromPoint(viewWidth * xFrac, y);
            if (r?.startContainer?.nodeType === Node.TEXT_NODE &&
                r.startContainer.parentElement?.closest(".Speech, .StageDirection")) {
                caretRange = r;
                break;
            }
        }
    }
    if (!caretRange) {
        // Nothing suitable in the viewport (e.g. a long opening stage direction).
        // Fall back to just after the first movement span so speakers stay meaningful.
        const firstSpan = iframeDoc.querySelector("span.m-normal");
        if (!firstSpan) return; // No movements in the script — leave cursor as-is.

        const fallbackRange = iframeDoc.createRange();
        fallbackRange.setStartAfter(firstSpan);
        fallbackRange.collapse(true);
        const { targetPositions } = findTargetPositions(iframeDoc, fallbackRange);
        commitCursorMove(iframeDoc, fallbackRange, targetPositions);
        return;
    }

    snapCursorRange(caretRange);
    const { targetPositions } = findTargetPositions(iframeDoc, caretRange);
    commitCursorMove(iframeDoc, caretRange, targetPositions);
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

/**
 * Global keydown handler: arrow keys scroll the script, PageUp/PageDown jump
 * between page breaks, Escape cancels an in-progress movement, and Space
 * drops a movement marker at the current drag position.
 *
 * @param {KeyboardEvent} event
 */
function handleKeyDown(event) {
    switch (event.key) {
        case " ":
            // Prevent the page from scrolling on spacebar
            event.preventDefault();
            insertMovementMarker();
            break;
        case "Escape":
            handleEscapeKey();
            break;
        case "Tab":
            event.preventDefault();
            navigateToSpeech(event.shiftKey ? "prev" : "next");
            break;
        case "ArrowLeft":
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) { ctrlArrowLeft(); } else { arrowLeft(); }
            break;
        case "ArrowRight":
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) { ctrlArrowRight(); } else { arrowRight(); }
            break;
        case "ArrowUp":
            myIframe.contentWindow.scrollBy(0, -30);
            break;
        case "ArrowDown":
            myIframe.contentWindow.scrollBy(0, 30);
            break;
        case "PageUp":
            scrollToAdjacentPage("up");
            break;
        case "PageDown":
            scrollToAdjacentPage("down");
            break;
    }
}

/**
 * Moves the cursor to the next or previous Speech paragraph in the script.
 * Tab advances; Shift+Tab retreats.  Speaker positions update as normal.
 *
 * @param {"next"|"prev"} direction
 */
function navigateToSpeech(direction) {
    const iframeDoc  = myIframe.contentDocument;
    const speechParas = Array.from(iframeDoc.querySelectorAll("p.Speech"));
    if (speechParas.length === 0) return;

    const cursor = iframeDoc.getElementById("script-cursor");

    let target = null;

    if (direction === "next") {
        if (!cursor) {
            target = speechParas[0];
        } else {
            const cursorRange = iframeDoc.createRange();
            cursorRange.selectNode(cursor);
            for (const para of speechParas) {
                const paraRange = iframeDoc.createRange();
                paraRange.selectNodeContents(para);
                // Find first Speech whose start is strictly after the cursor
                if (paraRange.compareBoundaryPoints(Range.START_TO_START, cursorRange) > 0) {
                    target = para;
                    break;
                }
            }
        }
    } else {
        if (cursor) {
            const cursorRange = iframeDoc.createRange();
            cursorRange.selectNode(cursor);
            for (const para of [...speechParas].reverse()) {
                const paraRange = iframeDoc.createRange();
                paraRange.selectNodeContents(para);
                // Find last Speech whose end is strictly before the cursor's start
                if (paraRange.compareBoundaryPoints(Range.START_TO_END, cursorRange) < 0) {
                    target = para;
                    break;
                }
            }
        }
    }

    if (!target) return;

    const range = iframeDoc.createRange();
    range.setStart(target, 0);
    range.collapse(true);

    // Skip past any consecutive movement marker spans at the start of the paragraph
    // so the cursor lands in editable text rather than immediately beside a marker.
    let child = target.firstChild;
    while (child?.nodeType === Node.ELEMENT_NODE && child.classList.contains("m-normal")) {
        range.setStartAfter(child);
        range.collapse(true);
        child = child.nextSibling;
    }

    target.scrollIntoView({ behavior: "smooth", block: "center" });

    const { targetPositions } = findTargetPositions(iframeDoc, range);
    commitCursorMove(iframeDoc, range, targetPositions);
}

// ---------------------------------------------------------------------------
// Arrow-key navigation
// ---------------------------------------------------------------------------

/** Returns the visible text of a paragraph, skipping span.m-normal content. */
function paraTextExcludingSpans(para) {
    const walker = para.ownerDocument.createTreeWalker(
        para,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
            acceptNode(node) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    return node.classList.contains("m-normal")
                        ? NodeFilter.FILTER_REJECT
                        : NodeFilter.FILTER_SKIP;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        }
    );
    let text = "";
    let node;
    while ((node = walker.nextNode())) text += node.textContent;
    return text;
}

/**
 * Returns the character index of #script-cursor within its paragraph's
 * visible text (i.e., excluding span.m-normal text).  Returns null if
 * the cursor is not inside a Speech or StageDirection paragraph.
 */
function cursorParaCharIndex(iframeDoc) {
    const cursor = iframeDoc.getElementById("script-cursor");
    if (!cursor) return null;
    const para = cursor.closest("p.Speech, p.StageDirection");
    if (!para) return null;

    let charIndex = 0;

    function walk(node) {
        if (node === cursor) return true;
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("m-normal")) return false;
        if (node.nodeType === Node.TEXT_NODE) { charIndex += node.textContent.length; return false; }
        for (const child of node.childNodes) { if (walk(child)) return true; }
        return false;
    }

    return walk(para) ? charIndex : null;
}

/**
 * Converts a character index (in the visible text returned by
 * paraTextExcludingSpans) back to a collapsed Range inside para.
 */
function charIndexToRange(para, iframeDoc, charIndex) {
    const range = iframeDoc.createRange();
    let remaining = charIndex;
    let found = false;

    function walk(node) {
        if (found) return;
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("m-normal")) return;
        if (node.nodeType === Node.TEXT_NODE) {
            if (remaining <= node.textContent.length) {
                range.setStart(node, remaining);
                range.collapse(true);
                found = true;
                return;
            }
            remaining -= node.textContent.length;
            return;
        }
        for (const child of node.childNodes) walk(child);
    }

    walk(para);
    if (!found) { range.setStart(para, para.childNodes.length); range.collapse(true); }
    return range;
}

/**
 * Returns an ascending array of character indices where sentences begin in
 * text, using ". " (period + whitespace) as the delimiter.  Position 0 is
 * always included.
 */
function sentenceStartsInText(text) {
    const starts = [0];
    const re = /\.\s+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const pos = m.index + m[0].length;
        if (pos < text.length) starts.push(pos);
    }
    return starts;
}

/**
 * Returns true when cursor is positioned immediately to the left of
 * markerSpan (allowing for adjacent empty text nodes).
 */
function isAdjacentLeftOf(cursor, markerSpan) {
    let node = cursor.nextSibling;
    while (node && node.nodeType === Node.TEXT_NODE && node.textContent.trim() === "") {
        node = node.nextSibling;
    }
    return node === markerSpan;
}

/**
 * Returns true when cursor is positioned immediately to the right of
 * markerSpan (allowing for adjacent empty text nodes).
 */
function isAdjacentRightOf(cursor, markerSpan) {
    let node = cursor.previousSibling;
    while (node && node.nodeType === Node.TEXT_NODE && node.textContent.trim() === "") {
        node = node.previousSibling;
    }
    return node === markerSpan;
}

/** Cancels any in-progress arrow-key peek (timeout + listener + visuals). */
function clearArrowPeek() {
    if (peekTimeoutHandle !== null) { clearTimeout(peekTimeoutHandle); peekTimeoutHandle = null; }
    if (peekCancelListener !== null) {
        window.removeEventListener("keydown", peekCancelListener, { capture: true });
        peekCancelListener = null;
    }
    hideMovementPeek();
}

/**
 * Shows the movement path for spanId for 2 seconds.  Any keypress during
 * that window cancels the peek and re-processes the key normally.
 */
function triggerArrowPeek(spanId) {
    const anchor = movementAnchorData.get(spanId);
    if (!anchor) return;
    const speaker = speakers.find(s => s.speakerInitials === anchor.moverInitials);
    if (!speaker) return;

    clearArrowPeek();
    showMovementPeek(speaker);

    peekTimeoutHandle = setTimeout(clearArrowPeek, 2000);

    peekCancelListener = (event) => {
        event.stopImmediatePropagation();
        clearArrowPeek();
        handleKeyDown(event);
    };
    window.addEventListener("keydown", peekCancelListener, { capture: true });
}

/**
 * ArrowLeft: moves the cursor to immediately after the nearest m-normal span
 * that precedes the cursor.  Repositions speakers as usual.
 */
function arrowLeft() {
    const iframeDoc = myIframe.contentDocument;
    const cursor = iframeDoc.getElementById("script-cursor");
    if (!cursor) return;

    // All m-normal spans that precede the cursor in document order
    const before = Array.from(iframeDoc.querySelectorAll("span.m-normal")).filter(span =>
        cursor.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_PRECEDING
    );
    if (before.length === 0) return;

    // Last entry is nearest to cursor; if cursor is immediately after it, skip to the one before
    let bestSpan = before[before.length - 1];
    if (isAdjacentRightOf(cursor, bestSpan)) {
        if (before.length < 2) return;
        bestSpan = before[before.length - 2];
    }

    const range = iframeDoc.createRange();
    range.setStartAfter(bestSpan);
    range.collapse(true);
    bestSpan.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const { targetPositions } = findTargetPositions(iframeDoc, range);
    commitCursorMove(iframeDoc, range, targetPositions);
}

/**
 * ArrowRight: moves the cursor to immediately before the nearest m-normal
 * span that follows the cursor.  If the cursor is already immediately to the
 * left of that span, moves past it instead and shows the movement peek for
 * 2 seconds.
 */
function arrowRight() {
    const iframeDoc = myIframe.contentDocument;
    const cursor = iframeDoc.getElementById("script-cursor");
    if (!cursor) return;

    // All m-normal spans that follow the cursor in document order; first entry is nearest
    const after = Array.from(iframeDoc.querySelectorAll("span.m-normal")).filter(span =>
        cursor.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    if (after.length === 0) return;

    const nearestSpan = after[0];

    if (isAdjacentLeftOf(cursor, nearestSpan)) {
        // Move past the span and show peek
        const range = iframeDoc.createRange();
        range.setStartAfter(nearestSpan);
        range.collapse(true);
        nearestSpan.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const { targetPositions } = findTargetPositions(iframeDoc, range);
        commitCursorMove(iframeDoc, range, targetPositions);
        triggerArrowPeek(nearestSpan.id);
    } else {
        // Move to just before the span
        const range = iframeDoc.createRange();
        range.setStartBefore(nearestSpan);
        range.collapse(true);
        nearestSpan.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const { targetPositions } = findTargetPositions(iframeDoc, range);
        commitCursorMove(iframeDoc, range, targetPositions);
    }
}

/**
 * Ctrl+ArrowLeft: moves to the beginning of the current sentence.  If the
 * cursor is already at a sentence start, moves to the previous sentence start.
 * If at the beginning of a Speech paragraph, moves to the last sentence of
 * the preceding Speech paragraph.
 */
function ctrlArrowLeft() {
    const iframeDoc = myIframe.contentDocument;
    const cursor = iframeDoc.getElementById("script-cursor");
    if (!cursor) return;
    const para = cursor.closest("p.Speech, p.StageDirection");
    if (!para) return;

    const text   = paraTextExcludingSpans(para);
    const starts = sentenceStartsInText(text);
    const idx    = cursorParaCharIndex(iframeDoc);
    if (idx === null) return;

    const atSentenceStart = starts.includes(idx);
    let prevStart = null;
    for (let i = starts.length - 1; i >= 0; i--) {
        if (atSentenceStart ? starts[i] < idx : starts[i] <= idx) {
            prevStart = starts[i];
            break;
        }
    }

    if (prevStart !== null) {
        const range = charIndexToRange(para, iframeDoc, prevStart);
        para.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const { targetPositions } = findTargetPositions(iframeDoc, range);
        commitCursorMove(iframeDoc, range, targetPositions);
        return;
    }

    // At the very start of the paragraph — go to last sentence of the preceding Speech para
    const speechParas = Array.from(iframeDoc.querySelectorAll("p.Speech"));
    const paraRange = iframeDoc.createRange();
    paraRange.selectNodeContents(para);
    let prevPara = null;
    for (let i = speechParas.length - 1; i >= 0; i--) {
        const pRange = iframeDoc.createRange();
        pRange.selectNodeContents(speechParas[i]);
        if (pRange.compareBoundaryPoints(Range.START_TO_START, paraRange) < 0) {
            prevPara = speechParas[i];
            break;
        }
    }
    if (!prevPara) return;

    const prevText   = paraTextExcludingSpans(prevPara);
    const prevStarts = sentenceStartsInText(prevText);
    const lastStart  = prevStarts[prevStarts.length - 1];
    const range = charIndexToRange(prevPara, iframeDoc, lastStart);
    prevPara.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const { targetPositions } = findTargetPositions(iframeDoc, range);
    commitCursorMove(iframeDoc, range, targetPositions);
}

/**
 * Ctrl+ArrowRight: moves to the start of the next sentence.  If the cursor
 * is in the last sentence of the paragraph, moves to the start of the next
 * Speech paragraph.
 */
function ctrlArrowRight() {
    const iframeDoc = myIframe.contentDocument;
    const cursor = iframeDoc.getElementById("script-cursor");
    if (!cursor) return;
    const para = cursor.closest("p.Speech, p.StageDirection");
    if (!para) return;

    const text   = paraTextExcludingSpans(para);
    const starts = sentenceStartsInText(text);
    const idx    = cursorParaCharIndex(iframeDoc);
    if (idx === null) return;

    let nextStart = null;
    for (const s of starts) {
        if (s > idx) { nextStart = s; break; }
    }

    if (nextStart !== null) {
        const range = charIndexToRange(para, iframeDoc, nextStart);
        para.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const { targetPositions } = findTargetPositions(iframeDoc, range);
        commitCursorMove(iframeDoc, range, targetPositions);
        return;
    }

    // Last sentence — go to beginning of next Speech paragraph
    const speechParas = Array.from(iframeDoc.querySelectorAll("p.Speech"));
    const paraRange = iframeDoc.createRange();
    paraRange.selectNodeContents(para);
    let nextPara = null;
    for (const p of speechParas) {
        const pRange = iframeDoc.createRange();
        pRange.selectNodeContents(p);
        if (pRange.compareBoundaryPoints(Range.START_TO_START, paraRange) > 0) {
            nextPara = p;
            break;
        }
    }
    if (!nextPara) return;

    const range = iframeDoc.createRange();
    range.setStart(nextPara, 0);
    range.collapse(true);
    let child = nextPara.firstChild;
    while (child?.nodeType === Node.ELEMENT_NODE && child.classList.contains("m-normal")) {
        range.setStartAfter(child);
        child = child.nextSibling;
    }
    nextPara.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const { targetPositions } = findTargetPositions(iframeDoc, range);
    commitCursorMove(iframeDoc, range, targetPositions);
}

/**
 * Inserts a movement marker at the speaker's current drag position.
 *
 * Called when the user presses spacebar while dragging a speaker icon.
 * The marker is a small coloured square placed at the same pixel position as
 * the speakerDiv at the moment spacebar is pressed.  A permanent connector
 * line is drawn from the previous waypoint (shadow or last marker) to the new
 * marker, and subsequent drag-move events will trail a live line from the
 * marker to the moving speakerDiv.
 *
 * Does nothing if no drag is currently in progress.
 */
function insertMovementMarker() {
    if (!isDragging || !dataStore.incompleteMovement) return;

    const movement   = dataStore.incompleteMovement;
    const speakerDiv = movement.speakerDiv;
    const speakerObj = speakerObjFromSpeakerDiv(speakerDiv);

    // Read the speaker's current pixel position in the image-area
    const x = parseFloat(speakerDiv.getAttribute("data-x")) || 0;
    const y = parseFloat(speakerDiv.getAttribute("data-y")) || 0;

    // Offset so the marker's centre aligns with the speaker circle's centre
    // Speaker icon: 30 px wide, circle centre at 50 % → 15 px from left edge
    // Marker square: 10 px wide, centre at 5 px from left edge
    const markerX = x + 15 - 5;
    const markerY = y + 15 - 5;

    const markerDiv = createMovementMarkerDiv(
        markerX,
        markerY,
        speakerObj.backgroundColor,
        markerCount++
    );

    // Store the marker's proportional position on the stage image so that
    // redrawMovementLines() can reposition it correctly on window resize.
    // markerX/Y are offsets from #image-area top-left; we subtract the image's
    // own offset within that container to get coordinates relative to the image,
    // then divide by image dimensions to get fractions [0,1].
    const imageAreaRect = imageAreaDiv.getBoundingClientRect();
    const imgOffsetLeft = stageImageRect.left - imageAreaRect.left;
    const imgOffsetTop  = stageImageRect.top  - imageAreaRect.top;
    // Use the marker's centre (markerX+5, markerY+5) relative to the image
    markerDiv._rp = createRP(
        markerX + 5 - imgOffsetLeft,
        markerY + 5 - imgOffsetTop,
        stageImageElement          // 3-arg form: pixel offsets → proportional
    );

    speakerAreaElement.appendChild(markerDiv);

    // Freeze the segment to this marker and start trailing from it
    movement.addMarker(markerDiv);
}

/**
 * Scrolls the iframe to the next or previous page break.
 *
 * @param {"up"|"down"} direction
 */
function scrollToAdjacentPage(direction) {
    const iframeDoc  = myIframe.contentDocument || myIframe.contentWindow.document;
    const pageBreaks = Array.from(iframeDoc.querySelectorAll(".PageBreak"));
    const currentPage = getCurrentPageNumber(myIframe);
    const targetPage  = direction === "up" ? currentPage - 1 : currentPage + 1;

    const target = pageBreaks.find((el) => el.innerText.includes(`-Page ${targetPage}-`));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Movement workflow
// ---------------------------------------------------------------------------

/**
 * Cancels a pending movement (one that has been started with a right-click but
 * not yet completed with a drop).
 * Removes the placeholder span from the script and resets cursor/state.
 */
function handleEscapeKey() {
    if (!dataStore.newMovement) return;

    const span   = dataStore.newMovement.node;
    const parent = span?.parentNode;
    span?.remove();
    parent?.normalize(); // Merge split text nodes back together

    dataStore.newMovement = null;
    document.body.style.cursor = "default";
    myIframe.contentDocument.body.style.cursor = "text";
    setHelpBar("Left-click in the script to move the cursor · Right-click a Speech to start a movement · Hold a speaker icon to preview their path");
}

/**
 * Begins a new movement annotation at the position the user right-clicked.
 * Only valid inside Speech or StageDirection paragraphs.
 *
 * @param {MouseEvent} e - The contextmenu event from inside the iframe
 */
function startMovement(e, paragraphOffset = null) {
    if (!e.target.classList.contains("Speech") && !e.target.classList.contains("StageDirection")) {
        alert("You can only insert a movement in a speech paragraph or a stage direction.");
        return;
    }

    const offset      = paragraphOffset ?? getClickedCharacterPosition(myIframe);
    const newMovement = new Movement(myIframe, imageAreaDiv, dataStore, e.target, offset);
    dataStore.newMovement = newMovement;
    window.focus();
    setHelpBar("Drag the actor who is moving onto the stage image · Press Escape to cancel");
}

/**
 * Shows a modal confirmation dialog and returns a Promise that resolves to
 * true (OK) or false (Cancel).
 */
function showConfirm(message) {
    return new Promise(resolve => {
        document.getElementById("pb-confirm-msg").textContent = message;
        document.getElementById("pb-confirm-overlay").classList.add("visible");

        function done(result) {
            document.getElementById("pb-confirm-overlay").classList.remove("visible");
            document.getElementById("pb-confirm-ok").removeEventListener("click", okHandler);
            document.getElementById("pb-confirm-cancel").removeEventListener("click", cancelHandler);
            resolve(result);
        }
        function okHandler()     { done(true);  }
        function cancelHandler() { done(false); }
        document.getElementById("pb-confirm-ok").addEventListener("click", okHandler);
        document.getElementById("pb-confirm-cancel").addEventListener("click", cancelHandler);
    });
}

/**
 * Finds the movement whose span is closest to but at or before `referenceRange`.
 * Returns { targetPositions, targetSpanId } — both null when no span qualifies.
 */
function findTargetPositions(iframeDoc, referenceRange) {
    let targetPositions = null;
    let targetSpanRange = null;
    let targetSpanId    = null;

    iframeDoc.querySelectorAll("span.m-normal").forEach(span => {
        if (!movementPositions.has(span.id)) return;
        const spanRange = iframeDoc.createRange();
        spanRange.selectNode(span);
        if (spanRange.compareBoundaryPoints(Range.END_TO_START, referenceRange) <= 0) {
            if (!targetSpanRange ||
                spanRange.compareBoundaryPoints(Range.START_TO_START, targetSpanRange) > 0) {
                targetPositions = movementPositions.get(span.id);
                targetSpanRange = spanRange;
                targetSpanId    = span.id;
            }
        }
    });

    return { targetPositions, targetSpanId };
}

/**
 * Returns the id of the movement span currently in effect (the last m-normal
 * span at or before the #script-cursor), or null if the cursor doesn't exist
 * or no movement precedes it.
 */
function currentEffectiveSpanId(iframeDoc) {
    const cursor = iframeDoc.getElementById("script-cursor");
    if (!cursor) return null;
    const cursorRange = iframeDoc.createRange();
    cursorRange.selectNode(cursor);
    return findTargetPositions(iframeDoc, cursorRange).targetSpanId;
}

/**
 * Computes the absolute character offset within the paragraph from a Range
 * produced by snapCursorRange (works for both text-node and after-element cases).
 */
function computeOffsetFromRange(range) {
    const container = range.startContainer;
    const offset    = range.startOffset;

    if (container.nodeType === Node.TEXT_NODE) {
        let total = offset;
        let node  = container;
        while (node.previousSibling) {
            node   = node.previousSibling;
            total += node.textContent.length;
        }
        return total;
    }

    if (container.nodeType === Node.ELEMENT_NODE) {
        let total = 0;
        for (let i = 0; i < offset; i++) {
            total += container.childNodes[i].textContent.length;
        }
        return total;
    }

    return 0;
}

/**
 * Moves the cursor span to the given range position and repositions speakers
 * if targetPositions is non-null.  This is the commit step after any required
 * confirmation has been obtained.
 */
function commitCursorMove(iframeDoc, caretRange, targetPositions) {
    const oldCursor = iframeDoc.getElementById("script-cursor");
    if (oldCursor) {
        oldCursor.closest("p.Speech")?.classList.remove("pb-current-speech");
        oldCursor.remove();
    }
    const cursor = iframeDoc.createElement("span");
    cursor.id        = "script-cursor";
    cursor.className = "script-cursor";
    caretRange.insertNode(cursor);
    cursor.closest("p.Speech")?.classList.add("pb-current-speech");
    isDirty = true;

    speakerAreaElement.querySelectorAll('[id^="shadow-div-"], .movement-marker').forEach(el => el.remove());

    if (targetPositions) restoreSpeakerPositions(targetPositions);
}

// ---------------------------------------------------------------------------
// iframe click listener
// ---------------------------------------------------------------------------

/**
 * Re-attaches the click listener to the iframe body.
 * Must be called after the iframe body is replaced (e.g. on file load).
 */
function attachIFrameListeners() {
    const iframeDoc = myIframe.contentDocument;
    iframeDoc.addEventListener("click", onScriptClick);

    // Inject cursor style if not already present (survives body replacement, not head replacement)
    if (!iframeDoc.getElementById("pb-cursor-style")) {
        const style = iframeDoc.createElement("style");
        style.id = "pb-cursor-style";
        style.textContent = `
            #script-cursor {
                display: inline-block;
                width: 0;
                border-left: 2.5px solid #0055cc;
                height: 1.1em;
                vertical-align: text-bottom;
                user-select: none;
                pointer-events: none;
                animation: pb-cursor-blink 0.7s step-end infinite;
            }
            @keyframes pb-cursor-blink { 50% { opacity: 0; } }
            .pb-current-speech { background: #d8d8d8; }
        `;
        iframeDoc.head.appendChild(style);
    }
}

/**
 * Fetches all persisted movements from the server and populates movementPositions
 * so that click-to-restore works after a page reload.
 */
async function loadMovementPositions() {
    try {
        const movements = await fetchMovements(dataStore.productionId);
        movements.forEach(({ markerId, id, paraIndex, textOffset, moverInitials,
                             shadowRpX, shadowRpY, endRpX, endRpY, waypoints, speakerPositions }) => {
            const spanId = `m-${markerId}`;
            movementPositions.set(spanId, speakerPositions);
            movementAnchorData.set(spanId, { paraIndex, textOffset, moverInitials });
            completedMovements.set(spanId, {
                dbId:            id,
                moverInitials,
                shadowRP:        shadowRpX != null ? { rX: shadowRpX, rY: shadowRpY } : null,
                endRP:           endRpX    != null ? { rX: endRpX,    rY: endRpY    } : null,
                waypoints:       waypoints || [],
                speakerPositions,
            });
        });
    } catch (err) {
        console.error("loadMovementPositions failed:", err);
    }
}

/**
 * Adjusts a Range (in-place) so that the cursor lands at the start of the
 * clicked word rather than wherever the browser placed the caret.
 *
 * Rules applied in order:
 *  1. If the caret is inside a word, walk left to the word's first character.
 *  2. If the caret is on whitespace, walk right to the next word.
 *  3. After snapping to word-start: if everything between the start of the
 *     text node and the snapped offset is whitespace, AND the immediately
 *     preceding sibling is a movement marker span, place the cursor after
 *     that span (between the marker and the word, skipping the whitespace).
 */
function snapCursorRange(range) {
    const container = range.startContainer;
    if (container.nodeType !== Node.TEXT_NODE) return;

    const text = container.data;
    let   offset = range.startOffset;

    if (offset < text.length && /\S/.test(text[offset])) {
        // Caret is inside a word — walk left to its start
        while (offset > 0 && /\S/.test(text[offset - 1])) offset--;
    } else {
        // Caret is on whitespace or at the end — walk right to the next word
        while (offset < text.length && /\s/.test(text[offset])) offset++;
    }

    // If the only characters before the word in this text node are whitespace,
    // and the preceding sibling is a movement marker, jump to after the marker.
    const prev = container.previousSibling;
    if (/^\s*$/.test(text.slice(0, offset)) &&
        prev?.nodeType === Node.ELEMENT_NODE &&
        (prev.classList.contains("m-normal") || prev.classList.contains("m-new"))) {
        range.setStartAfter(prev);
    } else {
        range.setStart(container, offset);
    }
    range.collapse(true);
}

/**
 * On left-click in the script, finds the movement whose span is closest to
 * but at or before the click point, then restores all speaker divs to the
 * positions recorded when that movement was completed.
 *
 * @param {MouseEvent} e
 */
function onScriptClick(e) {
    if (dataStore.newMovement || dataStore.incompleteMovement) return;

    const iframeDoc  = myIframe.contentDocument;
    const caretRange = iframeDoc.caretRangeFromPoint(e.clientX, e.clientY);
    if (!caretRange) return;

    snapCursorRange(caretRange);

    const { targetPositions } = findTargetPositions(iframeDoc, caretRange);
    commitCursorMove(iframeDoc, caretRange, targetPositions);

    // Return keyboard focus to the parent window so that handleKeyDown receives
    // arrow keys, Tab, and other shortcuts after the user clicks in the script.
    window.focus();
}

/**
 * Moves every speaker div to the position recorded in a speakerPositions snapshot.
 *
 * @param {Array<{initials: string, rX: number, rY: number}>} speakerPositions
 */
function restoreSpeakerPositions(speakerPositions) {
    const imgRect  = stageImageElement.getBoundingClientRect();
    const areaRect = speakerAreaElement.getBoundingClientRect();

    speakerPositions.forEach(({ initials, rX, rY }) => {
        const speaker = speakers.find(s => s.speakerInitials === initials);
        if (!speaker || !speaker.onImage) return;

        speaker.RP = createRP(rX, rY);

        // RP is the fraction of image dimensions from the image's top-left to the
        // icon's centre. Subtract 15 (half of the 30 px icon) to get the div's top-left
        // in speakerAreaElement coordinates.
        const x = rX * imgRect.width  + (imgRect.left - areaRect.left) - 15;
        const y = rY * imgRect.height + (imgRect.top  - areaRect.top)  - 15;

        const speakerDiv = speaker.speakerDiv;
        speakerDiv.style.transform = `translate(${x}px, ${y}px)`;
        speakerDiv.setAttribute("data-x", x);
        speakerDiv.setAttribute("data-y", y);
    });
}

// ---------------------------------------------------------------------------
// DOMContentLoaded — entry point
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    // Route to the correct page initialiser based on the body id
    switch (document.body.id) {
        case "playBlockerPage":
            playBlockerPageSetup();
            break;
        case "indexPage":
            console.log("Index page loaded.");
            break;
        default:
            console.log("Unknown page id:", document.body.id);
    }
});

// ---------------------------------------------------------------------------
// Interact.js — drag-and-drop configuration
// ---------------------------------------------------------------------------

/**
 * Draggable configuration for all `.draggable` elements (speaker icons).
 *
 * Movement is restricted to the `#image-area` div.  Position is tracked via
 * CSS transform and mirrored in `data-x` / `data-y` attributes so Interact.js
 * can accumulate deltas across multiple drags.
 */
interact(".draggable").draggable({
    styleCursor: true,

    // Show a "grab" cursor on hover and "grabbing" while dragging
    cursorChecker: (action, interactable, element, interacting) =>
        interacting ? "grabbing" : "grab",

    modifiers: [
        interact.modifiers.restrictRect({
            restriction: "#image-area",
            endOnly:     false
        })
    ],

    listeners: {

        /**
         * Drag-start: if a pending movement exists, link this speaker to it and
         * set up the shadow icon at the drag origin.
         */
        start(event) {
            isDragging = true;

            // Store the pre-drag transform so we can restore it if the drop is invalid
            event.target.originalTransform = event.target.style.transform;

            if (inEditMode) {
                // Only the edit-shadow and the speaker being edited may be dragged.
                // All other draggables (other speakers, normal shadows) are blocked.
                const id = event.target.id;
                if (!id.startsWith("edit-shadow-div-") && !id.startsWith("speaker-div-")) {
                    isDragging = false;
                    event.interaction.stop();
                }
                return;
            }

            // Outside edit mode: block dragging a speaker that is already on stage.
            // They can only be moved through the edit-mode workflow.
            if (event.target.id.startsWith("speaker-div-")) {
                const initials = event.target.id.split("-").pop();
                const speaker  = speakers.find(s => s.speakerInitials === initials);
                if (speaker?.onImage && !dataStore.newMovement) {
                    isDragging = false;
                    event.interaction.stop();
                    return;
                }
            }

            if (dataStore.newMovement) {
                // The user right-clicked first (creating a pending movement), then
                // started dragging a speaker icon.  We now know which speaker is moving.
                const initials = event.target.id.split("-").pop();
                const speaker  = speakers.find((s) => s.speakerInitials === initials);

                // A speaker must be on the stage before a movement can be recorded for them.
                // "On stage" means they have been dropped onto the stage image at least once
                // (speaker.RP is set by the ondrop handler).
                if (!speaker.onImage) {
                    // Cancel the pending movement — remove the [?] span and reset state
                    const span   = dataStore.newMovement.node;
                    const parent = span?.parentNode;
                    span?.remove();
                    parent?.normalize();
                    dataStore.newMovement = null;
                    alert(`${speaker.speakerFirstName} ${speaker.speakerLastName} is not yet on stage. Drag them onto the stage image first before recording a movement.`);
                    return;
                }

                // Linking the speaker updates the placeholder span in the script text
                dataStore.newMovement.speaker = speaker;

                // Promote newMovement → incompleteMovement (has a speaker, needs a drop)
                dataStore.incompleteMovement = dataStore.newMovement;
                dataStore.incompleteMovement.speakerDiv = event.target;
                dataStore.newMovement = null;
                setHelpBar("Press Spacebar to mark waypoints along the path · Drop on the stage to finish");

                // Remove all visual traces of completed movements: shadow divs and
                // movement markers (each contains its own connector path in its SVG)
                speakerAreaElement.querySelectorAll('[id^="shadow-div-"], .movement-marker').forEach(el => el.remove());

                // Place the shadow icon at the drag-start position
                const shadowDiv = speaker.shadowDiv;
                shadowDiv.style.transform = event.target.style.transform;
                shadowDiv.setAttribute("data-x", event.target.getAttribute("data-x"));
                shadowDiv.setAttribute("data-y", event.target.getAttribute("data-y"));
                shadowDiv.style.zIndex = 100;
                speakerAreaElement.appendChild(shadowDiv);

                // Record the shadow's proportional position so it can be
                // correctly repositioned on window resize, independently of
                // where the speaker is eventually dropped.
                // Note: in a draggable listener, clientX/Y are on event directly
                // (event.dragEvent only exists on dropzone DropEvents).
                dataStore.incompleteMovement.shadowRP = createRP(
                    event.clientX,
                    event.clientY,
                    stageImageElement,
                    imageAreaDiv
                );

                dataStore.incompleteMovement.shadowDiv = shadowDiv;
            }
        },

        /**
         * Drag-move: update the icon's position and redraw the connector line.
         */
        move(event) {
            const target = event.target;
            const x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
            const y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;

            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute("data-x", x);
            target.setAttribute("data-y", y);
            target.style.zIndex = 1000; // Appear on top during drag

            // Redraw the connector line while dragging
            if (inEditMode) {
                redrawEditLines();
            } else if (dataStore.incompleteMovement) {
                dataStore.incompleteMovement.drawLines();
            }

            // Reset the previous speaker's z-index so it doesn't stay on top
            if (lastMovedSpeakerInitials && lastMovedSpeakerInitials !== speakerInitialsFromDiv(target)) {
                const prev = document.getElementById(`speaker-div-${lastMovedSpeakerInitials}`);
                if (prev) prev.style.zIndex = 100;
            }
            lastMovedSpeakerInitials = speakerInitialsFromDiv(target);
            wasDroppedInImageArea = false;
        },

        /**
         * Drag-end: if the icon was not dropped in the image area, restore it to
         * its pre-drag position.
         */
        end(event) {
            isDragging = false;

            if (inEditMode) {
                // Edit-shadow dragged freely — record its new RP (speakerDiv drop handled by ondrop)
                if (event.target.id.startsWith("edit-shadow-div-")) {
                    editState.currentShadowRP = rpFromEditDiv(event.target, 15);
                    editState.shadowMoved = true;
                }
                return;
            }

            if (event.target.onImage) {
                // Dropped successfully on stage — leave it where it landed
                return;
            }
            if (!wasDroppedInImageArea) {
                // Restore transform and Interact.js tracking attributes
                event.target.style.transform = event.target.originalTransform;
                const factors = parseTransform(event.target.originalTransform);
                event.target.setAttribute("data-x", parseFloat(factors.x));
                event.target.setAttribute("data-y", parseFloat(factors.y));
                event.target.originalTransform = null;
            }
        }
    }
});

/**
 * Drop zone configuration for the stage image.
 *
 * When a speaker icon is dropped here:
 *   - The drop position is converted to a proportional RP value and stored on the speaker
 *   - The incompleteMovement is cleared (movement is now complete)
 */
interact(".stage-image").dropzone({
    accept:  ".speaker",
    overlap: "center",

    ondragenter(event) {
        event.relatedTarget.style.cursor = "grabbing";
    },

    ondragleave(event) {
        event.relatedTarget.style.cursor = "not-allowed";
    },

    async ondrop(event) {
        wasDroppedInImageArea = true;

        if (inEditMode) {
            // Edit-shadow dropped on image — position already tracked in drag end handler
            if (event.relatedTarget.id.startsWith("edit-shadow-div-")) return;

            // Speaker dropped on image in edit mode — record new end position
            const rp = createRP(event.dragEvent.clientX, event.dragEvent.clientY, stageImageElement, imageAreaDiv);
            speakerObjFromSpeakerDiv(event.relatedTarget).RP = rp;
            editState.currentEndRP = { rX: rp.rX, rY: rp.rY };
            editState.endMoved     = true;
            document.body.style.cursor                 = "default";
            myIframe.contentDocument.body.style.cursor = "text";
            redrawEditLines();
            return;
        }

        event.relatedTarget.onImage = true;

        // Compute proportional position on the stage image
        const rp = createRP(
            event.dragEvent.clientX,
            event.dragEvent.clientY,
            stageImageElement,
            imageAreaDiv
        );

        const speakerDiv = event.relatedTarget;
        const speakerObj = speakerObjFromSpeakerDiv(speakerDiv);
        speakerObj.RP    = rp;

        document.body.style.cursor                    = "default";
        myIframe.contentDocument.body.style.cursor    = "text";

        // Persist the updated stage positions for all speakers
        try {
            await saveSpeakers(speakers);
        } catch (err) {
            console.error("saveSpeakers failed:", err);
        }
        speakerObj.onImage = true;

        // If this drop completed a movement, persist it before clearing the reference
        if (dataStore.incompleteMovement) {
            // Snapshot every placed speaker's position at this point in the script
            dataStore.incompleteMovement.speakerPositions = speakers
                .filter(s => s.RP)
                .map(s => ({ initials: s.speakerInitials, speakerId: s.dbId, rX: s.RP.rX, rY: s.RP.rY }));
            const spanId = dataStore.incompleteMovement.node?.id;
            if (spanId) movementPositions.set(spanId, dataStore.incompleteMovement.speakerPositions);

            // Compute anchor data for future span reconstruction
            const movSpan    = dataStore.incompleteMovement.node;
            const movPara    = movSpan?.parentElement ?? dataStore.incompleteMovement.containingPara;
            const iframeDoc  = myIframe.contentDocument;
            const allParas   = Array.from(iframeDoc.querySelectorAll("p"));
            const paraIndex  = movPara ? allParas.indexOf(movPara) : null;
            const rawOffset  = (movSpan && movPara) ? computeRawOffset(movPara, movSpan.id) : null;

            if (spanId) movementAnchorData.set(spanId, { paraIndex, textOffset: rawOffset, moverInitials: speakerObj.speakerInitials });

            let newMovementDbId = null;
            try {
                newMovementDbId = await saveMovement(dataStore.incompleteMovement, speakerObj.dbId, dataStore.productionId, paraIndex, rawOffset);
            } catch (err) {
                console.error("saveMovement failed:", err);
            }

            // Register immediately so peek and edit work without a page reload
            if (spanId) {
                const mov = dataStore.incompleteMovement;
                completedMovements.set(spanId, {
                    dbId:            newMovementDbId,
                    moverInitials:   speakerObj.speakerInitials,
                    shadowRP:        mov.shadowRP  ? { rX: mov.shadowRP.rX,  rY: mov.shadowRP.rY  } : null,
                    endRP:           speakerObj.RP ? { rX: speakerObj.RP.rX, rY: speakerObj.RP.rY } : null,
                    waypoints:       mov.movementMarkers.map(m => ({ rX: m._rp?.rX ?? null, rY: m._rp?.rY ?? null })),
                    speakerPositions: mov.speakerPositions ?? [],
                });
            }

            dataStore.incompleteMovement = null;
            isDirty = true;
            setHelpBar("Left-click in the script to move the cursor · Right-click a Speech to start a movement · Hold a speaker icon to preview their path");

            // Cascade: update snapshot data in all following movements up to and including
            // the I-Speaker's next movement (whose shadowRP also needs updating).
            if (spanId && speakerObj.RP) {
                try {
                    await cascadeInsert(myIframe.contentDocument, spanId,
                        speakerObj.speakerInitials,
                        { rX: speakerObj.RP.rX, rY: speakerObj.RP.rY });
                } catch (err) {
                    console.error("cascadeInsert failed:", err);
                }
            }

            // Remove the shadow and waypoint markers now that the movement is saved
            speakerAreaElement.querySelectorAll('[id^="shadow-div-"], .movement-marker').forEach(el => el.remove());
        }
        if (dataStore.newMovement) {
            dataStore.newMovement = null;
        }
    }

}).on("dropactivate", (event) => {
    event.target.classList.add("drop-activated");
});

// Ensure the dropzone also accepts .draggable elements (belt-and-suspenders)
interact(".dropzone").dropzone({ accept: ".draggable" });

// ---------------------------------------------------------------------------
// Movement path peek (mousedown-hold on an on-stage speaker)
// ---------------------------------------------------------------------------

function onSpeakerDivMouseDown(e) {
    if (e.button !== 0 || inEditMode || dataStore.newMovement) return;
    const target = e.target.closest('[id^="speaker-div-"]');
    if (!target) return;
    const initials = target.id.replace("speaker-div-", "");
    const speaker  = speakers.find(s => s.speakerInitials === initials);
    if (!speaker?.onImage) return;
    showMovementPeek(speaker);
}

/**
 * Displays the shadow div and waypoints for the last movement of `speaker`
 * before the current cursor position.  All elements are pointer-events:none
 * so they don't interfere with the mouse interaction.
 */
function showMovementPeek(speaker) {
    hideMovementPeek();

    const iframeDoc = myIframe.contentDocument;
    const cursor    = iframeDoc.getElementById("script-cursor");
    if (!cursor) return;

    const cursorRange = iframeDoc.createRange();
    cursorRange.selectNode(cursor);

    let peekSpanId    = null;
    let peekSpanRange = null;

    iframeDoc.querySelectorAll("span.m-normal").forEach(span => {
        const anchor = movementAnchorData.get(span.id);
        if (anchor?.moverInitials !== speaker.speakerInitials) return;

        const spanRange = iframeDoc.createRange();
        spanRange.selectNode(span);
        if (spanRange.compareBoundaryPoints(Range.END_TO_START, cursorRange) > 0) return;

        if (!peekSpanRange ||
            spanRange.compareBoundaryPoints(Range.START_TO_START, peekSpanRange) > 0) {
            peekSpanId    = span.id;
            peekSpanRange = spanRange;
        }
    });

    if (!peekSpanId) return;
    const movData = completedMovements.get(peekSpanId);
    if (!movData?.shadowRP) return;

    const imgRect  = stageImageElement.getBoundingClientRect();
    const areaRect = speakerAreaElement.getBoundingClientRect();

    // Shadow div — paler ghost, not draggable
    const shadowX = movData.shadowRP.rX * imgRect.width  + (imgRect.left - areaRect.left) - 15;
    const shadowY = movData.shadowRP.rY * imgRect.height + (imgRect.top  - areaRect.top)  - 15;
    const shadowDiv = createSpeakerDiv(dataStore, speaker,
        { currentX: shadowX, currentY: shadowY, yIncrement: 0, bottomOfColumnY: 0, topOfColumnY: 0 },
        true
    );
    shadowDiv.id = `peek-shadow-div-${speaker.speakerInitials}`;
    shadowDiv.classList.remove("draggable");
    shadowDiv.style.pointerEvents = "none";
    shadowDiv.style.zIndex = "100";
    speakerAreaElement.appendChild(shadowDiv);
    peekElements.push(shadowDiv);

    // Waypoint markers
    movData.waypoints.forEach(wp => {
        const markerX = wp.rX * imgRect.width  + (imgRect.left - areaRect.left) - 5;
        const markerY = wp.rY * imgRect.height + (imgRect.top  - areaRect.top)  - 5;
        const markerDiv = createMovementMarkerDiv(markerX, markerY, speaker.backgroundColor, markerCount++);
        speakerAreaElement.appendChild(markerDiv);
        peekElements.push(markerDiv);
    });

    // Connector chain: shadow → waypoints → speakerDiv
    const markers = peekElements.filter(el => el.classList.contains("movement-marker"));
    redrawChain([shadowDiv, ...markers, speaker.speakerDiv]);
}

function hideMovementPeek() {
    peekElements.forEach(el => el.remove());
    peekElements = [];
}

// ---------------------------------------------------------------------------
// Edit-mode interaction blocker
// ---------------------------------------------------------------------------

/**
 * Capture-phase handler that swallows all pointer/click/contextmenu events
 * while in edit mode, unless they originate from an edit artifact or the
 * context menu popup itself.
 */
function blockOutsideEditArtifacts(e) {
    if (!inEditMode) return;
    if (e.target.closest(".edit-artifact, #pb-context-menu, #pb-confirm-overlay")) return;
    e.preventDefault();
    e.stopPropagation();
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function showContextMenu(x, y, items) {
    const menu = document.getElementById("pb-context-menu");
    menu.innerHTML = "";
    items.forEach(({ label, action }) => {
        const item = document.createElement("div");
        item.className   = "pb-context-menu-item";
        item.textContent = label;
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            hideContextMenu();
            action();
        });
        menu.appendChild(item);
    });
    menu.style.left    = `${x}px`;
    menu.style.top     = `${y}px`;
    menu.style.display = "block";
}

function hideContextMenu() {
    const menu = document.getElementById("pb-context-menu");
    if (menu) menu.style.display = "none";
}

/**
 * Right-click handler for the image area.
 * Shows "Edit" for a speaker div (outside edit mode) and "Save / Cancel"
 * for any edit artifact (inside edit mode).
 */
function onSpeakerAreaContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    hideContextMenu();

    if (dataStore.newMovement || dataStore.incompleteMovement) return;

    const target = e.target.closest(
        '[id^="speaker-div-"],[id^="edit-shadow-div-"],[id^="shadow-div-"],[id^="movement-marker-"]'
    );
    if (!target) return;

    if (inEditMode) {
        showContextMenu(e.clientX, e.clientY, [
            { label: "Save",   action: () => saveEdit() },
            { label: "Cancel", action: () => cancelEdit() },
        ]);
        return;
    }

    if (!target.id.startsWith("speaker-div-")) return;
    const initials = target.id.replace("speaker-div-", "");
    const speaker  = speakers.find(s => s.speakerInitials === initials);
    if (!speaker?.onImage) return;

    showContextMenu(e.clientX, e.clientY, [
        { label: `Edit ${speaker.speakerFirstName}'s movement`, action: () => enterEditMode(speaker) },
    ]);
}

// ---------------------------------------------------------------------------
// Edit mode — enter / exit
// ---------------------------------------------------------------------------

/**
 * Converts a div's current data-x / data-y pixel attributes to a proportional
 * RP coordinate on the stage image.  `halfPx` is half the div's rendered size
 * (15 for 30 px speaker/shadow divs, 5 for 10 px marker divs).
 */
function rpFromEditDiv(div, halfPx) {
    const x = parseFloat(div.getAttribute("data-x")) || 0;
    const y = parseFloat(div.getAttribute("data-y")) || 0;
    const imgRect  = stageImageElement.getBoundingClientRect();
    const areaRect = speakerAreaElement.getBoundingClientRect();
    const imgOffsetLeft = imgRect.left - areaRect.left;
    const imgOffsetTop  = imgRect.top  - areaRect.top;
    return createRP(x + halfPx - imgOffsetLeft, y + halfPx - imgOffsetTop, stageImageElement);
}

/**
 * Redraws the connector chain for the movement currently being edited.
 * Chain order: editShadow → waypoint[0] → … → speakerDiv.
 */
function redrawEditLines() {
    if (!editState) return;
    const speaker    = speakers.find(s => s.speakerInitials === editState.speakerInitials);
    if (!speaker) return;
    const chain = [editState.shadowDiv, ...editState.markerDivs, speaker.speakerDiv];
    redrawChain(chain);
}

/**
 * Enters edit mode for the last movement belonging to `speaker` before the cursor.
 * Reconstructs the shadow div and waypoints, makes them draggable, and draws lines.
 */
function enterEditMode(speaker) {
    if (inEditMode) return;

    const iframeDoc = myIframe.contentDocument;
    const cursor    = iframeDoc.getElementById("script-cursor");
    if (!cursor) {
        alert("Click in the script first to set the cursor position.");
        return;
    }

    // Find the last movement span for this speaker that precedes the cursor
    const cursorRange = iframeDoc.createRange();
    cursorRange.selectNode(cursor);

    let editSpanId    = null;
    let editSpanRange = null;

    iframeDoc.querySelectorAll("span.m-normal").forEach(span => {
        const anchor = movementAnchorData.get(span.id);
        if (anchor?.moverInitials !== speaker.speakerInitials) return;

        const spanRange = iframeDoc.createRange();
        spanRange.selectNode(span);
        if (spanRange.compareBoundaryPoints(Range.END_TO_START, cursorRange) > 0) return;

        if (!editSpanRange || spanRange.compareBoundaryPoints(Range.START_TO_START, editSpanRange) > 0) {
            editSpanId    = span.id;
            editSpanRange = spanRange;
        }
    });

    if (!editSpanId) {
        alert(`No movement found for ${speaker.speakerFirstName} before the cursor.`);
        return;
    }

    const movData = completedMovements.get(editSpanId);
    if (!movData?.shadowRP || !movData?.endRP) {
        alert("Movement data is incomplete — cannot edit.");
        return;
    }

    inEditMode = true;
    setHelpBar("Drag the ghost (start) or actor icon (end) or any waypoint · Right-click to Save or Cancel");
    editState  = {
        spanId:             editSpanId,
        dbId:               movData.dbId,
        speakerInitials:    speaker.speakerInitials,
        originalShadowRP:   { ...movData.shadowRP },
        originalEndRP:      { ...movData.endRP },
        originalWaypoints:  movData.waypoints.map(wp => ({ ...wp })),
        currentShadowRP:    { ...movData.shadowRP },
        currentEndRP:       { ...movData.endRP },
        currentWaypoints:   movData.waypoints.map(wp => ({ ...wp })),
        shadowDiv:          null,
        markerDivs:         [],
        shadowMoved:        false,
        endMoved:           false,
    };

    const imgRect  = stageImageElement.getBoundingClientRect();
    const areaRect = speakerAreaElement.getBoundingClientRect();

    // Create the edit shadow div (paler, same as a normal shadow)
    const shadowX = movData.shadowRP.rX * imgRect.width  + (imgRect.left - areaRect.left) - 15;
    const shadowY = movData.shadowRP.rY * imgRect.height + (imgRect.top  - areaRect.top)  - 15;
    const editShadow = createSpeakerDiv(dataStore, speaker,
        { currentX: shadowX, currentY: shadowY, yIncrement: 0, bottomOfColumnY: 0, topOfColumnY: 0 },
        true /* isShadow */
    );
    editShadow.id            = `edit-shadow-div-${speaker.speakerInitials}`;
    editShadow.style.zIndex  = "100";
    editShadow.style.pointerEvents = "auto";
    editShadow.classList.add("edit-artifact");
    speakerAreaElement.appendChild(editShadow);
    editState.shadowDiv = editShadow;

    // Mark the speaker div as an edit artifact so the blocker lets it through
    speaker.speakerDiv.classList.add("edit-artifact");

    // Disable pointer events on the script iframe to prevent cursor moves during edit
    myIframe.style.pointerEvents = "none";

    // Create waypoint markers
    movData.waypoints.forEach((wp, i) => {
        const markerX = wp.rX * imgRect.width  + (imgRect.left - areaRect.left) - 5;
        const markerY = wp.rY * imgRect.height + (imgRect.top  - areaRect.top)  - 5;
        const markerDiv = createMovementMarkerDiv(markerX, markerY, speaker.backgroundColor, markerCount++);
        markerDiv.style.pointerEvents = "auto";
        markerDiv.classList.add("edit-artifact");
        markerDiv._rp = { rX: wp.rX, rY: wp.rY };
        speakerAreaElement.appendChild(markerDiv);
        editState.markerDivs.push(markerDiv);

        // Make each waypoint draggable
        const idx = i;
        interact(markerDiv).draggable({
            modifiers: [interact.modifiers.restrictRect({ restriction: "#image-area", endOnly: false })],
            listeners: {
                move(ev) {
                    const mx = (parseFloat(ev.target.getAttribute("data-x")) || 0) + ev.dx;
                    const my = (parseFloat(ev.target.getAttribute("data-y")) || 0) + ev.dy;
                    ev.target.style.transform = `translate(${mx}px, ${my}px)`;
                    ev.target.setAttribute("data-x", mx);
                    ev.target.setAttribute("data-y", my);
                    redrawEditLines();
                },
                end(ev) {
                    editState.currentWaypoints[idx] = rpFromEditDiv(ev.target, 5);
                },
            },
        });
    });

    // Draw the full connector chain
    redrawEditLines();
}

/**
 * Saves the edited movement to the server and cascades changes to adjacent
 * movements for the same speaker.
 */
async function saveEdit() {
    if (!editState) return;
    hideContextMenu();

    const { spanId, dbId, speakerInitials,
            currentShadowRP, currentEndRP, currentWaypoints,
            shadowMoved, endMoved } = editState;
    const speaker = speakers.find(s => s.speakerInitials === speakerInitials);

    // --- Build updated speakerPositions for the edited movement ---
    const editedPositions = (movementPositions.get(spanId) || []).map(sp =>
        sp.initials === speakerInitials
            ? { ...sp, rX: currentEndRP.rX, rY: currentEndRP.rY }
            : { ...sp }
    );

    try {
        await updateMovement(dbId, {
            shadowRpX:        currentShadowRP.rX,
            shadowRpY:        currentShadowRP.rY,
            endRpX:           currentEndRP.rX,
            endRpY:           currentEndRP.rY,
            waypoints:        currentWaypoints.map((wp, i) => ({ sequence: i, rX: wp.rX, rY: wp.rY })),
            speakerPositions: editedPositions.map(sp => ({
                speakerId: speakers.find(x => x.speakerInitials === sp.initials)?.dbId,
                rX: sp.rX, rY: sp.rY,
            })),
        });
    } catch (err) {
        console.error("saveEdit: updateMovement failed:", err);
        alert("Failed to save movement. Please try again.");
        return;
    }

    // Update in-memory maps for the edited movement
    movementPositions.set(spanId, editedPositions);
    completedMovements.set(spanId, {
        ...completedMovements.get(spanId),
        shadowRP:        currentShadowRP,
        endRP:           currentEndRP,
        waypoints:       currentWaypoints,
        speakerPositions: editedPositions,
    });

    // Locate this speaker's movements in document order
    const iframeDoc  = myIframe.contentDocument;
    const allSpans   = Array.from(iframeDoc.querySelectorAll("span.m-normal"));
    const speakerSpans = allSpans.filter(sp =>
        movementAnchorData.get(sp.id)?.moverInitials === speakerInitials
    );
    const editIdx = speakerSpans.findIndex(sp => sp.id === spanId);

    // --- Cascade forward: speakerDiv moved → update next movement's shadowRP ---
    if (endMoved && editIdx >= 0 && editIdx < speakerSpans.length - 1) {
        const nextSpan = speakerSpans[editIdx + 1];
        const nextData = completedMovements.get(nextSpan.id);
        if (nextData) {
            try { await updateMovement(nextData.dbId, { shadowRpX: currentEndRP.rX, shadowRpY: currentEndRP.rY }); }
            catch (err) { console.error("saveEdit: next shadowRP update failed:", err); }
            completedMovements.set(nextSpan.id, { ...nextData, shadowRP: { ...currentEndRP } });
        }
        // Update speaker's position in all snapshots between spanId and nextSpan
        const editGlobalIdx = allSpans.indexOf(speakerSpans[editIdx]);
        const nextGlobalIdx = allSpans.indexOf(nextSpan);
        for (let i = editGlobalIdx + 1; i < nextGlobalIdx; i++) {
            await updateSpeakerInSnapshot(allSpans[i].id, speakerInitials, currentEndRP);
        }
    }

    // --- Cascade backward: shadowDiv moved → update prev movement's endRP ---
    if (shadowMoved && editIdx > 0) {
        const prevSpan = speakerSpans[editIdx - 1];
        const prevData = completedMovements.get(prevSpan.id);
        if (prevData) {
            const prevPositions = (movementPositions.get(prevSpan.id) || []).map(sp =>
                sp.initials === speakerInitials
                    ? { ...sp, rX: currentShadowRP.rX, rY: currentShadowRP.rY }
                    : { ...sp }
            );
            try {
                await updateMovement(prevData.dbId, {
                    endRpX: currentShadowRP.rX, endRpY: currentShadowRP.rY,
                    speakerPositions: prevPositions.map(sp => ({
                        speakerId: speakers.find(x => x.speakerInitials === sp.initials)?.dbId,
                        rX: sp.rX, rY: sp.rY,
                    })),
                });
            } catch (err) { console.error("saveEdit: prev endRP update failed:", err); }
            movementPositions.set(prevSpan.id, prevPositions);
            completedMovements.set(prevSpan.id, { ...prevData, endRP: { ...currentShadowRP }, speakerPositions: prevPositions });

            // Update speaker's position in snapshots between prevSpan and spanId
            const prevGlobalIdx = allSpans.indexOf(prevSpan);
            const editGlobalIdx = allSpans.indexOf(speakerSpans[editIdx]);
            for (let i = prevGlobalIdx + 1; i < editGlobalIdx; i++) {
                await updateSpeakerInSnapshot(allSpans[i].id, speakerInitials, currentShadowRP);
            }
        }
    }

    // Update speaker's RP to its new end position
    if (speaker && endMoved) speaker.RP = createRP(currentEndRP.rX, currentEndRP.rY);

    cleanupEditMode();
    isDirty = true;
}

/**
 * Cancels the current edit and restores everything to the original positions.
 */
function cancelEdit() {
    if (!editState) return;
    hideContextMenu();

    const speaker = speakers.find(s => s.speakerInitials === editState.speakerInitials);
    if (speaker) {
        // Restore speaker to its original end position
        const { rX, rY } = editState.originalEndRP;
        speaker.RP = createRP(rX, rY);
        const imgRect  = stageImageElement.getBoundingClientRect();
        const areaRect = speakerAreaElement.getBoundingClientRect();
        const x = rX * imgRect.width  + (imgRect.left - areaRect.left) - 15;
        const y = rY * imgRect.height + (imgRect.top  - areaRect.top)  - 15;
        const div = speaker.speakerDiv;
        div.style.transform = `translate(${x}px, ${y}px)`;
        div.setAttribute("data-x", x);
        div.setAttribute("data-y", y);
    }

    cleanupEditMode();
}

/** Tears down all edit-mode DOM elements and resets state flags. */
function cleanupEditMode() {
    if (!editState) return;
    const speaker = speakers.find(s => s.speakerInitials === editState.speakerInitials);
    speaker?.speakerDiv.classList.remove("edit-artifact");
    myIframe.style.pointerEvents = "";
    editState.markerDivs.forEach(div => { interact(div).unset(); div.remove(); });
    editState.shadowDiv?.remove();
    editState = null;
    inEditMode = false;
    setHelpBar("Left-click in the script to move the cursor · Right-click a Speech to start a movement · Hold a speaker icon to preview their path");
}

/**
 * Updates a single speaker's position in a movement's speakerPositions snapshot,
 * both in memory and in the database.
 */
async function updateSpeakerInSnapshot(spanId, speakerInitials, newRP) {
    const movData   = completedMovements.get(spanId);
    const positions = movementPositions.get(spanId);
    if (!movData || !positions) return;

    const updated = positions.map(sp =>
        sp.initials === speakerInitials ? { ...sp, rX: newRP.rX, rY: newRP.rY } : { ...sp }
    );
    try {
        await updateMovement(movData.dbId, {
            speakerPositions: updated.map(sp => ({
                speakerId: speakers.find(x => x.speakerInitials === sp.initials)?.dbId,
                rX: sp.rX, rY: sp.rY,
            })),
        });
        movementPositions.set(spanId, updated);
        completedMovements.set(spanId, { ...movData, speakerPositions: updated });
    } catch (err) {
        console.error(`updateSpeakerInSnapshot(${spanId}) failed:`, err);
    }
}

// ---------------------------------------------------------------------------
// Cascade helpers — keep snapshot data consistent after insert or delete
// ---------------------------------------------------------------------------

/**
 * After a new movement is dropped, propagates the I-Speaker's new end position
 * into the snapshot of every following movement, stopping after the first
 * following movement that belongs to the I-Speaker (whose shadowRP is also
 * updated so the path remains continuous).
 *
 * @param {Document} iframeDoc
 * @param {string}   newSpanId        - The span id of the newly completed movement
 * @param {string}   iSpeakerInitials - Initials of the actor who just moved
 * @param {{rX,rY}}  newEndRP         - Where the I-Speaker ended up
 */
async function cascadeInsert(iframeDoc, newSpanId, iSpeakerInitials, newEndRP) {
    const allSpans = Array.from(iframeDoc.querySelectorAll("span.m-normal"));
    const startIdx = allSpans.findIndex(s => s.id === newSpanId);
    if (startIdx < 0) return;

    for (let i = startIdx + 1; i < allSpans.length; i++) {
        const spanId = allSpans[i].id;
        const isISpeakerMovement = movementAnchorData.get(spanId)?.moverInitials === iSpeakerInitials;

        await updateSpeakerInSnapshot(spanId, iSpeakerInitials, newEndRP);

        if (isISpeakerMovement) {
            // This is the I-Speaker's next movement; its shadow must now start at newEndRP.
            const movData = completedMovements.get(spanId);
            if (movData) {
                try {
                    await updateMovement(movData.dbId, { shadowRpX: newEndRP.rX, shadowRpY: newEndRP.rY });
                    completedMovements.set(spanId, { ...movData, shadowRP: { ...newEndRP } });
                } catch (err) {
                    console.error("cascadeInsert: shadowRP update failed:", err);
                }
            }
            break;
        }
    }
}

/**
 * Deletes the movement associated with `spanId`, then cascades the D-Speaker's
 * prior position into every following movement's snapshot, stopping after the
 * D-Speaker's next movement (whose shadowRP is also corrected).
 *
 * @param {string} spanId - The m-N span id of the movement to delete
 */
async function deleteMovementAtSpan(spanId) {
    if (inEditMode || dataStore.newMovement || dataStore.incompleteMovement) return;

    const iframeDoc = myIframe.contentDocument;
    const span      = iframeDoc.getElementById(spanId);
    if (!span) return;

    const anchor           = movementAnchorData.get(spanId);
    const dSpeakerInitials = anchor?.moverInitials;
    const movData          = completedMovements.get(spanId);

    // Snapshot all span IDs in DOM order before we remove the span
    const allSpans   = Array.from(iframeDoc.querySelectorAll("span.m-normal"));
    const deletedIdx = allSpans.findIndex(s => s.id === spanId);

    // D-Speaker's position just before the deleted movement — scan preceding snapshots
    let dSpeakerPriorRP = null;
    for (let i = deletedIdx - 1; i >= 0; i--) {
        const found = movementPositions.get(allSpans[i].id)
            ?.find(sp => sp.initials === dSpeakerInitials);
        if (found) { dSpeakerPriorRP = { rX: found.rX, rY: found.rY }; break; }
    }
    // Fallback: initial placement RP if no preceding snapshot contains the D-Speaker
    if (!dSpeakerPriorRP) {
        const speaker = speakers.find(s => s.speakerInitials === dSpeakerInitials);
        if (speaker?.RP) dSpeakerPriorRP = { rX: speaker.RP.rX, rY: speaker.RP.rY };
    }

    const followingSpanIds = allSpans.slice(deletedIdx + 1).map(s => s.id);

    // Remove span from DOM
    const parent = span.parentNode;
    span.remove();
    parent?.normalize();

    // Delete from server
    if (movData?.dbId != null) {
        try { await deleteMovement(movData.dbId); }
        catch (err) { console.error("deleteMovementAtSpan: server delete failed:", err); }
    }

    // Remove from in-memory maps
    completedMovements.delete(spanId);
    movementPositions.delete(spanId);
    movementAnchorData.delete(spanId);

    // Cascade: fix following movements' snapshot data
    if (dSpeakerInitials && dSpeakerPriorRP) {
        for (const followingId of followingSpanIds) {
            if (!movementAnchorData.has(followingId)) continue;
            const isDSpeakerMovement = movementAnchorData.get(followingId)?.moverInitials === dSpeakerInitials;

            await updateSpeakerInSnapshot(followingId, dSpeakerInitials, dSpeakerPriorRP);

            if (isDSpeakerMovement) {
                // This movement's shadow must now start where D-Speaker was before the deleted movement
                const nextMovData = completedMovements.get(followingId);
                if (nextMovData) {
                    try {
                        await updateMovement(nextMovData.dbId, { shadowRpX: dSpeakerPriorRP.rX, shadowRpY: dSpeakerPriorRP.rY });
                        completedMovements.set(followingId, { ...nextMovData, shadowRP: { ...dSpeakerPriorRP } });
                    } catch (err) {
                        console.error("deleteMovementAtSpan: shadowRP cascade failed:", err);
                    }
                }
                break;
            }
        }
    }

    // Reposition speaker icons to reflect the cursor's now-current movement context
    const cursor = iframeDoc.getElementById("script-cursor");
    if (cursor) {
        const cursorRange = iframeDoc.createRange();
        cursorRange.selectNode(cursor);
        const { targetPositions } = findTargetPositions(iframeDoc, cursorRange);
        if (targetPositions) restoreSpeakerPositions(targetPositions);
    }

    isDirty = true;
}