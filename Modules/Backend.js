"use strict";

import { colorNames } from "../Modules/colors.js";
// Provides a data store for the PlayBlocker app. Current implementation is a JSON file that the
// user can download or upload via the web page
export var speakers = []; // Global array to store speaker objects

export class DataStore {
    #script = {filename: "", htmlContent: ''};
    #currentPage =  null;
    #newMovement = null;
    #incompleteMovement = null;
    #movementList = null;
    #iFrame = null;

    constructor (iFrame){
        this.#iFrame = iFrame;
        this.#movementList = new MovementList(iFrame, null, this);
    }
    get script() { return this.#script}
    set script(value){
        this.#script = value;
    }
    get currentPage() { return this.#currentPage}
    set currentPage(value){
        this.#currentPage = value;
    }
    get newMovement() { return this.#newMovement}
    set newMovement(value){
        this.#newMovement = value;
    }
    get incompleteMovement() { 
        return this.#incompleteMovement
    }
    set incompleteMovement(value){
        this.#incompleteMovement = value;
    }
    get movementList() { 
        if(!this.#movementList) this.#movementList = new MovementList(this.#iFrame, 0, this);
        return this.#movementList
    }

    get iFrame() { return this.#iFrame}
    set iFrame(value){
        this.#iFrame = value;
    }

}

export class RP{
    constructor(rx, ry){
        this.rX = rx;
        this.rY = ry;
    }
}

export function createRP (ax, ay, targetImage = null, containerDiv = null){
    /* createRP returns an RP (relative position) object. RP.rX and .rY are proportions
     of the dimensions of the targetImage. E.g. if the targetImage rectangle
     is 400 wide and 300 tall, then RP(.2, .5) would be 80 pixels from the left 
     and 150 pixels from the top. There are several variants of this function.
     If only two arguments are provided, they are treated as proportions already,
     and the function simply puts them into an RP object directly. If three arguments
     are provided, the third is a reference to the targetImage, and the first two
     are the pixel offsets from the left and top of the targetImage. The function
     calculates the proportions and returns the RP. If four args, the fourth is
     a reference to the div element that contains the targetImage. The image will
     reposition and resize itself to maximally fill the containing div while
     preserving its proportions. This means that if the user resizes the window
     (and thereby resizes the containing div), the image will move around and change
     size. We therefore must record positions of svg's as their *relative* positions,
     not their absolute positions. When the user resizes the window, we can tell 
     the transpose the svg's taking this into account so that they will appear to
     stay in the same positions on the image.*/

    // if only 2 arguments, we just create a RelativePosition object from ax and ay
    var tRect = null;
    switch (arguments.length){
        case 2:  // ax and ay are already proportions. Just return the object directly/
        return new RP (ax, ay);  
            break;
        case 3:  // the third argument is the target image to use for calculating the proportionn
            tRect = targetImage.getBoundingClientRect();
            const rx = ax / tRect.width;
            const ry = ay / tRect.height;
            return new RP(rx, ry);
            break;
        case 4:  // the fourth arg is the div that contains the target element
            // the x, y arguments are the pixel offset from the container div (). If we are 
            // creating an RP in a drop event handler attached to the container div, these
            // values will be available in event.dragEvent.clientX and .clientY
            tRect = targetImage.getBoundingClientRect();
            // var rawPosition = { x: event.dragEvent.clientX - stageImageRect.left, y: event.dragEvent.clientY - stageImageRect.top };
            var rawPosition = { x: ax - tRect.left, y: ay - tRect.top };
            return createRP (rawPosition.x, rawPosition.y, targetImage);
            break
    }
}

export class SvgElement {
    _speaker = null;
    _svg = null;
    constructor (speaker, isMovement = false){
        this._speaker = speaker;
        const svgNS = "http://www.w3.org/2000/svg";
        this._svg = document.createElementNS(svgNS, "svg");

        // The width and height attributes are hard coded. They could be saved in
        // an options object -- but this requires a backing store. Unless, of course,
        // they could be imbedded in the script file that the user loads and can
        // save via a download.
        this._svg.setAttribute("class", "speaker-svg");
        this._svg.setAttribute("width", "30px");
        this._svg.setAttribute("height", "30px");
        this._svg.setAttribute("viewBox", "0 0 100 100");
        this._svg.appendChild(createCircleElement(aSpeaker, isMovement));
        this._svg.appendChild(createTextElement(aSpeaker, isMovement));
        return this._svg;
    }
}
function XcreateCircleElement(aSpeaker, isMovement) {
    const svgNS = "http://www.w3.org/2000/svg";
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", aSpeaker.cx);
    circle.setAttribute("cy", aSpeaker.cy);
    circle.setAttribute("r", aSpeaker.r);
    
    if(isMovement){
        const paleColor = getPalerColorHex(aSpeaker.backgroundColor, 0.35);
        circle.setAttribute("fill", aSpeaker.paleColor);
    }
    else
        circle.setAttribute("fill", aSpeaker.backgroundColor);
    return circle;
}
function XcreateTextElement(aSpeaker, isMovement) {
  const svgNS = "http://www.w3.org/2000/svg";
  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", aSpeaker.cx + '%');
  text.setAttribute("y", aSpeaker.cy + '%');
  if(isMovement)
    text.setAttribute("fill", aSpeaker.textColor);
  else
    text.setAttribute("fill", black);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.textContent = aSpeaker.speakerInitials;
  text.setAttribute("font-size", "30");
  return text;
}
export function TotalPageCount(myIframe){
    const iframe = myIframe;
    const innerDoc = iframe.contentDocument || iframe.contentWindow.document;

    // Query all potential elements (e.g., all children of body)
    // const elements = innerDoc.querySelectorAll('body *');
    const elements = innerDoc.querySelectorAll('.PageBreak');
    const lastElement = elements[elements.length - 1];
    const numberPart = lastElement.innerText.split('Page').pop();
    return parseInt(numberPart);
    //var previousElement = lastElement.previousElementSibling;
    /* if(previousElement){
        while(previousElement.nodeName != 'SPAN'){
            previousElement = previousElement.previousElementSibling;
            if (previousElement == null) return 0;
        }
        if(previousElement.nodeName != 'SPAN') return 0;
        const numberPart = previousElement.innerText.split('Page').pop();
        return parseInt(numberPart);
    } */
}
export function GoToPage(myIframe, pageNumber){
    console.log('Going to page: ' + pageNumber);
    const iframe = myIframe;
    const innerDoc = iframe.contentDocument || iframe.contentWindow.document;
    const elements = innerDoc.querySelectorAll('.PageBreak');
    const elementsArray = Array.from(elements);
    const destinationSpan = elementsArray.find(s => s.innerText.includes(pageNumber));
    destinationSpan.scrollIntoView({
        behavior: 'auto', // 'auto' or 'smooth'
        block: 'start'      // 'start', 'center', 'end', or 'nearest'
    });
}
export function GetPageNumberAtMovement(movement){
    const cursorElement = movement.node;
    var thisElement = cursorElement.parentElement;
    while(thisElement.className != 'PageBreak'){
        thisElement = thisElement.previousElementSibling;
        if(thisElement.tagName.toUpperCase() == 'BODY') return null
    }
    return parseInt(thisElement.innerText.split('Page').pop());
}

export function GetPageNumberAtCursor(iFrame, e){
    const clickedElement = e.target;
    if(clickedElement.tagName.toUpperCase() == 'BODY') {
        alert('System says you clicked on Body element.');
        return;
    }
    const elements = iFrame.contentDocument.querySelectorAll('body *');
    var previousElement = clickedElement;
    while (previousElement.className != 'PageBreak'){
        previousElement = previousElement.previousElementSibling;
        if(previousElement.nodeName.toUpperCase() == 'BODY') return 0
    }
    const numberPart = previousElement.innerText.split('Page').pop();
    return parseInt(numberPart); 
}
export function GetCurrentPageNumber(myIframe) {
    const iframe = myIframe;
    const innerDoc = iframe.contentDocument || iframe.contentWindow.document;

    // Get first visible element
    // Query all potential elements (e.g., all children of body)
    const elements = innerDoc.querySelectorAll('body *');

    const firstVisible = Array.from(elements).find(el => {
        const rect = el.getBoundingClientRect();
        const isVisibleInDOM = el.checkVisibility(); // Check CSS visibility
        
        // Check if the element is within the vertical viewport of the iframe
        const isInViewport = rect.bottom > 0 && rect.top < iframe.contentWindow.innerHeight;
        
        return isVisibleInDOM && isInViewport;
    });
    // Now look back to the preceding PageBreak element
    var previousElement = firstVisible;
    if(previousElement){
        var x = 0;
        while(previousElement.className != 'PageBreak'){
            previousElement = previousElement.previousElementSibling;
            if (previousElement == null) break;
        }
        if(previousElement){
            const numberPart = previousElement.innerText.split('Page').pop();
            return parseInt(numberPart);
        }
        else return null;
        
    }
}

function getPalerColorHex(hex, factor = 0.5) {
  // Remove hash and parse RGB
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);

  // Interpolate each channel toward 255 (white)
  r = Math.round(r + (255 - r) * factor);
  g = Math.round(g + (255 - g) * factor);
  b = Math.round(b + (255 - b) * factor);

  // Convert back to Hex
  const toHex = (c) => c.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export class Speaker {   // bgColor should be a named color, eg "red"
    static #isInternal = false;  // To prevent var s = new Speaker(...). Must use var s = Speaker.create(...)
    // When a set of speakers is created, they will be placed in a vertical line. Each speaker will be 
    // positioned #yIncrement pixels before the preceding one. The y position for the next speaker to 
    // be created is #currentY. When Speaker.create makes a new speaker, it increments #currentY by
    // #yIncrement so that the next one will be below the last one.

    // NOTE: this is a bad design. The Speaker object should not have to know where the client
    // code wants to place it. The client code should manage the initial placement of each speaker.

    static #currentY = 0; 
    static #yIncrement = 30;
    static #speakerCount = 0;
    #_originalX = null;
    #_originalY = null;
    #_speakerDiv = null;
    #_shadowDiv = null;
    #_speakerName = "";
    #_speakerInitials = "";
    #_backgroundColor;
    #_cx = 50;  // The x position of the icon's circle, relative to its containing div
    #_cy = 50;
    #_r = 40;
    #_RP = null;
    #_lastMovementNumber = 0;
    #_proportionalPosition = {
        x: null,
        y: null
        };
    
    //#region getters and setters
    get speakerDiv() {
        return this.#_speakerDiv;
    }
    set speakerDiv(value) {
        this.#_speakerDiv = value;
    }
    get shadowDiv() {
        return this.#_shadowDiv;
    }
    set shadowDiv(value) {
        this.#_shadowDiv = value;
    }
    get originalX() {
        return this.#_originalX;
    }
    set originalX(value) {
        this.#_originalX = value;
    }
    get originalY() {
        return this.#_originalY;
    }
    set originalY(value) {
        this.#_originalY = value;
    }
    get speakerName(){
        return this.#_speakerName;
    }
    get speakerInitials(){
        return this.#_speakerInitials;
    }
    get backgroundColor(){
        return this.#_backgroundColor;
    }
    set backgroundColor(value){
        this.#_backgroundColor = value;
    }
    get cx(){
        return this.#_cx;
    }
    get cy(){
        return this.#_cy;
    }
    get r(){
        return this.#_r;
    }
    get textColor() {
        //Calculate the brightness of the background color 
        return textColorForBackground(this.#_backgroundColor);
        /* const r = parseInt(this.#_backgroundColor.substring(1, 3), 16);
        const g = parseInt(this.#_backgroundColor.substring(3, 5), 16);
        const b = parseInt(this.#_backgroundColor.substring(5, 7), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        // Return black for light backgrounds and white for dark backgrounds
        return brightness > 128 ? 'black' : 'white'; */
    };
    get RP(){
        return this.#_RP;
    }
    set RP(value){
        this.#_RP = value;
    }
    //#endregion
    
        constructor(spkrName, spkrInitials, bgColor) {
        if (!Speaker.#isInternal) {
            throw new Error("Constructor is private. Use Speaker.create() instead.");
        }
        this.#_speakerName = spkrName;
        this.#_speakerInitials = spkrInitials;
        this.#_backgroundColor = colorNames[bgColor.toLowerCase()] || bgColor; // Convert named color to hex, or use provided value
        // this.#_y = Speaker.#currentY;
        Speaker.#currentY += Speaker.#yIncrement;
        Speaker.#speakerCount += 1;
    }
    static create(spkrName, spkrInitials, bgColor, initialX, initialY) {
        Speaker.#isInternal = true;
        const instance = new Speaker(spkrName, spkrInitials, bgColor, initialX, initialY);
        Speaker.#isInternal = true;
        Object.seal(instance);
        return instance;
    }
    
}
export function createSpeakerDiv(dataStore, aSpeaker, divParms, isShadow) {
  // Create a div for the speaker icon
  const speakerDiv = document.createElement('div');
  if(!isShadow){
    speakerDiv.setAttribute('class', 'speaker draggable');
    // We use the id property EVERYWHERE in the code!
    speakerDiv.id = 'speaker-div-' + aSpeaker.speakerInitials;
  }
  else {
    speakerDiv.setAttribute('class', 'speaker draggable');
    // We use the id property EVERYWHERE in the code!
    speakerDiv.id = 'shadow-div-' + aSpeaker.speakerInitials;
  }
  // The speakerDiv has a child element: an SVG that produces
  // a coloured circle with the speaker's initials inside
  speakerDiv.appendChild(createSvgElement(aSpeaker, isShadow));
  // The speaker y value is set in the speaker constructor. This is poor. 
  // We should just maintain a counter and increment it for each speaker.

  // Anyway, if the y value is greater than the height of the speaker area,
  // we need to start a new column. NOTE: we can't use a flow container, because
  // the Interact system requires absolute positioning.
  if(divParms.currentY > dataStore.speakerAreaHeight) {
    divParms.currentY = 0;
    divParms.bottomOfColumnY = 0;
    // currentY = currentY - bottomOfColumnY - 30; // height of speaker div -- hard coded for now, 
                              // but should be based on the actual height of the speaker div
    divParms.currentX += 30;
  }
  else{
    divParms.bottomOfColumnY = Math.max(divParms.bottomOfColumnY, divParms.currentY);
  }
  // Move the speakerDiv to its correct location.
  speakerDiv.style.transform = `translate(${divParms.currentX}px, ${divParms.currentY}px)`;
  divParms.topOfColumnY = divParms.topOfColumnY || divParms.currentY; // Update the top Y position of the column
  // We have to tell the Interact system what the speakerDiv's starting
  // position is.
  speakerDiv.setAttribute('data-x', divParms.currentX);
  speakerDiv.setAttribute('data-y', divParms.currentY);
  return speakerDiv;
}

export function createSvgElement(aSpeaker, isShadow) {
  // The svg element contains a coloured circle with the speaker's initials inside
  // An svg element needs a namespace specification
  const svgNS = "http://www.w3.org/2000/svg";
  // Funky way to create an svg element
  const svg = document.createElementNS(svgNS, "svg");
  // The width and height attributes are hard coded. They could be saved in
  // an options object -- but this requires a backing store. Unless, of course,
  // they could be imbedded in the script file that the user loads and can
  // save via a download.
  svg.setAttribute("class", "speaker-svg");
  svg.setAttribute("width", "30px");
  svg.setAttribute("height", "30px");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("overflow", "visible");
  svg.appendChild(createCircleElement(aSpeaker, isShadow));
  svg.appendChild(createTextElement(aSpeaker, isShadow));
  return svg; 
}
function createPath(x1, y1, x2, y2){
    const svgNS = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
    path.setAttribute("class", "connection-line");
    return path;
}

export function createCircleElement(aSpeaker, isShadow) {
  const svgNS = "http://www.w3.org/2000/svg";
  const circle = document.createElementNS(svgNS, "circle");
  circle.setAttribute("cx", aSpeaker.cx);
  circle.setAttribute("cy", aSpeaker.cy);
  circle.setAttribute("r", aSpeaker.r);
  if(!isShadow){
    circle.setAttribute("fill", aSpeaker.backgroundColor);
  }
  else{
    circle.setAttribute("fill", getPalerColorHex(aSpeaker.backgroundColor, 0.8));
  }
  return circle;
}
export function createTextElement(aSpeaker, isShadow) {
  const svgNS = "http://www.w3.org/2000/svg";
  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", aSpeaker.cx + '%');
  text.setAttribute("y", aSpeaker.cy + '%');
  var backgroundColor = aSpeaker.backgroundColor;
    if (isShadow) backgroundColor = getPalerColorHex(backgroundColor);
  var fillColor = textColorForBackground(backgroundColor);
  
  text.setAttribute("fill", aSpeaker.textColor);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.textContent = aSpeaker.speakerInitials;
  text.setAttribute("font-size", "30");
  return text;
}

function GetHtmlOffsetFromTextOffset(element, offset){
    var innerHTML = element.innerHTML;
    const htmlLength = innerHTML.length;
    var offsetRemaining = offset;
    var inNode = false;
    var htmlOffset = -1;
    var htmlIndex = 0;
    var textSoFar = "";
    var thisChar = null;
    while(offsetRemaining > -1){
        htmlOffset += 1;
        thisChar = innerHTML[htmlIndex];
        if(thisChar == "<") {
            inNode = true;
            // reset offsetRemaining, because the offset parm is the offset from the cursor to its preceding node
            // offsetRemaining = offset;
        }
        if(! inNode) {
            textSoFar += thisChar;
            offsetRemaining -= 1;
        }
        if(inNode && thisChar == ">") inNode = false;
        
        htmlIndex += 1;
    }
    return htmlOffset;
}
export function GetClickedCharacterPosition(iFrame){
    const selection = iFrame.contentWindow.getSelection();
    var charPosition = null
    let range, textNode, offset; 
    const document = iFrame.contentDocument;
    range = document.caretRangeFromPoint(event.clientX, event.clientY);
    textNode = range.startContainer;
    offset = range.startOffset;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        let totalOffset = offset;
        let node = textNode;

        // Traverse backwards through previous siblings to add up their text lengths
        while (node.previousSibling) {
            node = node.previousSibling;
            // Use textContent to get the length of both text and child elements (like <span>)
            totalOffset += node.textContent.length;
        }
        return totalOffset;
    }
    else
        alert('ERROR -- Backend.js line 315');




    return offset;

    if (selection.rangeCount > 0) {
      // The offset within the specific text node clicked
      charPosition = selection.focusOffset;
      // console.log("Character position clicked:", charPosition);
      
      // Optional: Get the full text of the clicked node
      const clickedText = selection.focusNode.textContent;
      console.log("Full text node content:", clickedText);
    }
    return charPosition;
}

export class Movement {
    #_iFrame = null;
    #_iFrameDoc = null;
    #_dataStore = null;
    #_speakerDiv = null;
    #_imageAreaDiv = null;
    #shadowDiv = null;
    #_element = null;
    #_offset = null;
    #_id = null;
    #_initials = null;
    #_pending = true;
    #_span = null;
    #speaker = null;
    constructor(iFrame, imageAreaDiv, dataStore, containingElement, offset){
        this.#_iFrameDoc = null;
        this.#_iFrame = iFrame;
        this.#_dataStore = dataStore;
        this.#_imageAreaDiv = imageAreaDiv;
        this.#_element = containingElement;
        this.#_offset = offset;
        
        // Add it to the dataStore
        const mList = this.#_dataStore.movementList;
        // The 
        const nextIndex = mList.count();
        mList.add(nextIndex, this);
        this.#_id = 'm-' + mList.count();
        this.#_span = this.iFrameDoc.createElement('span');
        this.#_span.textContent = '[?]';
        this.#_span.className = 'm-new';
        this.#_span.id = this.#_id;
        // const text = containingElement.textContent;
        const htmlOffset = GetHtmlOffsetFromTextOffset(containingElement, offset);
        const innerHTML = containingElement.innerHTML;
        containingElement.innerHTML = innerHTML.substring(0, htmlOffset) +
            this.#_span.outerHTML + innerHTML.substring(htmlOffset);
        return this;
    }
    get imageAreaDiv(){
        return this.#_imageAreaDiv;
    }
    get iFrameDoc(){
        return this.#_iFrame.contentDocument;
    }
    get speaker(){
        return this.#speaker;
    }
    set speaker(value){
        this.#speaker = value;
        this.iFrameDoc.getElementById(this.#_id).className = 'm-normal';
        this.iFrameDoc.getElementById(this.#_id).innerHTML = `[${this.#speaker.speakerInitials}]`;
        // this.#speakerSvg = this.#speaker.SvgElement; 
    }
    
    get speakerDiv(){
        return this.#_speakerDiv;
    }
    set speakerDiv(value){
        this.#_speakerDiv = value;
    }
    get shadowDiv(){
        return this.#shadowDiv;
    }   
    set shadowDiv(value){
        this.#shadowDiv = value;
    }


    drawLines(all = false) {
        // Draw lines to connect the shadow div
        // to the speaker div. 
        // If all is true, draw lines from the shadow div to all 
        // movement markers and the speaker div. If all is false, 
        // draw a line only from the speakjer duiv to the most recent 
        // movement marker.
        eraseLine(this.speakerDiv);
        drawLine(this.speakerDiv, this.shadowDiv);
    }


}
function eraseLine(speakerDiv){
    const svg = speakerDiv.querySelector('svg');
    if(svg){
        const path = svg.querySelector('path');
        if(path)
            path.remove();
    }
}
export function speakerObjFromSpeakerDiv(speakerDiv){
  var speakerInitials = speakerDiv.id.split('-').pop();
  return speakers.find(s => s.speakerInitials === speakerInitials);
}

function drawLine(fromDiv, toDiv){
    // Draw a line from the center of fromDiv to the center of toDiv. 
    // We will use an SVG line element for this. The line will be drawn 
    // on an SVG that is a child of the body element. The line's coordinates 
    // will be determined by the positions of the fromDiv and toDiv elements. 
    // The line will have a class that allows us to style it with CSS.
    const speaker = speakerObjFromSpeakerDiv(fromDiv);
    // const speakerDivContainer = fromDiv.parentElement;
    const fromTransformMap = fromDiv.attributeStyleMap.get('transform');
    const toTransformMap = toDiv.attributeStyleMap.get('transform');
    const xDelta = toTransformMap[0].x.value - fromTransformMap[0].x.value;
    const yDelta = toTransformMap[0].y.value - fromTransformMap[0].y.value;
    const svgFrom = fromDiv.querySelector('svg');
    const fromX = 50; // + fromDiv.getBoundingClientRect().width / 2; //fromTransformMap[0].x.value - speaker.originalX;
    const fromY = 50; // + fromDiv.getBoundingClientRect().height / 2; //fromTransformMap[0].y.value - speaker.originalY;
    const toX = xDelta; //toTransformMap[0].x.value - speaker.originalX;
    const toY = yDelta; //toTransformMap[0].y.value - speaker.originalY;
        // Create an SVG line element
    const svgNS = "http://www.w3.org/2000/svg";
    const path = createPath(fromX, fromY, toX, toY);
    svgFrom.appendChild(path);

}

function getMovementForMarker(e, myIframe, thisMovementMarker, dataStore){
    // Find the movementList item .
    const movementItem = dataStore.movementList._items.find(m => m.node.innerText == thisMovementMarker.innerText);
    return movementItem;
    
}
function getSpansFromPara(p, e){
    const spans = e.target.querySelectorAll('span'); // Get all spans inside it
    return spans;
}
function getPrecedingSpan(myIframe, thisPara, e){
    const spans = getSpansFromPara(thisPara, e);
    const spanCount = spans.length;
    if(spanCount == 0){
        return null;
    }
    // we have spans. Get the cursor offset from the start of the para
    const sel = myIframe.contentWindow.getSelection();
    var cursorOffset = null;
    if(sel.rangeCount > 0){
        cursorOffset = sel.anchorOffset; // Characters from the start
    }
    // Get the first span, if any, that is to the left of the cursor position
    var thisSpan = null;
    for(var i = spanCount - 1; i <= 0; i--){
        thisSpan = spans[i];
        const characterOffset = thisPara.innerHTML.indexOf(thisSpan.outerHTML) - 5;
        if(characterOffset <= cursorOffset) break;
    }
    // Return this span
    return thisSpan;
}
export function getPreviousMovementMarker(e, myIframe, dataStore) {
  // Get the movement markers immediately to the left of where we clicked.
  // We are in a <p> element, and movement-placeholders are <SPAN> elements inside <p> elements.
  // We therefore first need to look inside the current para (e.target) and see if it has any
  // <SPAN> elements inside it. If it does, we need to get the character offset of each SPAN
  // and find the one that is less than the current cursor position

  // Does the clicked para contain any SPANs?
  var thisPara = e.target;
  const spans = getSpansFromPara(thisPara, e);
  const spanCount = spans.length;
  if(spanCount > 0){
    const previousSpan = getPrecedingSpan(myIframe, thisPara, e);
    if(previousSpan)
        return previousSpan;
    // There are no spans to the left of the cursor
    return null;
  }
  else
    return null;
}
export function GetMovementListLog(from, dataStore){
    const items = dataStore.movementList._items;
    var log = `[${from}]
`;
    for(var i = 0; i < items.length; i++){
        const m = items[i];
        var next = null;
        var prev = null;
        if (m.next > -1)
            next = items[m.next].id;
        if (m.prev > -1)
            prev = items[m.prev].id;
        log += `      index: ${i} id: ${m.id} prev: ${m.prev} (${prev}) next: ${m.next} (${next})
`;
    }
    return log;
}
export class MovementList {
    #movements = new Map();
    _items = [];
    #startPage = 0;
    #myIframe = null;
    #dataStore = null;
    #pageCount = 0;
    #pageSeqs = [{page: 0, seq: 0}];  // Array to store the last seq number used on each page
    constructor (myIframe, startPage, dataStore){
        this._startPage = startPage;
        this.#myIframe = myIframe;   
        this.#dataStore = dataStore;  
          
    }
    
    add(key, value){
        this.#movements.set(key, value);
    }
    changeValue(key, newValue){
        if(! this.#movements.has(key))
            throw new Error(`There is no item for this key (${key})`)
        else
            this.#movements.set(key) = newValue;
    }
    get(key){
        return this.#movements.get(key);
    }
    count(){
        return this.#movements.size;
    }
    delete(key){
        if(! this.#movements.has(key))
            throw new Error(`There is no item for this key (${key})`)
        else
            this.#movements.delete(key);
    }
    forEach(callBack){
        this.#movements.forEach (function(value, key) {
            callBack(value, key);
        })
    }
    entries(){
        return this.#movements.entries();
    }
    keys(){
        return this.#movements.keys();
    }
    values(){
        return this.#movements.values();
    }
    speakerMap(initials){
        const result = Map.groupBy(this.#movements, ({ initials }) => initials);
    }
}
function textColorForBackground(backgroundColor){
    const r = parseInt(backgroundColor.substring(1, 3), 16);
    const g = parseInt(backgroundColor.substring(3, 5), 16);
    const b = parseInt(backgroundColor.substring(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    // Return black for light backgrounds and white for dark backgrounds
    return brightness > 128 ? 'black' : 'white';
}
