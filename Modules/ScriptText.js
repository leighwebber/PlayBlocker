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