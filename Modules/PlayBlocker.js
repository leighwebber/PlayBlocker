"use strict";

import {DataStore, Speaker, speakers, Movement, createTextElement, createCircleElement, 
  createSvgElement, createSpeakerDiv, MovementList, GetMovementListLog, GetCurrentPageNumber, 
  TotalPageCount, GoToPage, GetClickedCharacterPosition, createRP,
  GetPageNumberAtMovement, speakerObjFromSpeakerDiv,GetPageNumberAtCursor, getPreviousMovementMarker} from "../Modules/Backend.js";

//#region globals
var lastMovedSpeakerInitials = null; // Global variable to track the initials of the last moved speaker
// var speakerAreaHeight = null;  // Global variable to store the height of the speaker area
// var topOfColumnY = null; // Global variable to track the top Y position of the top element in the speaker area
var speakerAreaRect = null; // Global variable to store the bounding rectangle of the speaker area
var bottomOfColumnY = null; // Global variable to track the bottom Y position of the last element in the current column
var imageAreaDiv = null; // Global variable to store the image area element
var stageImageElement = null; // Global variable to store the stage image element
var wasDroppedInImageArea = false; // Global variable to track if the speaker was dropped in the image area
var stageImageRect = null; // Global variable to store the bounding rectangle of the stage image
var speakerAreaElement = null;
var pageCount = 0;
var scriptLoaded = false;
var divSliders = null;
var divSlideContainer = null;
var slider = null;
var output = null;
var log = "";
var imgLeftOld = 0;
var imgTopOld = 0;
var imgWidthOld = 0;
var imgHeightOld = 0;
var imgLeftNew = 0;
var imgTopNew = 0;
var imgWidthNew = 0;
var imgHeightNew = 0;
var myIframe = null;
var contextMenuAllowed = true;  // Default is for right-click to bring up the default context menu
var dataStore = null;

//#endregion
const API_URL = "https://lwebber.ca/api"; // Replace with your actual backend URL

//#region Register and login
// Handle User Registration
if(document.getElementById('registerForm')){
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData);

  const response = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (response.ok) alert("Registration successful! You can now log in.");
});
}

window.logout = async function logout(){
  const response = await fetch(`${API_URL}/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (response.ok) alert("Logout successful");
}


// Handle User Login
if(document.getElementById('loginForm')){
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData);

  try{
  const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response; //.json();
    if(!response.ok){
      alert('Bad response: ' + response.status);
    }
    else{
      const data = await response.json(); 
      console.log(data); // Access properties like data.id
      // window.open("https://lwebber.ca/PlayBlocker.html");
      const protectedArea = document.getElementById('protected-area');
           protectedArea.style.display = 'block';
    }
  }
  catch (error) {
    alert("Login failed");
  }
});
}
  
//#endregion

function PlayBlockerPageSetup(){
  document.getElementById('fileInput').addEventListener('change', function() {
    const fileName = this.files[0] ? this.files[0].name : "No file selected";
    document.getElementById('file-name').textContent = fileName;
  });
  myIframe = document.getElementById('script-iframe');
  dataStore = new DataStore(myIframe);
  // dataStore.CreateMovementList(10);
  slider = document.getElementById("myRange");
  divSlideContainer = document.getElementById('slidecontainer');
  slider.addEventListener("change", sliderOnChange);
  dataStore.speakerAreaHeight = document.getElementById('speaker-area').getBoundingClientRect().height;
  window.addEventListener('resize', onResize);
  insertSpeakers(speakerAreaElement);
  slider.oninput = function() {
  // console.log(`oninput this.value: ${this.value}`);
  output.innerHTML = this.value;
  sliderMove(this.value);
  slider.blur();
}
  output = document.getElementById("demo");
  output.innerHTML = slider.value; // Display the default slider value
  console.log('PlayBlocker page loaded');
  myIframe.addEventListener('mouseleave', function() {
    if(dataStore.newMovement){
      document.body.style.cursor = 'not-allowed';
    }
    else
      document.body.style.cursor = 'default';
});
  myIframe.contentWindow.addEventListener('scroll', (event) => {
    iFrameOnScroll(event);
  })
  iFrameListeners();
  contextMenuAllowed = false;
  // This event listener manages the right-click context menu appearance
  myIframe.contentWindow.addEventListener('contextmenu', function(event) {
    // 1. Prevent the browser's default right-click menu
    event.preventDefault(); 
    if(event.target.className != 'Speech' && event.className != 'StageDirection'){
      alert('You can only create a movement inside the text of a Speech or a StageDirection');
      return;
    }
    // 2. Prevent the event from bubbling up to parent contextmenu handlers
    event.stopPropagation(); 
      startMovement(event);
});

  window.addEventListener('keydown', (event) => {
    switch(event.key){
      case 'Escape':
        handleEscapeKey();
        break;
      case 'ArrowUp':
        myIframe.contentWindow.scrollBy(0, -30); 
        break;
      case 'ArrowDown':
        myIframe.contentWindow.scrollBy(0, 30); 
        break;
      case 'PageUp':
        ScrollToAdjacentPage('up');
        break;
      case 'PageDown':
        ScrollToAdjacentPage('down');
        break;
    }
    
    function ScrollToAdjacentPage(direction){
      const targetElements = Array.from(iframeDoc.querySelectorAll('.PageBreak'));
      const currentPage = GetCurrentPageNumber(myIframe);
      var destinationPageBreak = null;
      if(direction == 'up'){
        destinationPageBreak = targetElements.find(e => e.innerText.includes(`-Page ${currentPage - 1}-`));
      }
      else {
        destinationPageBreak = targetElements.find(e => e.innerText.includes(`-Page ${currentPage + 1}-`));
      }
      if(destinationPageBreak)
        destinationPageBreak.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // alert('Foo');
    }
  });
  const getPageNumberButton = document.getElementById('get-page-number');
  // pageCount = TotalPageCount(myIframe);
  getPageNumberButton.addEventListener('click', function() {
    var currentPage = GetCurrentPageNumber(myIframe);
    var totalPages = TotalPageCount(myIframe);
  });
  
  stageImageElement = document.getElementById('stage-image');
  stageImageRect = stageImageElement.getBoundingClientRect();
  // Record the starting dimensions of the image
  imgLeftOld = stageImageRect.left;
  imgTopOld = stageImageRect.top;
  imgWidthOld = stageImageRect.width;
  imgHeightOld = stageImageRect.height;
  speakerAreaElement = document.getElementById('speaker-area');
  speakerAreaRect = speakerAreaElement.getBoundingClientRect();
  imageAreaDiv = document.getElementById('image-area');
  // var logButton = document.getElementById('show-log');
  // logButton.addEventListener('click', showLog);
  stageImageElement.addEventListener('click', function(event) {
  });
  speakerAreaRect = document.getElementById('speaker-area').getBoundingClientRect();
  // Store the height of the speaker area for later use
  dataStore.speakerAreaHeight = document.getElementById('speaker-area').getBoundingClientRect().height; 

  // Listen for file selection
  const fileInput = document.getElementById('fileInput');
  // const fileContentDisplay = document.getElementById("file-content");
  const messageDisplay = document.getElementById("message");

  fileInput.addEventListener("change", handleFileSelection);
  const downloadButton = document.getElementById('download');
  downloadButton.addEventListener("click", downloadTextFile);
}
 
export function showLog() {
    const logContainer = document.getElementById('log-container');
    const logContent = document.getElementById('log-content');
    logContent.textContent = log;
    logContainer.style.display = 'block';
}

function onResize(){
    if(dataStore.speakerAreaHeight == null) return;  // Ignore the resize that occurs when the window is first opened
    dataStore.speakerAreaHeight = document.getElementById('speaker-area').getBoundingClientRect().height;
    stageImageElement = document.getElementById('stage-image');
    stageImageRect = stageImageElement.getBoundingClientRect();
    imgLeftNew = stageImageRect.left;
    imgTopNew = stageImageRect.top;
    imgWidthNew = stageImageRect.width;
    imgHeightNew = stageImageRect.height;
    dataStore.speakerAreaHeight = document.getElementById('speaker-area').getBoundingClientRect().height;
    repositionSpeakers(imgLeftOld, imgLeftNew, imgTopOld, imgTopNew, imgWidthOld, imgWidthNew, imgHeightOld, imgHeightNew);
    imgLeftOld = imgLeftNew;
    imgTopOld = imgTopNew;
    imgWidthOld = imgWidthNew;
    imgHeightOld = imgHeightNew;
}

function handleContextMenuPreventDefault (event){
  // A global var contextMenuAllowed determines whether the built-in context menu
  // will appear on a right-click.
  if (!contextMenuAllowed){
    // standard context menu is suppressed
    event.preventDefault();
    window.focus()
  }
  else{
    // standard context menu is allowed
    event.currentTarget.submit();
    window.focus()
  }
}
function handleFileSelection(event) {
    const file = event.target.files[0];
    
    // fileContentDisplay.textContent = ""; // Clear previous file content
    // messageDisplay.textContent = ""; // Clear previous messages

    // Validate file existence and type
    if (!file) {
      showMessage("No file selected. Please choose a file.", "error");
      return;
    }

    if (!file.type.startsWith("text")) {
      showMessage("Unsupported file type. Please select a text file.", "error");
      return;
    }

    // Read the file
    const reader = new FileReader();
    reader.onload = () => {
      /* const htmlContent = reader.result;
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob); */

     //  myIframe.src = url;
      myIframe.contentDocument.body.innerHTML = reader.result;
      // myIframe.srcdoc = reader.result;
      iFrameListeners();
      dataStore.script.fileName = file.name;
      dataStore.script.htmlContent = myIframe.contentDocument.body.innerHTML;
      const startingPageNum = GetCurrentPageNumber(myIframe);
      pageCount = TotalPageCount(myIframe);
      dataStore.movementList.pageCount = pageCount;
      dataStore.movementList.startPage = startingPageNum;
      slider.value = startingPageNum;
      const pageNumDisplayElement = document.getElementById('demo');
      pageNumDisplayElement.innerHTML = slider.value;
      const downloadButton = document.getElementById('download');
      var spanFileName = document.getElementById('file-name');
      spanFileName.style.right = 150;
      downloadButton.style.visibility = 'visible';
      // Get the starting page number
      scriptLoaded = true;
      
      divSlideContainer.style.visibility = "visible";
/*       divSlideContainer.style.visibility = "visible";
      divSlideContainer.style.paddingLeft = "0px"; */
    };
    reader.onerror = () => {
      showMessage("Error reading the file. Please try again.", "error");
    };
    reader.readAsText(file);
  }

function sliderMove(value){
  
  // output.innerHTML = page;
}
function sliderOnChange(e){
  var fraction = e.target.value / 100;
  var page = parseInt(pageCount * fraction);
  console.log(`page: ${page}`);
  GoToPage(myIframe, page);
  dataStore.currentPage = page;
}
function iFrameOnScroll(event) {
  var page = GetCurrentPageNumber(myIframe);
  // console.log('Current page on scroll is ' + page);
  if(page != dataStore.currentPage){
    // console.log('Visible page is now: ' + page);
    slider.value = 100 * page / pageCount;
    output.innerHTML = slider.value
  }
}

  // Displays a message to the user
  function showMessage(message, type) {
    messageDisplay.textContent = message;
    messageDisplay.style.color = type === "error" ? "red" : "green";
  }
  /* myIframe.addEventListener('load', function() {
    myIframe.contentDocument.body.addEventListener('contextmenu', startMovement);
    myIframe.contentDocument.body.addEventListener('click', scriptOnClick);
  }); */
  // console.log(`imgLeftOld imgLeftNew  imgTopOld imgTopNew imgWidthOld imgWidthNew imgHeightOld  imgHeightNew  oldTransform  newTransform`);

  

function iFrameListeners(){
  // myIframe.contentDocument.body.addEventListener('contextmenu', startMovement);
  // 
  myIframe.contentDocument.addEventListener('click', scriptOnClick);

}
function handleEscapeKey () {
  console.log('ESCAPE');
  if(dataStore.newMovement){
    /* dataStore.newMovement.range = null;
    dataStore.newMovement.speakerInitials = ""; */
    const parent = dataStore.newMovement.node.parent;
    dataStore.newMovement.node.remove();
    
    // dataStore.newMovement.newNode = null;
    dataStore.newMovement = null;
    document.body.style.cursor = "default";
    myIframe.contentDocument.body.style.cursor = "text";
    parent.normalize();
  }

}
function startMovement (e) {
  // We can only start a movement if we click in a <p> element
  const currentElement = e.target;
  if(e.target.className != 'Speech' && e.target.className != 'StageDirection' ){
    alert('You can only insert a movement in a speech paragraph or a stage direction.')
    return;
  }
  const offset = GetClickedCharacterPosition(myIframe);
  const newMovement = new Movement(myIframe, imageAreaDiv, dataStore, e.target, offset)

  dataStore.newMovement = newMovement;
  window.focus();
}
function downloadTextFile() {    
    const content = myIframe.contentDocument.body.innerHTML;
    const fileName = dataStore.script.fileName;
    // 1. Create a Blob object with the file content
    const blob = new Blob([content], { type: 'text/plain' });

    // 2. Create a temporary URL for the Blob
    const url = URL.createObjectURL(blob);

    // 3. Create a hidden anchor element
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName; // Set the default filename
    a.style.display = 'none';

    // 4. Append, click, and cleanup
    document.body.appendChild(a);
    a.click();
    
    // Clean up memory
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
function wrapIframeSelection(iframeId, tagName, className) {
    const iframe = document.getElementById(iframeId);
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const selection = iframe.contentWindow.getSelection();

    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // Create the wrapper element
        const wrapper = iframeDoc.createElement(tagName);
        wrapper.id = 'foo';
        if (className) wrapper.className = className;
        
        try {
            // Surrounds the selected range with the new element
            range.surroundContents(wrapper);
        } catch (e) {
            // surroundContents fails if selection crosses block boundaries
            console.error("Selection crosses multiple nodes; cannot wrap directly.", e);
        }
    }
}
function scriptOnClick(e) {
  var x = GetClickedCharacterPosition(myIframe);
  console.log('Clicked at ' + x);
}

document.addEventListener('DOMContentLoaded', function() {
  log = "Initials\tspkrDivDataX\tspkrDivDataY\tspeakerAreaRectTop\tspeakerAreaRectLeft\tPageX\tPageY\tClientX\tClientY\tOffsetX\tOffsetY\n"; // Initialize log with headers
  switch (document.body.id) {
    case 'playBlockerPage':
      PlayBlockerPageSetup();
      break;
    case 'indexPage':
      console.log('Index page loaded');
      break;
    default:
      console.log('Unknown page loaded');
  }
});

function parseTransform(transform){
  const regex = /translate\(\s*([^\s,]+)\s*,\s*([^\s,]+)\s*\)/;
  const match = transform.match(regex);
  var transformFactors = {
    x: 0,
    y: 0
  }
  if (match) {
    transformFactors.x = match[1]; // "100px"
    transformFactors.y = match[2]; // "200px"
  }
  return transformFactors;
}
//#region Interact
interact('.draggable').draggable({
  styleCursor: true, 
   cursorChecker: (action, interactable, element, interacting) => {
    // 'interacting' is true while the user is actively dragging
    if (interacting) {
      return 'grabbing'; // Cursor while dragging
    }
    return 'grab'; // Cursor on hover
  },
  modifiers: [
    interact.modifiers.restrictRect({
      restriction: '#image-area', // Restricts to this element
      endOnly: false            // Always active during the drag
    })
  ],
  listeners: {
    start (event) {
      event.target.originalTransform = event.target.style.transform;
      if(dataStore.newMovement){   // The user has clicked on a speaker icon after inserting a new movement
        // When the user started this movement, they right-clicked in the script.
        // The system created a newMovement object and inserted a span
        // whose text was [?]. At that instant, we didn't know which speakers was
        // going to be moving. When the user then starts to drag a speaker icon (the only
        // allowed thing to drag), this method fires. Now we know which speaker
        // is moving, and we need to tell the newMovement object.

        // Get the speaker the user clicked on
        var speakerInitials = event.target.id.split('-').pop();
        const speaker = speakers.find(s => s.speakerInitials === speakerInitials);
        // Now tell the newMovement object who the speaker is. The newMovement object
        // is going to update the <span ...>[?]</span> to insert the speaker's
        // initials. It will then create a shadow icon and connecting lines to show
        // where the user is dragging the icon. See the Movement set speaker(value) method
        // for details.
        dataStore.newMovement.speaker = speaker;
        
        // We now have an incomplete movement underway. It will be
        // completed when the user drops the speaker icon on the image
        dataStore.incompleteMovement = dataStore.newMovement;
        dataStore.incompleteMovement.speakerDiv = event.target;
        // Now that the movement has been initiated, we set newMovement to null. 
        // This signals that we are in the middle of a movement, 
        // and any subsequent right-clicks in the script should not 
        // start new movements.
        dataStore.newMovement = null;
        const shadowDiv = speaker.shadowDiv;
        shadowDiv.style.transform = "translate(0px, 0px)"
        shadowDiv.setAttribute('data-x', 0);
        shadowDiv.setAttribute('data-y', 0);
        shadowDiv.node = speakerAreaElement.appendChild(shadowDiv);
        shadowDiv.setAttribute('data-x', event.target.getAttribute('data-x'));
        shadowDiv.setAttribute('data-y', event.target.getAttribute('data-y'));
        shadowDiv.style.zIndex = 100;
        shadowDiv.style.transform = event.target.style.transform;
        dataStore.incompleteMovement.shadowDiv = shadowDiv;
      }
      /* if(dataStore.newMovement){
        // The user has started to define a character movement. When they
        // begin a drag, we need to create a new CharacterMovement object
      } */
    },
    move (event) {
      const target = event.target;
      var speakerInitials = target.id.split('-').pop();
      const speaker = speakers.find(s => s.speakerInitials === speakerInitials);
      event.target.onImage = false; // Reset the flag at the start of each move
      // Interact stores the drag target's current translate parms in data-x and y
      // Here, we increment the translate parms by the movement deltas. THe Interact
      // system automatically tracks changes in position in the event.dx,y properties.
      const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
      const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
      // The next line actually moves the target
      target.style.transform = `translate(${x}px, ${y}px)`;
      // If we are in a move, the shadow div must be visible, and we need to 
      // redraw the connecting lines as the speaker icon moves
      if(dataStore.incompleteMovement){
        dataStore.incompleteMovement.drawLines();
      }
      // If the user later tries to drop the target outside the permitted area,
      // we need to put the target back where it was at the start of the drag
      if(!target.originalTransform) {
        target.originalTransform = target.style.transform; // Store the original transform for this element
      }
      // Update the target's data-x,y attributes
      target.setAttribute('data-x', x);
      target.setAttribute('data-y', y);
      // We want the dragged target to appear on top of anything else
      target.style.zIndex = 1000;
      // If 


      // reset the last moved speaker z-index to 100 (not zero, or it will disappear behind the image!)
      if (lastMovedSpeakerInitials && lastMovedSpeakerInitials !== target.id.split('-').pop()) {
        const lastMovedSpeaker = document.getElementById(`speaker-div-${lastMovedSpeakerInitials}`);
        lastMovedSpeaker.style.zIndex = 100;
      }
      lastMovedSpeakerInitials = target.id.split('-').pop();
      wasDroppedInImageArea = false; // Reset the flag at the start of each move
    },
    end (event) {
       // Reset the transform to the original position
       if(event.target.onImage) { // If the speaker was dropped in the image area, keep it there
        return;
        // event.target.onImage = false; // Reset the flag for future drags
       }
      if (!wasDroppedInImageArea) {
       // onsole.log(`end: style.transform before reset: ${event.target.style.transform}, changing to originalTransform: ${event.target.originalTransform}`);
       event.target.style.transform = event.target.originalTransform; // Reset to the original transform
       var transformFactors = parseTransform(event.target.style.transform);
       /* const regex = /translate\(\s*([^\s,]+)\s*,\s*([^\s,]+)\s*\)/;
       const match = event.target.style.transform.match(regex);
       var x, y;
       if (match) {
          x = match[1]; // "100px"
          y = match[2]; // "200px"
        } */
       event.target.setAttribute('data-x', parseFloat(transformFactors.x));
       event.target.setAttribute('data-y', parseFloat(transformFactors.y));
       //Reset originalTransform to null -- it will be set on the next drag start  
       event.target.originalTransform = null; 
      }
    }

  }
});

interact('.stage-image')
  .dropzone({
    accept: '.speaker',
    overlap: 'center',
    ondragenter: function (event) {
    // Change cursor when entering this zone
      event.relatedTarget.style.cursor = 'grabbing';
    },
    ondragleave: function (event) {
      // Reset cursor when leaving
      event.relatedTarget.style.cursor = 'not-allowed';
    },
    ondrop: function (event) {
      // If a drop occurs outside the permitted area, ondrop never fires.
      wasDroppedInImageArea = true;
      event.relatedTarget.onImage = true;
      // The rawPosition is the pixel distance from the left and top of the drop zone.
      // To calculate it, we take the clientX value (which is relative to the Div that contains
      // both the speaker icons and the div that holds the image) and subtract stageImageRect.left.
      var rawPosition = { x: event.dragEvent.clientX - stageImageRect.left, y: event.dragEvent.clientY - stageImageRect.top };
      var rP = createRP(event.dragEvent.clientX, event.dragEvent.clientY, stageImageElement, imageAreaDiv)
      // We need to calculate the proportional position of the drag element in relation to the 
      // dropzone. E.g. if a drag element is dropped one-quarter of the way across the target and
      // halfway down, the proportional position would be 0.25, 0.5. This is needed
      // in case the user resizes the window, whcih will resize the image (drop zone).
      // The drag-drop mechanism tracks positions by the transform.transpose css style.
      // the x,y values in the css style are displacements from the object's original
      // position. The interact system doesn't know or care if the window gets resized.
      // But we do.
      
      
      var proportionalPosition = xyToProportional(rawPosition);
      var speakerDiv = event.relatedTarget;
      // We store the proportional position inside the speaker object, not the Div,
      // because when we generate movement path markers (which will be separate 
      // divs), we need to know the
      // proportional positions
      // var speakerInitials = speakerDiv.id.split('-').pop();
      // var speakerObj = speakers.find(s => s.speakerInitials === speakerInitials);
      var speakerObj = speakerObjFromSpeakerDiv(speakerDiv);
      speakerObj.RP = rP;
      // speakerObj.proportionalPosition = proportionalPosition;
      // Set all speakers to z-index 100 so that the one we are dropping will appear on top
      const speakerDivs = document.querySelectorAll('.speaker');
      document.body.style.cursor = "default";
      myIframe.contentDocument.body.style.cursor = "text";
      if(dataStore.newMovement){
        dataStore.newMovement = null;
        console.log(GetMovementListLog('564', dataStore));
      }
    }
  })
  .on('dropactivate', function (event) {
    event.target.classList.add('drop-activated')
  })
  interact('.dropzone').dropzone({
  accept: '.draggable',
});
//#endregion


function xyToProportional(rawPosition) {
  // 
  const proportionalX = rawPosition.x / stageImageRect.width;
  const proportionalY = rawPosition.y / stageImageRect.height;
  return { proportionalX, proportionalY };
}
/* function proportionalToXY(speakerDiv) {
  var speakerInitials = speakerDiv.id.split('-').pop();
  const speakerObj = speakers.find(s => s.speakerInitials === speakerInitials);
  const speakerDivRect = speakerDiv.getBoundingClientRect();
  const proportionalPosition = speakerObj.proportionalPosition;
  const stageImageLeft = stageImageRect.left;
  const stageImageTop = stageImageRect.top;
  const speakerAreaLeft = speakerAreaRect.left;
  const speakerAreaTop = speakerAreaRect.top;
  const data_x = speakerDiv.getAttribute('data-x');
  const data_y = speakerDiv.getAttribute('data-y');
  const x = proportionalPosition.proportionalX * stageImageRect.width + stageImageRect.left - (speakerDivRect.left - data_x);
  const y = proportionalPosition.proportionalY * stageImageRect.height + stageImageRect.top - (speakerDivRect.top - data_y);
  console.log(`**** propToXY data-x,y: (${data_x}, ${data_y}) stageImageLeft: ${stageImageLeft} Top: ${stageImageTop} speakerAreaLeft: ${speakerAreaLeft} Top: ${speakerAreaTop} Result: ${x}, ${y}`);
  return { x, y };
} */

function repositionSpeakers(imgLeftOld, imgLeftNew, imgTopOld, imgTopNew, imgWidthOld, imgWidthNew, imgHeightOld, imgHeightNew) {
  // This function is called when the window is resized. Every icon that is on the image must
  // be repositioned to its correct location accounting for the change in the image size and 
  // position.
  const speakerDivs = document.querySelectorAll('.speaker');
  // The pixelDistance objects hold the pizel distance of the icon from the left and top
  // of the image. E.g. if the image is 600 px wide and 400 px tall and the icon proportional position is
  // 0.5, 0.25, then the pixelDistance.x is 300 and .y is 100. The pixelDistance0 holds the values
  // before the resize began, and the pixleDistance1 holds values now that the window has been resized.
  var pixelDistance0 = {
    x: 0,
    y:0
  }, pixelDistance1 = {
    x: 0,
    y: 0
  }, deltaLeft, deltaTop;
  // deltaLeft and Top hold the horizontal and vertical movement of the image on the page
  speakerDivs.forEach(function(speakerDiv) {
    var speakerInitials = speakerInitialsFromDiv(speakerDiv);
    const speakerObj = speakerObjFromSpeakerDiv(speakerDiv);
    // If the speaker object has a proportionalPosition value, we must adjust its
    // position. Otherwise we leave it alone (it will stay where it was originally placed
    // by the startup code).
    if(speakerObj.RP){
      deltaLeft = imgLeftNew - imgLeftOld;
      deltaTop = imgTopNew - imgTopOld;
      // First, we calculate the old pixel distances (proportion * width/top)
      pixelDistance0.x = speakerObj.RP.rX * imgWidthOld;
      pixelDistance0.y = speakerObj.RP.rY * imgHeightOld;
      // The new pixel distances are based on the new image size -- PLUS the horizontal
      // and vertical position changes of the image itself.
      pixelDistance1.x = speakerObj.RP.rX * imgWidthNew + deltaLeft;
      pixelDistance1.y = speakerObj.RP.rY * imgHeightNew + deltaTop;
      // Compute the deltas
      var deltaX = pixelDistance1.x - pixelDistance0.x;
      var deltaY = pixelDistance1.y - pixelDistance0.y;
      var oldTransform = speakerDiv.style.transform;
      // Pull out the transform factors from the old transform
      var oldFactors = parseTransform(oldTransform);
      var oldX = parseFloat(oldFactors.x);
      var oldY = parseFloat(oldFactors.y);
      // Compute the new transform factors
      var newX = oldX + deltaX;
      var newY = oldY + deltaY;
      // Replace the old factors with the new ones.
      var newTransform = oldTransform.replace(oldFactors.x, `${newX}px`);
      newTransform = newTransform.replace(oldFactors.y, `${newY}px`);
      // Move the speakerDiv
      speakerDiv.style.transform = newTransform;
      // ... and tell the Interact system that we have moved the icon
      speakerDiv.setAttribute('data-x', newX);
      speakerDiv.setAttribute('data-y', newY);
    }
  });
}

function speakerInitialsFromDiv(speakerDiv){
  return speakerDiv.id.split('-').pop();
}

// During development, we create a bunch of speakers via code.
// In the production version, we will prompt the user to 
// supply this info.
function insertSpeakers(spkrContainer){
  speakers.push(Speaker.create("Lombard", "LO", "green"));
  speakers.push(Speaker.create("Marston", "MA", "blue"));
  speakers.push(Speaker.create("Claythorne", "CL", "pink"));
  speakers.push(Speaker.create("Wargrave", "WA", "orange"));
  speakers.push(Speaker.create("Blore", "BL", "purple"));
  speakers.push(Speaker.create("McKenzie", "MK", "cyan"));
  speakers.push(Speaker.create("Armstrong", "AR", "yellow"));
  speakers.push(Speaker.create("Rogers", "RO", "brown"));
  speakers.push(Speaker.create("Mrs Rogers", "RS", "lightgray"));
  speakers.push(Speaker.create("Narracot", "NA", "black"));
  speakers.push(Speaker.create("Brent", "BR", "violet"));
  // speakers.push();
  /* var currentY = 0;
  var currentX = 0;
  var yIncrement = 30;
  var bottomOfColumnY = 0;
  var topOfColumnY = 0; */
  const divParms = {
    currentY: 0,
    currentX: 0,
    yIncrement: 30,
    bottomOfColumnY: 0,
    topOfColumnY: 0
  }
  const shadowParms = {
    currentY: 0,
    currentX: 70,
    yIncrement: 30,
    bottomOfColumnY: 0,
    topOfColumnY: 0
  }
  speakers.forEach(speaker => {
    // Get the Div that contains the speaker divs
    const speakerContainer = document.getElementById('speaker-area');
    // Create a speaker div for this speaker
    var isShadow = false;  // a Shadow div is used to show the starting point of a movement
    const speakerDiv = createSpeakerDiv(dataStore, speaker, divParms, isShadow);
    speaker.speakerDiv = speakerDiv;
    isShadow = true;
    // divParms.currentX = 100;;
    const shadowDiv = createSpeakerDiv(dataStore, speaker, shadowParms, isShadow);
    speaker.shadowDiv = shadowDiv;
    divParms.currentY += divParms.yIncrement;
    // Insert it into the container div
    speakerContainer.appendChild(speakerDiv);
    speaker.originalX = speakerDiv.getAttribute('data-x');
    speaker.originalY = speakerDiv.getAttribute('data-y');
    // speakerContainer.appendChild(shadowDiv);

  });
}



var slider = null;

  function scrollOneScreen () {
    if (myIframe && myIframe.contentWindow) {
      const screenHeight = myIframe.contentWindow.innerHeight;
      myIframe.contentWindow.scrollBy({
          top: screenHeight,
          left: 0,
          behavior: 'smooth' // Optional: adds smooth scrolling animation
      });
    }
  }
  var snapTargets = [{x: 100, y: 300}];

  function ZmakeSnapTargets() {
    // Get width of sliders div
    const divSliders = document.getElementById('div-sliders');
    const divSlidersRect = divSliders.getBoundingClientRect();
    const divWidth = divSlidersRect.width;
    const myIframe = document.getElementById('script-iframe');
    const pageCount = TotalPageCount(myIframe);
    // We want one target for each page.
    var targets = [];
    if(pageCount == 0) return [{x: 100, y: 300}];
    for(var i = 1; i <= pageCount; i++){
      targets.push({x: i * divWidth / 100, y: 300});
    }
    snapTargets = targets;
  }