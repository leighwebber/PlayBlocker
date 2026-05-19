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
 *  - Navigation:    getCurrentPageNumber, getTotalPageCount, goToPage, getPageNumberAtCursor, etc.
 */

import { colorNames } from "../Modules/colors.js";
import { createCircleElement, textColorForBackground, getPalerColorHex } from "../Modules/Icons.js";
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
    #script             = { filename: "", htmlContent: "" };
    #currentPage        = null;
    #newMovement        = null;        // A Movement waiting to be linked to a speaker
    #incompleteMovement = null;        // A Movement linked but not yet placed on stage
    #movementList       = null;
    #iFrame             = null;
    speakerAreaHeight   = null;        // Height of the speaker panel; set on init and resize

    /**
     * @param {HTMLIFrameElement} iFrame - The iframe that displays the script HTML.
     */
    constructor(iFrame) {
        this.#iFrame       = iFrame;
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
            const rect = targetImage.getBoundingClientRect();
            return createRP(ax - rect.left, ay - rect.top, targetImage);
        }

        default:
            throw new Error("createRP requires 2, 3, or 4 arguments.");
    }
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
 *   speakerFirstName / speakerLastName / speakerInitials — identity
 *   backgroundColor / textColor   — icon colours
 *   speakerDiv / shadowDiv        — DOM elements managed by PlayBlocker.js
 *   rp                            — proportional position on the stage image (null if not placed)
 */
export class Speaker {
    // Prevent `new Speaker(...)` — callers must use Speaker.create()
    static #isInternal   = false;

    // Class-level counters used for initial vertical stacking in the speaker panel
    static #currentY     = 0;
    static #yIncrement   = 30;
    static #speakerCount = 0;

    #originalX        = null;
    #originalY        = null;
    #onImage          = false;
    #speakerDiv       = null;
    #shadowDiv        = null;
    #speakerFirstName      = "";
    #speakerLastName      = "";
    #speakerInitials  = "";
    #backgroundColor;
    #cx               = 50;   // SVG circle centre X (in viewBox units)
    #cy               = 50;   // SVG circle centre Y
    #r                = 40;   // SVG circle radius
    #rp               = null; // Proportional stage position; null if not yet placed
    #dbId             = null; // Server-assigned primary key from the speakers table

    // ── Getters / setters ─────────────────────────────────────────────────

    get speakerDiv()       { return this.#speakerDiv; }
    set speakerDiv(v)      { this.#speakerDiv = v; }

    get shadowDiv()        { return this.#shadowDiv; }
    set shadowDiv(v)       { this.#shadowDiv = v; }

    get onImage()        { return this.#onImage; }
    set onImage(v)       { this.#onImage = v; }

    get originalX()        { return this.#originalX; }
    set originalX(v)       { this.#originalX = v; }

    get originalY()        { return this.#originalY; }
    set originalY(v)       { this.#originalY = v; }

    get speakerFirstName()      { return this.#speakerFirstName; }
    get speakerLastName()      { return this.#speakerLastName; }
    get speakerInitials()  { return this.#speakerInitials; }

    get backgroundColor()  { return this.#backgroundColor; }
    set backgroundColor(v) { this.#backgroundColor = v; }

    /** SVG circle geometry — read-only */
    get cx() { return this.#cx; }
    get cy() { return this.#cy; }
    get r()  { return this.#r; }

    /**
     * Calculated text colour (black or white) for contrast against the background.
     * @returns {"black"|"white"}
     */
    get textColor() {
        return textColorForBackground(this.#backgroundColor);
    }

    /** Proportional position on the stage image, or null if not yet placed. */
    get RP()    { return this.#rp; }
    set RP(v)   { this.#rp = v; }

    /** Server-assigned primary key from the speakers table; null until fetched. */
    get dbId()  { return this.#dbId; }
    set dbId(v) { this.#dbId = v; }

    // ── Constructor (private) ─────────────────────────────────────────────

    constructor(speakerFirstName, speakerLastName, speakerInitials, bgColor) {
        if (!Speaker.#isInternal) {
            throw new Error("Use Speaker.create() — do not call new Speaker() directly.");
        }
        this.#speakerFirstName     = speakerFirstName;
        this.#speakerLastName     = speakerLastName;
        this.#speakerInitials = speakerInitials;
        // Accept a CSS colour name (e.g. "green") or a hex string (e.g. "#008000")
        this.#backgroundColor = colorNames[bgColor.toLowerCase()] || bgColor;

        Speaker.#currentY    += Speaker.#yIncrement;
        Speaker.#speakerCount += 1;
    }

    // ── Factory ───────────────────────────────────────────────────────────

    /**
     * Creates and seals a new Speaker instance.
     *
     * @param {string} speakerFirstName - speaker first name
     * @param {string} speakerLastName - speaker last name
     * @param {string} speakerInitials - Two-letter icon label, e.g. "RS"
     * @param {string} bgColor         - CSS colour name or hex string for the icon background
     * @returns {Speaker}
     */
    static create(speakerFirstName, speakerLastName, speakerInitials, bgColor) {
        Speaker.#isInternal = true;
        const instance = new Speaker(speakerFirstName, speakerLastName, speakerInitials, bgColor);
        Speaker.#isInternal = false;
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
 * divParams is mutated to track the current layout position:
 *   { currentX, currentY, yIncrement, bottomOfColumnY, topOfColumnY }
 *
 * @param {DataStore} dataStore  - Provides speakerAreaHeight for column-wrapping
 * @param {Speaker}   speaker
 * @param {object}    divParams  - Mutable layout state (modified in-place)
 * @param {boolean}   isShadow   - If true, creates a ghost/shadow origin marker
 * @returns {HTMLDivElement}
 */
export function createSpeakerDiv(dataStore, speaker, divParams, isShadow) {
    const speakerDiv = document.createElement("div");
    speakerDiv.setAttribute("class", "speaker draggable");

    // Shadow and main icons share the same class but have different id prefixes
    const prefix = isShadow ? "shadow-div-" : "speaker-div-";
    speakerDiv.id = prefix + speaker.speakerInitials;

    speakerDiv.appendChild(createSvgElement(speaker, isShadow));

    // Column-wrap: if we've exceeded the speaker panel height, start a new column
    if (divParams.currentY > dataStore.speakerAreaHeight) {
        divParams.currentY        = 0;
        divParams.bottomOfColumnY = 0;
        divParams.currentX       += 30;
    } else {
        divParams.bottomOfColumnY = Math.max(divParams.bottomOfColumnY, divParams.currentY);
    }

    // Position via CSS transform (Interact.js uses data-x / data-y for tracking)
    speakerDiv.style.transform = `translate(${divParams.currentX}px, ${divParams.currentY}px)`;
    speakerDiv.setAttribute("data-x", divParams.currentX);
    speakerDiv.setAttribute("data-y", divParams.currentY);

    divParams.topOfColumnY = divParams.topOfColumnY || divParams.currentY;

    return speakerDiv;
}

/**
 * Creates the SVG element that renders a coloured circle with the speaker's initials.
 *
 * Uses a 100×100 viewBox (percentage-based coordinates) scaled to 30×30 px.
 * overflow="visible" lets connector lines extend outside the SVG bounds.
 *
 * @param {Speaker} speaker
 * @param {boolean} isShadow - If true, renders a pale ghost version
 * @returns {SVGSVGElement}
 */
export function createSvgElement(speaker, isShadow) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg   = document.createElementNS(svgNS, "svg");

    svg.setAttribute("class",    "speaker-svg");
    svg.setAttribute("width",    "30px");
    svg.setAttribute("height",   "30px");
    svg.setAttribute("viewBox",  "0 0 100 100");
    svg.setAttribute("overflow", "visible");

    svg.appendChild(createCircleElement(speaker, isShadow));
    svg.appendChild(createTextElement(speaker, isShadow));

    return svg;
}

/**
 * Creates the `<text>` SVG element showing the speaker's initials inside the circle.
 *
 * @param {Speaker} speaker
 * @param {boolean} isShadow
 * @returns {SVGTextElement}
 */
export function createTextElement(speaker, isShadow) {
    const svgNS = "http://www.w3.org/2000/svg";
    const text  = document.createElementNS(svgNS, "text");

    text.setAttribute("x",                speaker.cx + "%");
    text.setAttribute("y",                speaker.cy + "%");
    text.setAttribute("text-anchor",       "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-size",         "30");

    // Choose text colour based on the effective (possibly lightened) background
    const effectiveBg = isShadow
        ? getPalerColorHex(speaker.backgroundColor)
        : speaker.backgroundColor;
    text.setAttribute("fill", textColorForBackground(effectiveBg));

    text.textContent = speaker.speakerInitials;

    return text;
}

// ---------------------------------------------------------------------------
// SVG line drawing — speaker-to-shadow connector and movement-marker chain
// ---------------------------------------------------------------------------

/** Size of the rendered SVG for speaker/shadow icons, in pixels. */
const ICON_RENDERED_PX  = 30;

/** ViewBox size of speaker/shadow SVGs. */
const ICON_VIEWBOX_SIZE = 100;

/** Rendered pixel size of a movement-marker div/SVG. */
const MARKER_RENDERED_PX  = 10;

/** ViewBox size of movement-marker SVGs. */
const MARKER_VIEWBOX_SIZE = 10;

/**
 * Returns the local-centre coordinates (in viewBox units) for a div that
 * participates in the connector chain.
 *
 * Speaker/shadow divs use a 100×100 viewBox with the circle at (50, 50).
 * Movement-marker divs use a 10×10 viewBox with the square at (5, 5).
 *
 * @param {HTMLElement} div
 * @returns {{ cx: number, cy: number, renderedPx: number, viewBoxSize: number }}
 */
function divGeometry(div) {
    if (div.classList.contains("movement-marker")) {
        return { cx: 5, cy: 5, renderedPx: MARKER_RENDERED_PX, viewBoxSize: MARKER_VIEWBOX_SIZE };
    }
    return { cx: 50, cy: 50, renderedPx: ICON_RENDERED_PX, viewBoxSize: ICON_VIEWBOX_SIZE };
}

/**
 * Creates an SVG `<path>` representing a straight line between two points.
 *
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
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
 * Removes any existing connector line from inside a div's SVG child.
 *
 * @param {HTMLElement} div - A speaker div, shadow div, or movement-marker div
 */
function eraseLine(div) {
    div.querySelector("svg")?.querySelector("path")?.remove();
}

/**
 * Draws a connector line inside `fromDiv`'s SVG, from its local centre point
 * toward `toDiv`'s centre point.
 *
 * Both divs share the same positioned parent and are located by their
 * `data-x` / `data-y` pixel attributes.  The line is expressed in `fromDiv`'s
 * SVG viewBox coordinate space, so pixel distances are scaled accordingly.
 *
 * Works for any combination of speaker divs (viewBox 100×100, rendered 30 px)
 * and movement-marker divs (viewBox 10×10, rendered 10 px).
 *
 * @param {HTMLElement} fromDiv
 * @param {HTMLElement} toDiv
 */
function drawLine(fromDiv, toDiv) {
    const fromGeo = divGeometry(fromDiv);
    const toGeo   = divGeometry(toDiv);

    const fromX = parseFloat(fromDiv.getAttribute("data-x")) || 0;
    const fromY = parseFloat(fromDiv.getAttribute("data-y")) || 0;
    const toX   = parseFloat(toDiv.getAttribute("data-x"))   || 0;
    const toY   = parseFloat(toDiv.getAttribute("data-y"))   || 0;

    // Pixel position of each div's visual centre within the shared parent
    const fromCentrePixelX = fromX + fromGeo.renderedPx / 2;
    const fromCentrePixelY = fromY + fromGeo.renderedPx / 2;
    const toCentrePixelX   = toX   + toGeo.renderedPx   / 2;
    const toCentrePixelY   = toY   + toGeo.renderedPx   / 2;

    // Convert the pixel delta into fromDiv's viewBox units
    const scale = fromGeo.viewBoxSize / fromGeo.renderedPx;
    const x2 = fromGeo.cx + (toCentrePixelX - fromCentrePixelX) * scale;
    const y2 = fromGeo.cy + (toCentrePixelY - fromCentrePixelY) * scale;

    fromDiv.querySelector("svg").appendChild(createPath(fromGeo.cx, fromGeo.cy, x2, y2));
}

// ---------------------------------------------------------------------------
// Movement marker
// ---------------------------------------------------------------------------

/**
 * Creates a small square "movement marker" div positioned at the given pixel
 * coordinates within the speaker area.
 *
 * The div contains a tiny SVG (10×10 viewBox, 10×10 px rendered) with
 * `overflow="visible"` so connector lines can extend beyond its bounds.
 * It receives the CSS class `movement-marker` so `divGeometry()` can
 * distinguish it from speaker/shadow divs.
 *
 * @param {number} x       - `data-x` pixel position (translate X) in the parent
 * @param {number} y       - `data-y` pixel position (translate Y) in the parent
 * @param {string} color   - Fill colour for the square (matches the speaker)
 * @param {number} [index] - Sequential index used for the element id
 * @returns {HTMLDivElement}
 */
export function createMovementMarkerDiv(x, y, color, index = 0) {
    const svgNS = "http://www.w3.org/2000/svg";

    // Outer div — same positioning contract as speaker/shadow divs
    const div = document.createElement("div");
    div.classList.add("movement-marker");
    div.id = `movement-marker-${index}`;
    div.style.position  = "absolute";
    div.style.top       = "0";
    div.style.left      = "0";
    div.style.width     = `${MARKER_RENDERED_PX}px`;
    div.style.height    = `${MARKER_RENDERED_PX}px`;
    div.style.transform = `translate(${x}px, ${y}px)`;
    div.setAttribute("data-x", x);
    div.setAttribute("data-y", y);
    div.style.zIndex        = "200";
    div.style.pointerEvents = "none";

    // SVG containing a small filled square
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width",    `${MARKER_RENDERED_PX}px`);
    svg.setAttribute("height",   `${MARKER_RENDERED_PX}px`);
    svg.setAttribute("viewBox",  `0 0 ${MARKER_VIEWBOX_SIZE} ${MARKER_VIEWBOX_SIZE}`);
    svg.setAttribute("overflow", "visible");

    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x",            "1");
    rect.setAttribute("y",            "1");
    rect.setAttribute("width",        "8");
    rect.setAttribute("height",       "8");
    rect.setAttribute("fill",         color);
    rect.setAttribute("stroke",       "black");
    rect.setAttribute("stroke-width", "0.5");

    svg.appendChild(rect);
    div.appendChild(svg);
    return div;
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
function getHtmlOffsetFromTextOffset(element, offset) {
    const html = element.innerHTML;
    let inTag    = false;
    let idx      = 0;
    let remaining = offset;

    while (remaining > 0 && idx < html.length) {
        const ch = html[idx];
        if (ch === "<")           inTag = true;
        if (!inTag)               remaining -= 1;
        if (inTag && ch === ">")  inTag = false;
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
    #iFrame        = null;
    #dataStore     = null;
    #speakerDiv    = null;
    #imageAreaDiv  = null;
    #shadowDiv     = null;
    #element       = null;   // The paragraph that was right-clicked
    #offset        = null;   // Text character offset within that paragraph
    #id            = null;   // Unique id, e.g. "m-3"
    #pending       = true;   // True until the drop is completed
    #span          = null;   // The <span> injected into the script DOM
    #speaker       = null;   // The Speaker (set when drag starts)
    #shadowRP      = null;   // Proportional position of the shadow (movement start point)

    /**
     * Ordered list of movement-marker divs placed along the path via the spacebar.
     * Index 0 is the marker closest to the shadow; the last entry is closest to the speaker.
     * @type {HTMLElement[]}
     */
    movementMarkers = [];

    /** Snapshot of all speaker RPs at the moment this movement's drop completes. */
    speakerPositions = null;

    /**
     * @param {HTMLIFrameElement} iFrame
     * @param {HTMLElement}       imageAreaDiv      - The div wrapping the stage image
     * @param {DataStore}         dataStore
     * @param {HTMLElement}       containingElement - The paragraph that was right-clicked
     * @param {number}            offset            - Text character offset of the click
     */
    constructor(iFrame, imageAreaDiv, dataStore, containingElement, offset) {
        this.#iFrame       = iFrame;
        this.#dataStore    = dataStore;
        this.#imageAreaDiv = imageAreaDiv;
        this.#element      = containingElement;
        this.#offset       = offset;

        // Register with the movement list and assign an id
        const mList     = dataStore.movementList;
        const nextIndex = mList.count();
        mList.add(nextIndex, this);
        this.#id = "m-" + mList.count();

        // Insert a placeholder span into the script at the cursor position
        this.#span             = this.iFrameDoc.createElement("span");
        this.#span.textContent = "[?]";
        this.#span.className   = "m-new";
        this.#span.id          = this.#id;

        const htmlOffset = getHtmlOffsetFromTextOffset(containingElement, offset);
        const html       = containingElement.innerHTML;
        containingElement.innerHTML =
            html.substring(0, htmlOffset) +
            this.#span.outerHTML +
            html.substring(htmlOffset);
    }

    // ── Getters ───────────────────────────────────────────────────────────

    get imageAreaDiv() { return this.#imageAreaDiv; }

    /** Shortcut to the iframe's contentDocument. */
    get iFrameDoc()    { return this.#iFrame.contentDocument; }

    /** Re-queries the span each time in case the DOM has been re-serialised. */
    get node()         { return this.iFrameDoc.getElementById(this.#id); }

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
        const span = this.iFrameDoc.getElementById(this.#id);
        if (span) {
            span.className = "m-normal";
            span.innerHTML = `[${value.speakerInitials}]`;
        }
    }

    // ── speakerDiv / shadowDiv ────────────────────────────────────────────

    get speakerDiv()  { return this.#speakerDiv; }
    set speakerDiv(v) { this.#speakerDiv = v; }

    get shadowDiv()   { return this.#shadowDiv; }
    set shadowDiv(v)  { this.#shadowDiv = v; }

    /** Proportional position of the shadow icon (the movement's start point on stage). */
    get shadowRP()    { return this.#shadowRP; }
    set shadowRP(v)   { this.#shadowRP = v; }

    /** The paragraph element that was right-clicked to create this movement. */
    get containingPara() { return this.#element; }

    /** Text character offset within the paragraph at the time of the right-click. */
    get clickOffset()    { return this.#offset; }

    // ── Methods ───────────────────────────────────────────────────────────

    /**
     * Redraws the full connector chain each time the speaker is moved.
     *
     * Chain order: shadowDiv → marker[0] → marker[1] → … → marker[n] → speakerDiv
     *
     * Each segment is drawn inside the *from* div's SVG (which has overflow="visible"),
     * so only the leading line (from the last waypoint to the speaker) needs erasing
     * and redrawing on every move event.  Lines between fixed waypoints are permanent
     * once drawn and never erased.
     *
     * Called on every drag-move event while a movement is in progress.
     */
    drawLines() {
        // The final leg is always from the last fixed waypoint to the moving speakerDiv.
        // Erase and redraw only that segment.
        const lastFixed = this.movementMarkers.length > 0
            ? this.movementMarkers[this.movementMarkers.length - 1]
            : this.shadowDiv;

        eraseLine(lastFixed);
        drawLine(lastFixed, this.speakerDiv);
    }

    /**
     * Erases and redraws every segment in the full connector chain.
     *
     * Called after a window resize, when speaker/shadow positions may have changed.
     * Unlike drawLines(), this redraws ALL segments — not just the trailing one —
     * because every waypoint's position is final for completed movements.
     *
     * Chain: shadowDiv → marker[0] → … → marker[n] → speakerDiv
     */
    redrawAllLines() {
        if (!this.speakerDiv || !this.shadowDiv) return;

        const chain = [this.shadowDiv, ...this.movementMarkers, this.speakerDiv];

        for (let i = 0; i < chain.length - 1; i++) {
            eraseLine(chain[i]);
            drawLine(chain[i], chain[i + 1]);
        }
    }

    /**
     * Called when the user presses spacebar during a drag.
     * Freezes the current speakerDiv position as a new movement marker, draws the
     * permanent segment from the previous waypoint to the new marker, and hands the
     * live trailing line off to the new marker.
     *
     * @param {HTMLElement} markerDiv - The newly created movement-marker div,
     *                                  already appended to the image-area and
     *                                  positioned at the speakerDiv's current location.
     */
    addMarker(markerDiv) {
        const prevFixed = this.movementMarkers.length > 0
            ? this.movementMarkers[this.movementMarkers.length - 1]
            : this.shadowDiv;

        // Erase the live trailing line that was running from prevFixed → speakerDiv
        eraseLine(prevFixed);

        // Draw the now-permanent segment from the previous waypoint to the new marker
        drawLine(prevFixed, markerDiv);

        // Register the marker; the next drawLines() call will trail from it
        this.movementMarkers.push(markerDiv);
    }
}

// ---------------------------------------------------------------------------
// MovementList
// ---------------------------------------------------------------------------

/**
 * Ordered collection of Movement objects for the current session.
 *
 * Backed by a Map (key = sequential integer) and a parallel #items array
 * for index-based access used by the debug log.
 */
export class MovementList {
    #movements = new Map();
    #myIframe  = null;
    #dataStore = null;
    #pageCount = 0;
    #pageSeqs  = [{ page: 0, seq: 0 }]; // Last sequence number used per page

    /** Flat array mirroring the Map — provides index-based access. */
    #items = [];

    /**
     * @param {HTMLIFrameElement} myIframe
     * @param {number|null}       startPage
     * @param {DataStore}         dataStore
     */
    constructor(myIframe, startPage, dataStore) {
        this.startPage  = startPage;
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
        this.#items.push(value);
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
        // Keep #items in sync
        const idx = this.#items.findIndex((m) => m === this.get(key));
        if (idx !== -1) this.#items[idx] = newValue;
    }

    get(key)    { return this.#movements.get(key); }
    count()     { return this.#movements.size; }

    /** Read-only access to the items array (used by getMovementListLog). */
    get items() { return this.#items; }

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
export function getMovementListLog(from, dataStore) {
    const items = dataStore.movementList.items;
    let log = `[${from}]\n`;
    for (let i = 0; i < items.length; i++) {
        const m    = items[i];
        const next = m.next > -1 ? items[m.next]?.id : null;
        const prev = m.prev > -1 ? items[m.prev]?.id : null;
        log += `      index: ${i} id: ${m.id} prev: ${m.prev} (${prev}) next: ${m.next} (${next})\n`;
    }
    return log;
}