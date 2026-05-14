"use strict";

/**
 * Backend.js — PlayBlocker core data and DOM utilities
 *
 * Responsibilities:
 *  - DataStore:     single source of truth for app state
 *  - Speaker:       immutable actor objects with colour/layout helpers
 *  - Movement:      one character-movement annotation in the script
 *  - MovementList:  ordered collection of Movements
 *  - RP:            proportional x/y coordinates independent of window size
 *  - DOM helpers:   createSpeakerDiv, createSvgElement, createCircleElement, createTextElement
 *  - Navigation:    GetCurrentPageNumber, TotalPageCount, GoToPage, GetPageNumberAtCursor, etc.
 */

import { colorNames } from "../Modules/colors.js";

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

/** Flat array of all Speaker objects created for the current production. */
export var speakers = [];

// ---------------------------------------------------------------------------
// DataStore
// ---------------------------------------------------------------------------

/**
 * Central state container for a PlayBlocker session.
 * All mutable app state lives here so it can be serialised / restored.
 */
export class DataStore {
    #script            = { filename: "", htmlContent: "" };
    #currentPage       = null;
    #newMovement       = null;        // A Movement waiting to be linked to a speaker
    #incompleteMovement = null;       // A Movement linked but not yet placed on stage
    #movementList      = null;
    #iFrame            = null;
    speakerAreaHeight  = null;        // Height of the speaker panel; set on init and resize

    /**
     * @param {HTMLIFrameElement} iFrame - The iframe that displays the script HTML.
     */
    constructor(iFrame) {
        this.#iFrame      = iFrame;
        this.#movementList = new MovementList(iFrame, null, this);
    }

    get script()              { return this.#script; }
    set script(v)             { this.#script = v; }

    get currentPage()         { return this.#currentPage; }
    set currentPage(v)        { this.#currentPage = v; }

    /** The Movement created on right-click, waiting for the user to drag a speaker icon. */
    get newMovement()         { return this.#newMovement; }
    set newMovement(v)        { this.#newMovement = v; }

    /** The Movement linked to a speaker but not yet dropped onto the stage image. */
    get incompleteMovement()  { return this.#incompleteMovement; }
    set incompleteMovement(v) { this.#incompleteMovement = v; }

    get movementList() {
        if (!this.#movementList) {
            this.#movementList = new MovementList(this.#iFrame, 0, this);
        }
        return this.#movementList;
    }

    get iFrame()  { return this.#iFrame; }
    set iFrame(v) { this.#iFrame = v; }
}

// ---------------------------------------------------------------------------
// RP — Relative (proportional) Position
// ---------------------------------------------------------------------------

/**
 * Stores a position as fractions of a reference image's width and height.
 * Proportional coordinates survive window resizes.
 *
 * @property {number} rX - Horizontal fraction [0, 1] (0 = left, 1 = right)
 * @property {number} rY - Vertical fraction   [0, 1] (0 = top,  1 = bottom)
 */
export class RP {
    constructor(rx, ry) {
        this.rX = rx;
        this.rY = ry;
    }
}

/**
 * Factory for RP objects.  Supports three call signatures:
 *
 *   createRP(rx, ry)
 *     rx, ry are already proportions — wraps them directly.
 *
 *   createRP(px, py, targetImage)
 *     px, py are pixel offsets from the image top-left corner.
 *
 *   createRP(clientX, clientY, targetImage, containerDiv)
 *     clientX/Y are viewport coordinates; the function subtracts the
 *     image's viewport origin before computing proportions.
 *
 * @param {number}      ax
 * @param {number}      ay
 * @param {HTMLElement} [targetImage]
 * @param {HTMLElement} [containerDiv]
 * @returns {RP}
 */
export function createRP(ax, ay, targetImage = null, containerDiv = null) {
    switch (arguments.length) {
        case 2:
            return new RP(ax, ay);

        case 3: {
            const rect = targetImage.getBoundingClientRect();
            return new RP(ax / rect.width, ay / rect.height);
        }

        case 4: {
            const rect  = targetImage.getBoundingClientRect();
            return createRP(ax - rect.left, ay - rect.top, targetImage);
        }

        default:
            throw new Error("createRP requires 2, 3, or 4 arguments.");
    }
}

// ---------------------------------------------------------------------------
// Colour utilities (module-private)
// ---------------------------------------------------------------------------

/**
 * Returns a lighter (pastel) version of a hex colour by interpolating toward white.
 *
 * @param {string} hex    - Six-digit hex colour, e.g. "#ff0000"
 * @param {number} factor - How far to move toward white: 0 = unchanged, 1 = pure white
 * @returns {string}
 */
function getPalerColorHex(hex, factor = 0.5) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    r = Math.round(r + (255 - r) * factor);
    g = Math.round(g + (255 - g) * factor);
    b = Math.round(b + (255 - b) * factor);

    const toHex = (c) => c.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Chooses black or white text for legible contrast against a background colour.
 * Uses the ITU-R BT.601 luminance formula.
 *
 * @param {string} backgroundColor - Six-digit hex colour
 * @returns {"black"|"white"}
 */
function textColorForBackground(backgroundColor) {
    const r = parseInt(backgroundColor.substring(1, 3), 16);
    const g = parseInt(backgroundColor.substring(3, 5), 16);
    const b = parseInt(backgroundColor.substring(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? "black" : "white";
}

// ---------------------------------------------------------------------------
// Speaker
// ---------------------------------------------------------------------------

/**
 * Represents one character/actor in the production.
 *
 * Instantiation is restricted to Speaker.create() to keep the static
 * placement counter consistent.  Instances are sealed after creation.
 *
 * Key properties:
 *   speakerName / speakerInitials — identity
 *   backgroundColor / textColor   — icon colours
 *   speakerDiv / shadowDiv        — DOM elements managed by PlayBlocker.js
 *   RP                            — proportional position on the stage image (null if not placed)
 */
export class Speaker {
    // Prevent `new Speaker(...)` — callers must use Speaker.create()
    static #isInternal  = false;

    // Class-level counters used for initial vertical stacking in the speaker panel
    static #currentY    = 0;
    static #yIncrement  = 30;
    static #speakerCount = 0;

    #_originalX        = null;
    #_originalY        = null;
    #_speakerDiv       = null;
    #_shadowDiv        = null;
    #_speakerName      = "";
    #_speakerInitials  = "";
    #_backgroundColor;
    #_cx               = 50;   // SVG circle centre X (in viewBox units)
    #_cy               = 50;   // SVG circle centre Y
    #_r                = 40;   // SVG circle radius
    #_RP               = null; // Proportional stage position; null if not yet placed

    // ── Getters / setters ─────────────────────────────────────────────────

    get speakerDiv()       { return this.#_speakerDiv; }
    set speakerDiv(v)      { this.#_speakerDiv = v; }

    get shadowDiv()        { return this.#_shadowDiv; }
    set shadowDiv(v)       { this.#_shadowDiv = v; }

    get originalX()        { return this.#_originalX; }
    set originalX(v)       { this.#_originalX = v; }

    get originalY()        { return this.#_originalY; }
    set originalY(v)       { this.#_originalY = v; }

    get speakerName()      { return this.#_speakerName; }
    get speakerInitials()  { return this.#_speakerInitials; }

    get backgroundColor()  { return this.#_backgroundColor; }
    set backgroundColor(v) { this.#_backgroundColor = v; }

    /** SVG circle geometry — read-only */
    get cx() { return this.#_cx; }
    get cy() { return this.#_cy; }
    get r()  { return this.#_r; }

    /**
     * Calculated text colour (black or white) for contrast against the background.
     * @returns {"black"|"white"}
     */
    get textColor() {
        return textColorForBackground(this.#_backgroundColor);
    }

    /** Proportional position on the stage image, or null if not yet placed. */
    get RP()  { return this.#_RP; }
    set RP(v) { this.#_RP = v; }

    // ── Constructor (private) ─────────────────────────────────────────────

    constructor(spkrName, spkrInitials, bgColor) {
        if (!Speaker.#isInternal) {
            throw new Error("Use Speaker.create() — do not call new Speaker() directly.");
        }
        this.#_speakerName     = spkrName;
        this.#_speakerInitials = spkrInitials;
        // Accept a CSS colour name (e.g. "green") or a hex string (e.g. "#008000")
        this.#_backgroundColor = colorNames[bgColor.toLowerCase()] || bgColor;

        Speaker.#currentY    += Speaker.#yIncrement;
        Speaker.#speakerCount += 1;
    }

    // ── Factory ───────────────────────────────────────────────────────────

    /**
     * Creates and seals a new Speaker instance.
     *
     * @param {string} spkrName     - Full character name, e.g. "Mrs Rogers"
     * @param {string} spkrInitials - Two-letter icon label, e.g. "RS"
     * @param {string} bgColor      - CSS colour name or hex string for the icon background
     * @returns {Speaker}
     */
    static create(spkrName, spkrInitials, bgColor) {
        Speaker.#isInternal = true;
        const instance = new Speaker(spkrName, spkrInitials, bgColor);
        Speaker.#isInternal = false;  // BUG FIX: was previously left as `true`
        Object.seal(instance);
        return instance;
    }
}

// ---------------------------------------------------------------------------
// DOM helpers — speaker icons
// ---------------------------------------------------------------------------

/**
 * Creates the draggable `<div>` element representing a speaker on screen.
 * The div contains an SVG circle icon and is positioned within the speaker panel.
 *
 * divParms is mutated to track the current layout position:
 *   { currentX, currentY, yIncrement, bottomOfColumnY, topOfColumnY }
 *
 * @param {DataStore} dataStore - Provides speakerAreaHeight for column-wrapping
 * @param {Speaker}   aSpeaker
 * @param {object}    divParms  - Mutable layout state (modified in-place)
 * @param {boolean}   isShadow  - If true, creates a ghost/shadow origin marker
 * @returns {HTMLDivElement}
 */
export function createSpeakerDiv(dataStore, aSpeaker, divParms, isShadow) {
    const speakerDiv = document.createElement("div");
    speakerDiv.setAttribute("class", "speaker draggable");

    // Shadow and main icons share the same class but have different id prefixes
    const prefix = isShadow ? "shadow-div-" : "speaker-div-";
    speakerDiv.id = prefix + aSpeaker.speakerInitials;

    speakerDiv.appendChild(createSvgElement(aSpeaker, isShadow));

    // Column-wrap: if we've exceeded the speaker panel height, start a new column
    if (divParms.currentY > dataStore.speakerAreaHeight) {
        divParms.currentY        = 0;
        divParms.bottomOfColumnY = 0;
        divParms.currentX       += 30;
    } else {
        divParms.bottomOfColumnY = Math.max(divParms.bottomOfColumnY, divParms.currentY);
    }

    // Position via CSS transform (Interact.js uses data-x / data-y for tracking)
    speakerDiv.style.transform = `translate(${divParms.currentX}px, ${divParms.currentY}px)`;
    speakerDiv.setAttribute("data-x", divParms.currentX);
    speakerDiv.setAttribute("data-y", divParms.currentY);

    divParms.topOfColumnY = divParms.topOfColumnY || divParms.currentY;

    return speakerDiv;
}

/**
 * Creates the SVG element that renders a coloured circle with the speaker's initials.
 *
 * Uses a 100×100 viewBox (percentage-based coordinates) scaled to 30×30 px.
 * overflow="visible" lets connector lines extend outside the SVG bounds.
 *
 * @param {Speaker} aSpeaker
 * @param {boolean} isShadow - If true, renders a pale ghost version
 * @returns {SVGSVGElement}
 */
export function createSvgElement(aSpeaker, isShadow) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg   = document.createElementNS(svgNS, "svg");

    svg.setAttribute("class",    "speaker-svg");
    svg.setAttribute("width",    "30px");
    svg.setAttribute("height",   "30px");
    svg.setAttribute("viewBox",  "0 0 100 100");
    svg.setAttribute("overflow", "visible");

    svg.appendChild(createCircleElement(aSpeaker, isShadow));
    svg.appendChild(createTextElement(aSpeaker, isShadow));

    return svg;
}

/**
 * Creates the `<circle>` SVG element for a speaker icon.
 *
 * @param {Speaker} aSpeaker
 * @param {boolean} isShadow - Shadow icons use a much paler fill (factor 0.8)
 * @returns {SVGCircleElement}
 */
export function createCircleElement(aSpeaker, isShadow) {
    const svgNS = "http://www.w3.org/2000/svg";
    const circle = document.createElementNS(svgNS, "circle");

    circle.setAttribute("cx", aSpeaker.cx);
    circle.setAttribute("cy", aSpeaker.cy);
    circle.setAttribute("r",  aSpeaker.r);
    circle.setAttribute("fill",
        isShadow ? getPalerColorHex(aSpeaker.backgroundColor, 0.8)
                 : aSpeaker.backgroundColor);

    return circle;
}

/**
 * Creates the `<text>` SVG element showing the speaker's initials inside the circle.
 *
 * @param {Speaker} aSpeaker
 * @param {boolean} isShadow
 * @returns {SVGTextElement}
 */
export function createTextElement(aSpeaker, isShadow) {
    const svgNS = "http://www.w3.org/2000/svg";
    const text  = document.createElementNS(svgNS, "text");

    text.setAttribute("x",                aSpeaker.cx + "%");
    text.setAttribute("y",                aSpeaker.cy + "%");
    text.setAttribute("text-anchor",       "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-size",         "30");

    // Choose text colour based on the effective (possibly lightened) background
    const effectiveBg = isShadow
        ? getPalerColorHex(aSpeaker.backgroundColor)
        : aSpeaker.backgroundColor;
    text.setAttribute("fill", textColorForBackground(effectiveBg));

    text.textContent = aSpeaker.speakerInitials;

    return text;
}

// ---------------------------------------------------------------------------
// SVG line drawing — speaker-to-shadow connector
// ---------------------------------------------------------------------------

/**
 * Creates an SVG `<path>` representing a straight line between two points.
 * Used to draw the connector from a speaker's current position to their shadow.
 *
 * @param {number} x1 - Start X (SVG viewBox units)
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @returns {SVGPathElement}
 */
function createPath(x1, y1, x2, y2) {
    const svgNS = "http://www.w3.org/2000/svg";
    const path  = document.createElementNS(svgNS, "path");
    path.setAttribute("d",     `M ${x1} ${y1} L ${x2} ${y2}`);
    path.setAttribute("class", "connection-line");
    return path;
}

/**
 * Removes any existing connector line from inside a speaker div's SVG child.
 *
 * @param {HTMLElement} speakerDiv
 */
function eraseLine(speakerDiv) {
    speakerDiv.querySelector("svg")?.querySelector("path")?.remove();
}

/**
 * Draws a line inside `fromDiv`'s SVG child, from its centre to `toDiv`'s centre.
 * Coordinates are expressed as a delta so they work within the SVG's local space.
 *
 * @param {HTMLElement} fromDiv - Origin div (line is drawn inside its SVG)
 * @param {HTMLElement} toDiv   - Destination div (the shadow)
 */
function drawLine(fromDiv, toDiv) {
    const fromTransform = fromDiv.attributeStyleMap.get("transform");
    const toTransform   = toDiv.attributeStyleMap.get("transform");

    const xDelta = toTransform[0].x.value - fromTransform[0].x.value;
    const yDelta = toTransform[0].y.value - fromTransform[0].y.value;

    // Line starts at the SVG centre (50, 50) and ends at the delta offset
    fromDiv.querySelector("svg").appendChild(createPath(50, 50, xDelta, yDelta));
}

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

/**
 * Returns the Speaker object associated with a speaker or shadow div.
 * The div id convention is `"speaker-div-XX"` or `"shadow-div-XX"`.
 *
 * @param {HTMLElement} speakerDiv
 * @returns {Speaker|undefined}
 */
export function speakerObjFromSpeakerDiv(speakerDiv) {
    const initials = speakerDiv.id.split("-").pop();
    return speakers.find((s) => s.speakerInitials === initials);
}

// ---------------------------------------------------------------------------
// Script navigation helpers
// ---------------------------------------------------------------------------

/**
 * Returns the total page count of the loaded script.
 * Pages are delimited by elements with class "PageBreak" whose text contains "Page N".
 *
 * @param {HTMLIFrameElement} myIframe
 * @returns {number}
 */
export function TotalPageCount(myIframe) {
    const innerDoc   = myIframe.contentDocument || myIframe.contentWindow.document;
    const pageBreaks = innerDoc.querySelectorAll(".PageBreak");
    if (!pageBreaks.length) return 0;
    return parseInt(pageBreaks[pageBreaks.length - 1].innerText.split("Page").pop(), 10);
}

/**
 * Scrolls the iframe to bring the given page number into view.
 *
 * @param {HTMLIFrameElement} myIframe
 * @param {number}            pageNumber
 */
export function GoToPage(myIframe, pageNumber) {
    const innerDoc   = myIframe.contentDocument || myIframe.contentWindow.document;
    const pageBreaks = Array.from(innerDoc.querySelectorAll(".PageBreak"));
    const target     = pageBreaks.find((el) => el.innerText.includes(String(pageNumber)));
    if (target) {
        target.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
        console.warn(`GoToPage: no PageBreak found for page ${pageNumber}`);
    }
}

/**
 * Returns the page number of the page that contains a given Movement's DOM node.
 * Walks backwards through siblings until a PageBreak element is found.
 *
 * @param {Movement} movement
 * @returns {number|null}
 */
export function GetPageNumberAtMovement(movement) {
    let el = movement.node.parentElement;
    while (el && el.className !== "PageBreak") {
        el = el.previousElementSibling;
        if (!el || el.tagName.toUpperCase() === "BODY") return null;
    }
    return el ? parseInt(el.innerText.split("Page").pop(), 10) : null;
}

/**
 * Returns the page number at the element the user clicked.
 * Walks backwards through siblings from the click target until a PageBreak is found.
 *
 * @param {HTMLIFrameElement} iFrame
 * @param {MouseEvent}        e
 * @returns {number|null}
 */
export function GetPageNumberAtCursor(iFrame, e) {
    const clicked = e.target;
    if (clicked.tagName.toUpperCase() === "BODY") {
        console.warn("GetPageNumberAtCursor: click landed on <body>.");
        return null;
    }

    let el = clicked;
    while (el && el.className !== "PageBreak") {
        el = el.previousElementSibling;
        if (!el || el.nodeName.toUpperCase() === "BODY") return 0;
    }
    return el ? parseInt(el.innerText.split("Page").pop(), 10) : 0;
}

/**
 * Returns the page number currently visible at the top of the iframe viewport.
 * Finds the first visible DOM element then walks backwards to the nearest PageBreak.
 *
 * @param {HTMLIFrameElement} myIframe
 * @returns {number|null}
 */
export function GetCurrentPageNumber(myIframe) {
    const innerDoc       = myIframe.contentDocument || myIframe.contentWindow.document;
    const viewportHeight = myIframe.contentWindow.innerHeight;

    // First visible element in the iframe viewport
    const firstVisible = Array.from(innerDoc.querySelectorAll("body *")).find((el) => {
        const rect = el.getBoundingClientRect();
        return el.checkVisibility() && rect.bottom > 0 && rect.top < viewportHeight;
    });

    if (!firstVisible) return null;

    // Walk backwards to find the nearest preceding PageBreak
    let el = firstVisible;
    while (el && el.className !== "PageBreak") {
        el = el.previousElementSibling;
        if (!el) break;
    }
    return el ? parseInt(el.innerText.split("Page").pop(), 10) : null;
}

/**
 * Returns the movement-marker `<span>` immediately to the left of the cursor
 * in the clicked paragraph, or null if none is found.
 *
 * @param {MouseEvent}        e
 * @param {HTMLIFrameElement} myIframe
 * @param {DataStore}         dataStore
 * @returns {HTMLSpanElement|null}
 */
export function getPreviousMovementMarker(e, myIframe, dataStore) {
    const para  = e.target;
    const spans = para.querySelectorAll("span");
    if (!spans.length) return null;

    const sel = myIframe.contentWindow.getSelection();
    if (!sel.rangeCount) return null;
    const cursorOffset = sel.anchorOffset;

    // Walk spans right-to-left; return the first one whose HTML offset is before the cursor
    for (let i = spans.length - 1; i >= 0; i--) {
        const span       = spans[i];
        const charOffset = para.innerHTML.indexOf(span.outerHTML) - 5;
        if (charOffset <= cursorOffset) return span;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Clicked-character position
// ---------------------------------------------------------------------------

/**
 * Returns the total character offset from the start of the clicked paragraph
 * to the position the user right-clicked in the iframe.
 *
 * Accounts for preceding sibling text nodes and inline elements (e.g. movement spans).
 *
 * @param {HTMLIFrameElement} iFrame
 * @returns {number} Character offset, or 0 on failure
 */
export function GetClickedCharacterPosition(iFrame) {
    const doc   = iFrame.contentDocument;
    const range = doc.caretRangeFromPoint(event.clientX, event.clientY);
    if (!range) return 0;

    const textNode = range.startContainer;
    const offset   = range.startOffset;

    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        let total = offset;
        let node  = textNode;
        while (node.previousSibling) {
            node   = node.previousSibling;
            total += node.textContent.length;
        }
        return total;
    }

    console.error("GetClickedCharacterPosition: click was not inside a text node.");
    return 0;
}

// ---------------------------------------------------------------------------
// HTML offset mapping (module-private)
// ---------------------------------------------------------------------------

/**
 * Converts a Selection-API text offset to an index into element.innerHTML.
 *
 * The Selection API counts only visible text characters; innerHTML also contains
 * angle-bracket tag markup.  We scan character-by-character, skipping anything
 * inside `<…>`, until `offset` visible characters have been consumed.
 *
 * @param {HTMLElement} element - Paragraph whose innerHTML we scan
 * @param {number}      offset  - Text-character offset from the Selection API
 * @returns {number}            - Corresponding index into element.innerHTML
 */
function GetHtmlOffsetFromTextOffset(element, offset) {
    const html    = element.innerHTML;
    let   inTag   = false;
    let   idx     = 0;
    let   remaining = offset;

    while (remaining > -1 && idx < html.length) {
        const ch = html[idx];
        if (ch === "<")            inTag = true;
        if (!inTag)                remaining -= 1;
        if (inTag && ch === ">")   inTag = false;
        idx += 1;
    }
    return idx;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * Represents one character-movement annotation in the script.
 *
 * Lifecycle:
 *   1. User right-clicks in a Speech/StageDirection paragraph
 *      → `new Movement(…)` inserts `<span class="m-new">[?]</span>` at the cursor
 *   2. User drags a speaker icon (drag-start)
 *      → `movement.speaker = speaker` updates the span to `[XX]` and class to "m-normal"
 *   3. User drops the icon onto the stage image
 *      → The drop handler records the RP position on the speaker object
 *   4. User presses Escape at step 2 or 3
 *      → Caller removes the span and sets dataStore.newMovement = null
 */
export class Movement {
    #_iFrame        = null;
    #_dataStore     = null;
    #_speakerDiv    = null;
    #_imageAreaDiv  = null;
    #_shadowDiv     = null;
    #_element       = null;   // The paragraph that was right-clicked
    #_offset        = null;   // Text character offset within that paragraph
    #_id            = null;   // Unique id, e.g. "m-3"
    #_pending       = true;   // True until the drop is completed
    #_span          = null;   // The <span> injected into the script DOM
    #speaker        = null;   // The Speaker (set when drag starts)

    /**
     * @param {HTMLIFrameElement} iFrame
     * @param {HTMLElement}       imageAreaDiv      - The div wrapping the stage image
     * @param {DataStore}         dataStore
     * @param {HTMLElement}       containingElement - The paragraph that was right-clicked
     * @param {number}            offset            - Text character offset of the click
     */
    constructor(iFrame, imageAreaDiv, dataStore, containingElement, offset) {
        this.#_iFrame       = iFrame;
        this.#_dataStore    = dataStore;
        this.#_imageAreaDiv = imageAreaDiv;
        this.#_element      = containingElement;
        this.#_offset       = offset;

        // Register with the movement list and assign an id
        const mList     = dataStore.movementList;
        const nextIndex = mList.count();
        mList.add(nextIndex, this);
        this.#_id = "m-" + mList.count();

        // Insert a placeholder span into the script at the cursor position
        this.#_span             = this.iFrameDoc.createElement("span");
        this.#_span.textContent = "[?]";
        this.#_span.className   = "m-new";
        this.#_span.id          = this.#_id;

        const htmlOffset = GetHtmlOffsetFromTextOffset(containingElement, offset);
        const html       = containingElement.innerHTML;
        containingElement.innerHTML =
            html.substring(0, htmlOffset) +
            this.#_span.outerHTML +
            html.substring(htmlOffset);
    }

    // ── Getters ───────────────────────────────────────────────────────────

    get imageAreaDiv() { return this.#_imageAreaDiv; }

    /** Shortcut to the iframe's contentDocument. */
    get iFrameDoc()    { return this.#_iFrame.contentDocument; }

    /** Re-queries the span each time in case the DOM has been re-serialised. */
    get node()         { return this.iFrameDoc.getElementById(this.#_id); }

    // ── speaker ───────────────────────────────────────────────────────────

    get speaker() { return this.#speaker; }

    /**
     * Assigns the speaker to this movement.
     * Updates the placeholder span from "[?]" to "[XX]" and changes its CSS class.
     *
     * @param {Speaker} value
     */
    set speaker(value) {
        this.#speaker = value;
        const span = this.iFrameDoc.getElementById(this.#_id);
        if (span) {
            span.className = "m-normal";
            span.innerHTML = `[${value.speakerInitials}]`;
        }
    }

    // ── speakerDiv / shadowDiv ────────────────────────────────────────────

    get speakerDiv()  { return this.#_speakerDiv; }
    set speakerDiv(v) { this.#_speakerDiv = v; }

    get shadowDiv()   { return this.#_shadowDiv; }
    set shadowDiv(v)  { this.#_shadowDiv = v; }

    // ── Methods ───────────────────────────────────────────────────────────

    /**
     * Redraws the connector line from the speaker div to the shadow div.
     * Called on every drag-move event while a movement is in progress.
     */
    drawLines() {
        eraseLine(this.speakerDiv);
        drawLine(this.speakerDiv, this.shadowDiv);
    }
}

// ---------------------------------------------------------------------------
// MovementList
// ---------------------------------------------------------------------------

/**
 * Ordered collection of Movement objects for the current session.
 *
 * Backed by a Map (key = sequential integer) and a parallel _items array
 * for index-based access used by the debug log.
 */
export class MovementList {
    #movements = new Map();
    #myIframe  = null;
    #dataStore = null;
    #pageCount = 0;
    #pageSeqs  = [{ page: 0, seq: 0 }]; // Last sequence number used per page

    /** Flat array mirroring the Map — provides index-based access. */
    _items = [];

    /**
     * @param {HTMLIFrameElement} myIframe
     * @param {number|null}       startPage
     * @param {DataStore}         dataStore
     */
    constructor(myIframe, startPage, dataStore) {
        this._startPage = startPage;
        this.#myIframe  = myIframe;
        this.#dataStore = dataStore;
    }

    /**
     * Adds a movement.
     * @param {number}   key
     * @param {Movement} value
     */
    add(key, value) {
        this.#movements.set(key, value);
        this._items.push(value);
    }

    /**
     * Replaces the movement at `key`.
     * @param {number}   key
     * @param {Movement} newValue
     */
    changeValue(key, newValue) {
        if (!this.#movements.has(key)) {
            throw new Error(`MovementList: no entry for key ${key}`);
        }
        this.#movements.set(key, newValue);
        // Keep _items in sync
        const idx = this._items.findIndex((m) => m === this.get(key));
        if (idx !== -1) this._items[idx] = newValue;
    }

    get(key)    { return this.#movements.get(key); }
    count()     { return this.#movements.size; }

    delete(key) {
        if (!this.#movements.has(key)) {
            throw new Error(`MovementList: no entry for key ${key}`);
        }
        this.#movements.delete(key);
    }

    forEach(cb) { this.#movements.forEach((v, k) => cb(v, k)); }
    entries()   { return this.#movements.entries(); }
    keys()      { return this.#movements.keys(); }
    values()    { return this.#movements.values(); }

    /**
     * Groups movements by speaker initials.
     * @returns {Map}
     */
    speakerMap() {
        return Map.groupBy(this.#movements, ({ initials }) => initials);
    }
}

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable snapshot of the movement list — for development use.
 *
 * @param {string}    from      - Label identifying the call site
 * @param {DataStore} dataStore
 * @returns {string}
 */
export function GetMovementListLog(from, dataStore) {
    const items = dataStore.movementList._items;
    let log = `[${from}]\n`;
    for (let i = 0; i < items.length; i++) {
        const m    = items[i];
        const next = m.next > -1 ? items[m.next]?.id : null;
        const prev = m.prev > -1 ? items[m.prev]?.id : null;
        log += `      index: ${i} id: ${m.id} prev: ${m.prev} (${prev}) next: ${m.next} (${next})\n`;
    }
    return log;
}