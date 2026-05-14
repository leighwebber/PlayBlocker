window.addEventListener('keydown', (event) => {
    switch(event.key){
      case 'Escape':
        handleEscapeKey();
        break;
      case 'F1':
        event.preventDefault();
        myIframe.contentWindow.removeEventListener('contextmenu', handleContextMenuPreventDefault);
        alert('Context menu re-enabled');
        break;
      case 'F2':
        event.preventDefault();
        contextMenuAllowed = false;
        myIframe.contentWindow.addEventListener('contextmenu', handleContextMenuPreventDefault);
        break;
    }
  });
  const getPageNumberButton = document.getElementById('get-page-number');
  // pageCount = TotalPageCount(myIframe);
  getPageNumberButton.addEventListener('click', function() {
    var currentPage = GetCurrentPageNumber(myIframe);
    var totalPages = TotalPageCount(myIframe);
  });
  window.addEventListener('keydown', function(e) {
    const iframe = myIframe;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframe.contentWindow.focus();
    switch(e.key){
      case 'ArrowUp':
        iframe.contentWindow.scrollBy(0, -40); // Scrolls up 40 pixels
        break;
      case 'ArrowDown':
        iframe.contentWindow.scrollBy(0, 40); // Scrolls down 40 pixels
        break;
      case 'PageDown' || 'PageUp':
        if(e.key == 'ArrowUp'){
          iframe.contentWindow.scrollBy(0, -40); // Scrolls down 40 pixels
          // iframeDoc.dispatchEvent(new KeyboardEvent('keydown', { key: e.key }));
        }
        else if(e.key == 'ArrowDown'){
          iframe.contentWindow.scrollBy(0, 40); // Scrolls down 40 pixels
        } 
        else if (e.key === 'PageDown' || e.key === 'PageUp') {
          // Find all target elements within the iframe
          const targets = iframeDoc.querySelectorAll('.PageBreak');
          const currentScroll = iframe.contentWindow.pageYOffset;
          
          let targetElement = null;
          
          if (e.key === 'PageDown') {
            // Find the first target element below current view
            targetElement = Array.from(targets).find(el => el.offsetTop > currentScroll + 10);
          } else {
            // Find the last target element above current view
            targetElement = Array.from(targets).reverse().find(el => el.offsetTop < currentScroll - 10);
          }
        
          if (targetElement) {
            e.preventDefault(); // Stop default page scroll
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      break;
    }
  