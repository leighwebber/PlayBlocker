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
