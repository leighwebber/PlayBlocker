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