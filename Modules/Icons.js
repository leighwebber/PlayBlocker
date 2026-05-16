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
 * Returns a lighter (pastel) version of a hex colour by interpolating toward white.
 *
 * @param {string} hex    - Six-digit hex colour, e.g. "#ff0000"
 * @param {number} factor - How far to move toward white: 0 = unchanged, 1 = pure white
 * @returns {string}
 */

function getPalerColorHex(hex, factor = 0.5) {
export function getPalerColorHex(hex, factor = 0.5) {
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
// Colour utilities (module-private)
// ---------------------------------------------------------------------------

/**
 * Returns a lighter (pastel) version of a hex colour by interpolating toward white.
 *
 * @param {string} hex    - Six-digit hex colour, e.g. "#ff0000"
 * @param {number} factor - How far to move toward white: 0 = unchanged, 1 = pure white
 * @returns {string}
 */

/**
 * Chooses black or white text for legible contrast against a background colour.
 * Uses the ITU-R BT.601 luminance formula.
 *
 * @param {string} backgroundColor - Six-digit hex colour
 * @returns {"black"|"white"}
 */
export function textColorForBackground(backgroundColor) {
    const r = parseInt(backgroundColor.substring(1, 3), 16);
    const g = parseInt(backgroundColor.substring(3, 5), 16);
    const b = parseInt(backgroundColor.substring(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? "black" : "white";
}
