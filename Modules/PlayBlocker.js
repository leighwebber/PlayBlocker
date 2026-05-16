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
 *  - Script download
 */

import {
    DataStore, Speaker, speakers, Movement,
    createTextElement, 
    createSvgElement, createSpeakerDiv,
    createMovementMarkerDiv,
    MovementList, GetMovementListLog,
    createRP,
    speakerObjFromSpeakerDiv,
} from "../Modules/Backend.js";

import {
    GetCurrentPageNumber, getPreviousMovementMarker,
    GetPageNumberAtCursor, GetPageNumberAtMovement,
    GetClickedCharacterPosition, TotalPageCount,
    GoToPage
} from "../Modules/ScriptText.js";

import {
    createCircleElement
} from "../Modules/Icons.js";

import {
    saveScript
} from  "../Modules/Database.js";
// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** True while an Interact.js drag is actively in progress. */
let isDragging = false;

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

/**
 * When false, right-click in the iframe shows our custom movement-start handler
 * rather than the browser's default context menu.
 */
let contextMenuAllowed = true;

/** Central state store for the session. */
let dataStore = null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = "https://lwebber.ca/api";

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
function PlayBlockerPageSetup() {
    // Show the chosen file name in the UI when a file is selected
    document.getElementById("fileInput").addEventListener("change", function () {
        const fileName = this.files[0] ? this.files[0].name : "No file selected";
        document.getElementById("file-name").textContent = fileName;
    });

    // Create the central state store, referencing the script iframe
    myIframe  = document.getElementById("script-iframe");
    dataStore = new DataStore(myIframe);

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

    slider.addEventListener("change", sliderOnChange);
    slider.oninput = function () {
        output.innerHTML = this.value;
        // sliderMove() is a placeholder for future smooth-scroll behaviour
        slider.blur();
    };

    // Download button
    document.getElementById("saveScript").addEventListener("click", saveScript);

    // File selection handler
    document.getElementById("fileInput").addEventListener("change", handleFileSelection);

    // Populate speaker icons in the speaker panel
    insertSpeakers(speakerAreaElement);

    // Keyboard navigation
    window.addEventListener("keydown", handleKeyDown);

    // Window resize — reposition icons proportionally
    window.addEventListener("resize", onResize);

    // Suppress the browser context menu inside the iframe; show ours instead
    contextMenuAllowed = false;
    myIframe.contentWindow.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (event.target.className !== "Speech" && event.target.className !== "StageDirection") {
            alert("You can only create a movement inside the text of a Speech or a StageDirection");
            return;
        }
        startMovement(event);
    });

    // Change cursor when the pointer leaves the iframe during a pending movement
    myIframe.addEventListener("mouseleave", () => {
        document.body.style.cursor = dataStore.newMovement ? "not-allowed" : "default";
    });

    // Update the page slider when the user scrolls the script
    myIframe.contentWindow.addEventListener("scroll", iFrameOnScroll);

    // Register click handler for the script iframe (used for logging click positions)
    iFrameListeners();

    // Get-page-number button (diagnostic, currently unused in production UI)
    document.getElementById("get-page-number").addEventListener("click", () => {
        const currentPage = GetCurrentPageNumber(myIframe);
        const totalPages  = TotalPageCount(myIframe);
        console.log(`Current page: ${currentPage} / ${totalPages}`);
    });

    console.log("PlayBlocker page loaded.");
}

// ---------------------------------------------------------------------------
// Speaker panel population
// ---------------------------------------------------------------------------

/**
 * Creates Speaker objects for the current production and adds their draggable
 * icon divs to the speaker panel.
 *
 * TODO: Replace the hard-coded cast list with a user-supplied input form.
 *
 * @param {HTMLElement} spkrContainer - The speaker panel div
 */
function insertSpeakers(spkrContainer) {
    // Hard-coded cast for "And Then There Were None" — to be replaced with dynamic input
    const cast = [
        ["Lombard",   "LO", "green"],
        ["Marston",   "MA", "blue"],
        ["Claythorne","CL", "pink"],
        ["Wargrave",  "WA", "orange"],
        ["Blore",     "BL", "purple"],
        ["McKenzie",  "MK", "cyan"],
        ["Armstrong", "AR", "yellow"],
        ["Rogers",    "RO", "brown"],
        ["Mrs Rogers","RS", "lightgray"],
        ["Narracot",  "NA", "black"],
        ["Brent",     "BR", "violet"]
    ];

    cast.forEach(([name, initials, color]) => speakers.push(Speaker.create(name, initials, color)));

    // Layout parameters for the main icon column
    const divParms = { currentX: 0,  currentY: 0, yIncrement: 30, bottomOfColumnY: 0, topOfColumnY: 0 };
    // Layout parameters for the shadow (origin-marker) column — offset 70 px to the right
    const shadowParms = { currentX: 70, currentY: 0, yIncrement: 30, bottomOfColumnY: 0, topOfColumnY: 0 };

    const speakerContainer = document.getElementById("image-area");

    speakers.forEach((speaker) => {
        // Create the draggable icon
        const speakerDiv = createSpeakerDiv(dataStore, speaker, divParms, false);
        speaker.speakerDiv = speakerDiv;

        // Create the ghost/shadow icon (shown as the origin during a drag)
        const shadowDiv = createSpeakerDiv(dataStore, speaker, shadowParms, true);
        speaker.shadowDiv = shadowDiv;

        divParms.currentY += divParms.yIncrement;

        speakerContainer.appendChild(speakerDiv);

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
    logContent.textContent = GetMovementListLog("showLog", dataStore);
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
        const speakerObj = speakerObjFromSpeakerDiv(speakerDiv);

        if (!speakerObj.RP) return;

        const oldPixelX = speakerObj.RP.rX * imgWidthOld;
        const oldPixelY = speakerObj.RP.rY * imgHeightOld;
        const newPixelX = speakerObj.RP.rX * imgWidthNew + deltaLeft;
        const newPixelY = speakerObj.RP.rY * imgHeightNew + deltaTop;

        // Reposition the speakerDiv (existing logic)
        const oldFactors = parseTransform(speakerDiv.style.transform);
        const newX = parseFloat(oldFactors.x) + (newPixelX - oldPixelX);
        const newY = parseFloat(oldFactors.y) + (newPixelY - oldPixelY);
        speakerDiv.style.transform = speakerDiv.style.transform
            .replace(oldFactors.x, `${newX}px`)
            .replace(oldFactors.y, `${newY}px`);
        speakerDiv.setAttribute("data-x", newX);
        speakerDiv.setAttribute("data-y", newY);

        // *** NEW: also reposition the shadowDiv if it's been placed on stage ***
        const shadowDiv = speakerObj.shadowDiv;
        if (shadowDiv && shadowDiv.isConnected && shadowDiv.parentElement === speakerAreaElement) {
            const shadowFactors = parseTransform(shadowDiv.style.transform);
            // Only reposition if the shadow was placed at a real position (not still
            // in its default panel column, i.e. it has been appended during a movement)
            const shadowX = parseFloat(shadowFactors.x) + (newPixelX - oldPixelX);
            const shadowY = parseFloat(shadowFactors.y) + (newPixelY - oldPixelY);
            shadowDiv.style.transform = shadowDiv.style.transform
                .replace(shadowFactors.x, `${shadowX}px`)
                .replace(shadowFactors.y, `${shadowY}px`);
            shadowDiv.setAttribute("data-x", shadowX);
            shadowDiv.setAttribute("data-y", shadowY);
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
 * Movement markers were placed at a fixed point on the stage image, so they must
 * shift by exactly the same pixel delta as their speakerDiv. That delta is
 * derived from the speaker's RP and the change in the stage image geometry.
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

        const rp = movement.speaker?.RP;
        if (rp && movement.movementMarkers.length > 0) {
            // The same delta that repositionSpeakers applied to the speakerDiv
            const oldPixelX = rp.rX * imgWidthOld;
            const oldPixelY = rp.rY * imgHeightOld;
            const newPixelX = rp.rX * imgWidthNew + deltaLeft;
            const newPixelY = rp.rY * imgHeightNew + deltaTop;
            const dx = newPixelX - oldPixelX;
            const dy = newPixelY - oldPixelY;

            movement.movementMarkers.forEach((markerDiv) => {
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
 * @param {HTMLElement} speakerDiv
 * @returns {string}
 */
function speakerInitialsFromDiv(speakerDiv) {
    return speakerDiv.id.split("-").pop();
}

/**
 * Converts pixel coordinates (relative to the stage image's top-left corner)
 * to proportional coordinates [0, 1].
 *
 * @param {{ x: number, y: number }} rawPosition - Pixel offsets from image origin
 * @returns {{ proportionalX: number, proportionalY: number }}
 */
function xyToProportional(rawPosition) {
    return {
        proportionalX: rawPosition.x / stageImageRect.width,
        proportionalY: rawPosition.y / stageImageRect.height
    };
}

// ---------------------------------------------------------------------------
// File handling
// ---------------------------------------------------------------------------

/**
 * Handles the "file selected" event from the file input.
 * Reads the selected HTML file and loads it into the script iframe.
 *
 * @param {Event} event - The change event from the file input
 */
function handleFileSelection(event) {
    const file            = event.target.files[0];
    const messageDisplay  = document.getElementById("message");

    if (!file) {
        showMessage("No file selected. Please choose a file.", "error");
        return;
    }
    if (!file.type.startsWith("text")) {
        showMessage("Unsupported file type. Please select a text/HTML file.", "error");
        return;
    }

    const reader = new FileReader();

    reader.onload = () => {
        // Write the file's HTML directly into the iframe body
        myIframe.contentDocument.body.innerHTML = reader.result;

        // Re-attach click handlers (they are lost when the body is replaced)
        iFrameListeners();

        // Update state
        dataStore.script.fileName    = file.name;
        dataStore.script.htmlContent = myIframe.contentDocument.body.innerHTML;

        const startingPage = GetCurrentPageNumber(myIframe);
        pageCount          = TotalPageCount(myIframe);

        dataStore.movementList.pageCount = pageCount;
        dataStore.movementList.startPage = startingPage;

        // Sync slider to the first visible page
        slider.value             = startingPage;
        output.innerHTML         = slider.value;

        // Show the download button and slider now that a script is loaded
        document.getElementById("saveScript").style.visibility = "visible";
        document.getElementById("slidecontainer").style.visibility = "visible";

        scriptLoaded = true;
    };

    reader.onerror = () => {
        showMessage("Error reading the file. Please try again.", "error");
    };

    reader.readAsText(file);
}

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
// Script download
// ---------------------------------------------------------------------------

/**
 * Downloads the current state of the script (including any movement annotations)
 * as a plain-text file.  The file name is taken from the originally loaded file.
 */
function downloadTextFile() {
    const content  = myIframe.contentDocument.body.innerHTML;
    const fileName = dataStore.script.fileName;

    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);

    // Use a hidden anchor to trigger the browser's save dialog
    const a = Object.assign(document.createElement("a"), {
        href:    url,
        download: fileName,
        style:   "display:none"
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    GoToPage(myIframe, page);
    dataStore.currentPage = page;
}

/**
 * Fires while the iframe scrolls.
 * Keeps the slider in sync with the currently visible page.
 */
function iFrameOnScroll() {
    const page = GetCurrentPageNumber(myIframe);
    if (page !== dataStore.currentPage) {
        slider.value    = 100 * page / pageCount;
        output.innerHTML = slider.value;
        dataStore.currentPage = page;
    }
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
    const iframeDoc   = myIframe.contentDocument || myIframe.contentWindow.document;
    const pageBreaks  = Array.from(iframeDoc.querySelectorAll(".PageBreak"));
    const currentPage = GetCurrentPageNumber(myIframe);
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
}

/**
 * Begins a new movement annotation at the position the user right-clicked.
 * Only valid inside Speech or StageDirection paragraphs.
 *
 * @param {MouseEvent} e - The contextmenu event from inside the iframe
 */
function startMovement(e) {
    if (e.target.className !== "Speech" && e.target.className !== "StageDirection") {
        alert("You can only insert a movement in a speech paragraph or a stage direction.");
        return;
    }

    const offset     = GetClickedCharacterPosition(myIframe);
    const newMovement = new Movement(myIframe, imageAreaDiv, dataStore, e.target, offset);
    dataStore.newMovement = newMovement;
    window.focus();
}

// ---------------------------------------------------------------------------
// iframe click listener
// ---------------------------------------------------------------------------

/**
 * Re-attaches the click listener to the iframe body.
 * Must be called after the iframe body is replaced (e.g. on file load).
 */
function iFrameListeners() {
    myIframe.contentDocument.addEventListener("click", scriptOnClick);
}

/**
 * Logs the clicked character position — used during development to verify
 * that the offset calculation is correct.
 *
 * @param {MouseEvent} e
 */
function scriptOnClick(e) {
    const x = GetClickedCharacterPosition(myIframe);
    console.log("Clicked at character offset:", x);
}

// ---------------------------------------------------------------------------
// Iframe selection wrapper (utility — currently not wired to UI)
// ---------------------------------------------------------------------------

/**
 * Wraps the current text selection inside the iframe with a new element.
 * Useful for future annotation features.
 *
 * @param {string} iframeId  - The iframe element id
 * @param {string} tagName   - The tag to wrap with, e.g. "span"
 * @param {string} [className] - Optional CSS class for the wrapper
 */
function wrapIframeSelection(iframeId, tagName, className) {
    const iframe    = document.getElementById(iframeId);
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const selection = iframe.contentWindow.getSelection();

    if (selection.rangeCount > 0) {
        const range   = selection.getRangeAt(0);
        const wrapper = iframeDoc.createElement(tagName);
        if (className) wrapper.className = className;

        try {
            range.surroundContents(wrapper);
        } catch (e) {
            // surroundContents throws if the selection spans block boundaries
            console.error("wrapIframeSelection: selection crosses multiple nodes.", e);
        }
    }
}

// ---------------------------------------------------------------------------
// DOMContentLoaded — entry point
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    // Route to the correct page initialiser based on the body id
    switch (document.body.id) {
        case "playBlockerPage":
            PlayBlockerPageSetup();
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

            if (dataStore.newMovement) {
                // The user right-clicked first (creating a pending movement), then
                // started dragging a speaker icon.  We now know which speaker is moving.
                const initials = event.target.id.split("-").pop();
                const speaker  = speakers.find((s) => s.speakerInitials === initials);

                // Linking the speaker updates the placeholder span in the script text
                dataStore.newMovement.speaker = speaker;

                // Promote newMovement → incompleteMovement (has a speaker, needs a drop)
                dataStore.incompleteMovement = dataStore.newMovement;
                dataStore.incompleteMovement.speakerDiv = event.target;
                dataStore.newMovement = null; // Prevents new movements while dragging

                // Place the shadow icon at the drag-start position
                const shadowDiv = speaker.shadowDiv;
                shadowDiv.style.transform = event.target.style.transform;
                shadowDiv.setAttribute("data-x", event.target.getAttribute("data-x"));
                shadowDiv.setAttribute("data-y", event.target.getAttribute("data-y"));
                shadowDiv.style.zIndex = 100;
                speakerAreaElement.appendChild(shadowDiv);

                dataStore.incompleteMovement.shadowDiv = shadowDiv;
            }
        },

        /**
         * Drag-move: update the icon's position and redraw the connector line.
         */
        move(event) {
            const target   = event.target;
            const x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
            const y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;

            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute("data-x", x);
            target.setAttribute("data-y", y);
            target.style.zIndex = 1000; // Appear on top during drag

            // Redraw the connector line while dragging
            if (dataStore.incompleteMovement) {
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

    ondrop(event) {
        wasDroppedInImageArea  = true;
        event.relatedTarget.onImage = true;

        // Compute proportional position on the stage image
        const rP = createRP(
            event.dragEvent.clientX,
            event.dragEvent.clientY,
            stageImageElement,
            imageAreaDiv
        );

        const speakerDiv = event.relatedTarget;
        const speakerObj = speakerObjFromSpeakerDiv(speakerDiv);
        speakerObj.RP    = rP;

        document.body.style.cursor            = "default";
        myIframe.contentDocument.body.style.cursor = "text";

        // The movement is complete
        if (dataStore.incompleteMovement) {
            dataStore.incompleteMovement = null;
        }
        if (dataStore.newMovement) {
            dataStore.newMovement = null;
            console.log(GetMovementListLog("ondrop", dataStore));
        }
    }

}).on("dropactivate", (event) => {
    event.target.classList.add("drop-activated");
});

// Ensure the dropzone also accepts .draggable elements (belt-and-suspenders)
interact(".dropzone").dropzone({ accept: ".draggable" });