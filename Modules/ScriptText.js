export function getCurrentPageNumber(myIframe) {
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

export function getPageNumberAtCursor(iFrame, e) {
    const clicked = e.target;
    if (clicked.tagName.toUpperCase() === "BODY") {
        console.warn("getPageNumberAtCursor: click landed on <body>.");
        return null;
    }

    let el = clicked;
    while (el && el.className !== "PageBreak") {
        el = el.previousElementSibling;
        if (!el || el.nodeName.toUpperCase() === "BODY") return 0;
    }
    return el ? parseInt(el.innerText.split("Page").pop(), 10) : 0;
}

export function getPageNumberAtMovement(movement) {
    let el = movement.node.parentElement;
    while (el && el.className !== "PageBreak") {
        el = el.previousElementSibling;
        if (!el || el.tagName.toUpperCase() === "BODY") return null;
    }
    return el ? parseInt(el.innerText.split("Page").pop(), 10) : null;
}

export function getClickedCharacterPosition(iFrame) {
    const doc   = iFrame.contentDocument;
    const range = doc.caretRangeFromPoint(event.clientX, event.clientY);
    if (!range) return 0;

    const textNode = range.startContainer;
    const offset   = range.startOffset;

    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        // Sum offsets of preceding siblings to get absolute position in the paragraph
        let total = offset;
        let node  = textNode;
        while (node.previousSibling) {
            node   = node.previousSibling;
            total += node.textContent.length;
        }

        // Snap to word boundary: insert at the START of the clicked word, or —
        // if the click landed on whitespace — at the start of the next word to the right.
        //
        //   Mid-word  → walk left until whitespace or string start  (word start)
        //   Whitespace → walk right until non-whitespace             (next word start)
        const paraText = textNode.parentElement.closest(".Speech, .StageDirection")?.textContent ?? "";

        if (paraText.length > 0) {
            if (/\S/.test(paraText[total] ?? "")) {
                // Inside a word — back up to its start
                while (total > 0 && /\S/.test(paraText[total - 1])) {
                    total -= 1;
                }
            } else {
                // On whitespace — advance to the next word
                while (total < paraText.length && /\s/.test(paraText[total])) {
                    total += 1;
                }
            }
        }

        return total;
    }

    console.error("getClickedCharacterPosition: click was not inside a text node.");
    return 0;
}

export function getTotalPageCount(myIframe) {
    const innerDoc   = myIframe.contentDocument || myIframe.contentWindow.document;
    const pageBreaks = innerDoc.querySelectorAll(".PageBreak");
    if (!pageBreaks.length) return 0;
    return parseInt(pageBreaks[pageBreaks.length - 1].innerText.split("Page").pop(), 10);
}

export function goToPage(myIframe, pageNumber) {
    const innerDoc   = myIframe.contentDocument || myIframe.contentWindow.document;
    const pageBreaks = Array.from(innerDoc.querySelectorAll(".PageBreak"));
    const target     = pageBreaks.find((el) => el.innerText.includes(String(pageNumber)));
    if (target) {
        target.scrollIntoView({ behavior: "auto", block: "start" });
    } else {
        console.warn(`goToPage: no PageBreak found for page ${pageNumber}`);
    }
}