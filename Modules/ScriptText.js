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
