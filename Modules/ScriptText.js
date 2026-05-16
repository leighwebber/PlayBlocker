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
export function GetPageNumberAtMovement(movement) {
    let el = movement.node.parentElement;
    while (el && el.className !== "PageBreak") {
        el = el.previousElementSibling;
        if (!el || el.tagName.toUpperCase() === "BODY") return null;
    }
    return el ? parseInt(el.innerText.split("Page").pop(), 10) : null;
}
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
export function TotalPageCount(myIframe) {
    const innerDoc   = myIframe.contentDocument || myIframe.contentWindow.document;
    const pageBreaks = innerDoc.querySelectorAll(".PageBreak");
    if (!pageBreaks.length) return 0;
    return parseInt(pageBreaks[pageBreaks.length - 1].innerText.split("Page").pop(), 10);
}
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
