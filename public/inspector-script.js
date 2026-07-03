(function() {
  let isInspectorActive = false;
  let inspectorStyle = null;
  let currentHighlight = null;

  // Function to get relevant styles
  function getRelevantStyles(element) {
    const computedStyles = window.getComputedStyle(element);
    const relevantProps = [
      'display', 'position', 'width', 'height', 'margin', 'padding',
      'border', 'background', 'color', 'font-size', 'font-family',
      'text-align', 'flex-direction', 'justify-content', 'align-items'
    ];
    
    const styles = {};
    relevantProps.forEach(prop => {
      const value = computedStyles.getPropertyValue(prop);
      if (value) styles[prop] = value;
    });
    
    return styles;
  }

  // Function to create a readable element selector
  function createReadableSelector(element) {
    let selector = element.tagName.toLowerCase();
    
    // Add ID if present
    if (element.id) {
      selector += `#${element.id}`;
    }
    
    // Add classes if present
    let className = '';
    if (element.className) {
      if (typeof element.className === 'string') {
        className = element.className;
      } else if (element.className.baseVal !== undefined) {
        className = element.className.baseVal;
      } else {
        className = element.className.toString();
      }
      
      if (className.trim()) {
        const classes = className.trim().split(/\s+/).slice(0, 3); // Limit to first 3 classes
        selector += `.${classes.join('.')}`;
      }
    }
    
    return selector;
  }

  // Function to create element display text
  function createElementDisplayText(element) {
    const tagName = element.tagName.toLowerCase();
    let displayText = `<${tagName}`;
    
    // Add ID attribute
    if (element.id) {
      displayText += ` id="${element.id}"`;
    }
    
    // Add class attribute (limit to first 3 classes for readability)
    let className = '';
    if (element.className) {
      if (typeof element.className === 'string') {
        className = element.className;
      } else if (element.className.baseVal !== undefined) {
        className = element.className.baseVal;
      } else {
        className = element.className.toString();
      }
      
      if (className.trim()) {
        const classes = className.trim().split(/\s+/);
        const displayClasses = classes.length > 3 ? 
          classes.slice(0, 3).join(' ') + '...' : 
          classes.join(' ');
        displayText += ` class="${displayClasses}"`;
      }
    }
    
    // Add other important attributes
    const importantAttrs = ['type', 'name', 'href', 'src', 'alt', 'title'];
    importantAttrs.forEach(attr => {
      const value = element.getAttribute(attr);
      if (value) {
        const truncatedValue = value.length > 30 ? value.substring(0, 30) + '...' : value;
        displayText += ` ${attr}="${truncatedValue}"`;
      }
    });
    
    displayText += '>';
    
    // Add text content preview for certain elements
    const textElements = ['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'a', 'label'];
    if (textElements.includes(tagName) && element.textContent) {
      const textPreview = element.textContent.trim().substring(0, 50);
      if (textPreview) {
        displayText += textPreview.length < element.textContent.trim().length ? 
          textPreview + '...' : textPreview;
      }
    }
    
    displayText += `</${tagName}>`;
    
    return displayText;
  }

  // Function to create element info
  function createElementInfo(element) {
    const rect = element.getBoundingClientRect();
    
    return {
      tagName: element.tagName,
      className: getElementClassName(element),
      id: element.id || '',
      textContent: element.textContent?.slice(0, 100) || '',
      styles: getRelevantStyles(element),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left
      },
      // Add new readable formats
      selector: createReadableSelector(element),
      displayText: createElementDisplayText(element),
      elementPath: getElementPath(element)
    };
  }

  // Helper function to get element class name consistently
  function getElementClassName(element) {
    if (!element.className) return '';
    
    if (typeof element.className === 'string') {
      return element.className;
    } else if (element.className.baseVal !== undefined) {
      return element.className.baseVal;
    } else {
      return element.className.toString();
    }
  }

  // Function to get element path (breadcrumb)
  function getElementPath(element) {
    const path = [];
    let current = element;
    
    while (current && current !== document.body && current !== document.documentElement) {
      let pathSegment = current.tagName.toLowerCase();
      
      if (current.id) {
        pathSegment += `#${current.id}`;
      } else if (current.className) {
        const className = getElementClassName(current);
        if (className.trim()) {
          const firstClass = className.trim().split(/\s+/)[0];
          pathSegment += `.${firstClass}`;
        }
      }
      
      path.unshift(pathSegment);
      current = current.parentElement;
      
      // Limit path length
      if (path.length >= 5) break;
    }
    
    return path.join(' > ');
  }

  // Event handlers
  function handleMouseMove(e) {
    if (!isInspectorActive) return;
    
    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;

    // Remove previous highlight
    if (currentHighlight) {
      currentHighlight.classList.remove('inspector-highlight');
    }
    
    // Add highlight to current element
    target.classList.add('inspector-highlight');
    currentHighlight = target;

    const elementInfo = createElementInfo(target);
    
    // Send message to parent
    window.parent.postMessage({
      type: 'INSPECTOR_HOVER',
      elementInfo: elementInfo
    }, '*');
  }

  function handleClick(e) {
    if (!isInspectorActive) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;

    const elementInfo = createElementInfo(target);
    
    // Send message to parent
    window.parent.postMessage({
      type: 'INSPECTOR_CLICK',
      elementInfo: elementInfo
    }, '*');
  }

  function handleMouseLeave() {
    if (!isInspectorActive) return;
    
    // Remove highlight
    if (currentHighlight) {
      currentHighlight.classList.remove('inspector-highlight');
      currentHighlight = null;
    }
    
    // Send message to parent
    window.parent.postMessage({
      type: 'INSPECTOR_LEAVE'
    }, '*');
  }

  // Function to activate/deactivate inspector
  function setInspectorActive(active) {
    isInspectorActive = active;
    
    if (active) {
      // Add inspector styles
      if (!inspectorStyle) {
        inspectorStyle = document.createElement('style');
        inspectorStyle.textContent = `
          .inspector-active * {
            cursor: crosshair !important;
          }
          .inspector-highlight {
            outline: 2px solid #3b82f6 !important;
            outline-offset: -2px !important;
            background-color: rgba(59, 130, 246, 0.1) !important;
          }
        `;
        document.head.appendChild(inspectorStyle);
      }
      
      document.body.classList.add('inspector-active');
      
      // Add event listeners
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('mouseleave', handleMouseLeave, true);
    } else {
      document.body.classList.remove('inspector-active');
      
      // Remove highlight
      if (currentHighlight) {
        currentHighlight.classList.remove('inspector-highlight');
        currentHighlight = null;
      }
      
      // Remove event listeners
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('mouseleave', handleMouseLeave, true);
      
      // Remove styles
      if (inspectorStyle) {
        inspectorStyle.remove();
        inspectorStyle = null;
      }
    }
  }

  // Listen for messages from parent
  window.addEventListener('message', function(event) {
    if (event.data.type === 'INSPECTOR_ACTIVATE') {
      setInspectorActive(event.data.active);
    }

    /*
     * Screenshot capture request from the parent app. The parent asks the
     * preview iframe to capture itself because the iframe is cross-origin
     * (webcontainer-api.io) and the parent cannot read its DOM directly.
     * Here, inside the iframe, we are same-origin to document.body, so we
     * can serialize the live DOM to an SVG <foreignObject>, draw it onto a
     * canvas, and postMessage the PNG data URL back to the parent.
     *
     * This runs ONLY when the parent explicitly requests a capture (one-shot
     * per preview-ready event), so it has zero ongoing perf cost.
     */
    if (event.data.type === 'AMPLIFY_CAPTURE_SCREENSHOT') {
      try {
        var width = document.documentElement.scrollWidth || document.body.scrollWidth || 1280;
        var height = document.documentElement.scrollHeight || document.body.scrollHeight || 800;

        // Clamp to sane bounds so we don't generate a multi-megabyte PNG for
        // very tall pages. The sidebar thumbnail only needs a representative
        // top-of-page view.
        var capWidth = Math.min(width, 1600);
        var capHeight = Math.min(height, 1200);

        // Clone the document so we can strip script tags + inspector styles
        // before serialization (avoids re-executing scripts in the SVG and
        // avoids capturing the inspector's own highlight outlines).
        var cloneDoc = document.cloneNode(true);
        cloneDoc.querySelectorAll('script').forEach(function(el) { el.remove(); });
        var inspectorStyles = cloneDoc.querySelectorAll('style');
        inspectorStyles.forEach(function(st) {
          if (st.textContent && st.textContent.indexOf('inspector-') !== -1) {
            st.remove();
          }
        });
        var inspectorEls = cloneDoc.querySelectorAll('[class*="inspector-"]');
        inspectorEls.forEach(function(el) {
          var cn = el.className || '';
          cn = typeof cn === 'string' ? cn : (cn.baseVal || '');
          el.className = cn.split(/\s+/).filter(function(c) { return c.indexOf('inspector-') !== 0; }).join(' ');
        });

        // Serialize the cloned <html> (including DOCTYPE + html tag) so the
        // foreignObject renders with the right structure + computed styles.
        var serialized = '<!DOCTYPE html>' + cloneDoc.documentElement.outerHTML;

        var svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + capWidth + '" height="' + capHeight + '">' +
            '<foreignObject x="0" y="0" width="100%" height="100%">' +
              '<html xmlns="http://www.w3.org/1999/xhtml">' + serialized + '</html>' +
            '</foreignObject>' +
          '</svg>';

        var svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        var url = URL.createObjectURL(svgBlob);

        var img = new Image();
        img.onload = function() {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = capWidth;
            canvas.height = capHeight;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, capWidth, capHeight);
            ctx.drawImage(img, 0, 0, capWidth, capHeight);
            URL.revokeObjectURL(url);

            var dataUrl;
            try {
              // Downscale large captures to a JPEG-ish PNG at 0.8 quality to
              // keep the data URL small enough for IndexedDB + sidebar render.
              dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            } catch (e) {
              dataUrl = canvas.toDataURL('image/png');
            }

            window.parent.postMessage({
              type: 'AMPLIFY_SCREENSHOT_RESULT',
              requestId: event.data.requestId,
              ok: true,
              dataUrl: dataUrl,
              width: capWidth,
              height: capHeight,
            }, '*');
          } catch (err) {
            URL.revokeObjectURL(url);
            window.parent.postMessage({
              type: 'AMPLIFY_SCREENSHOT_RESULT',
              requestId: event.data.requestId,
              ok: false,
              error: String(err && err.message || err),
            }, '*');
          }
        };
        img.onerror = function() {
          URL.revokeObjectURL(url);
          window.parent.postMessage({
            type: 'AMPLIFY_SCREENSHOT_RESULT',
            requestId: event.data.requestId,
            ok: false,
            error: 'img onerror — SVG likely too large or tainted',
          }, '*');
        };
        img.src = url;
      } catch (err) {
        window.parent.postMessage({
          type: 'AMPLIFY_SCREENSHOT_RESULT',
          requestId: event.data.requestId,
          ok: false,
          error: String(err && err.message || err),
        }, '*');
      }
    }
  });

  // Auto-inject if inspector is already active
  window.parent.postMessage({ type: 'INSPECTOR_READY' }, '*');
})();