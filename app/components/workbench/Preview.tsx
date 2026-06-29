import { memo, useCallback, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { ScreenshotSelector } from './ScreenshotSelector';
import type { ElementInfo } from './Inspector';
import {
  activePreviewIndexAtom,
  isSelectionModeAtom,
  isInspectorModeAtom,
  isDeviceModeOnAtom,
  isFullscreenAtom,
  displayPathAtom,
  iframeUrlAtom,
  selectedWindowSizeAtom,
  isLandscapeAtom,
  showDeviceFrameInPreviewAtom,
  widthPercentAtom,
  currentWidthAtom,
  reloadPreviewFnAtom,
  toggleFullscreenFnAtom,
  toggleInspectorFnAtom,
  hasSelectedPreviewRef,
} from '~/lib/stores/previewHeader';

type ResizeSide = 'left' | 'right' | null;

interface PreviewProps {
  setSelectedElement?: (element: ElementInfo | null) => void;
}

export const Preview = memo(({ setSelectedElement }: PreviewProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Read shared state from the previewHeader store (UI lives in PreviewHeader)
  const activePreviewIndex = useStore(activePreviewIndexAtom);
  const isFullscreen = useStore(isFullscreenAtom);
  const isSelectionMode = useStore(isSelectionModeAtom);
  const isInspectorMode = useStore(isInspectorModeAtom);
  const isDeviceModeOn = useStore(isDeviceModeOnAtom);
  const widthPercent = useStore(widthPercentAtom);
  const currentWidth = useStore(currentWidthAtom);
  const selectedWindowSize = useStore(selectedWindowSizeAtom);
  const isLandscape = useStore(isLandscapeAtom);
  const showDeviceFrameInPreview = useStore(showDeviceFrameInPreviewAtom);

  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];
  const iframeUrl = useStore(iframeUrlAtom);

  const resizingState = useRef({
    isResizing: false,
    side: null as ResizeSide,
    startX: 0,
    startWidthPercent: 37.5,
    windowWidth: window.innerWidth,
    pointerId: null as number | null,
  });

  // Reduce scaling factor to make resizing less sensitive
  const SCALING_FACTOR = 1;

  // Sync iframe URL and display path when active preview changes
  useEffect(() => {
    if (!activePreview) {
      iframeUrlAtom.set(undefined);
      displayPathAtom.set('/');
      return;
    }

    const { baseUrl } = activePreview;
    iframeUrlAtom.set(baseUrl);
    displayPathAtom.set('/');
  }, [activePreview]);

  const findMinPortIndex = useCallback(
    (minIndex: number, preview: { port: number }, index: number, array: { port: number }[]) => {
      return preview.port < array[minIndex].port ? index : minIndex;
    },
    [],
  );

  useEffect(() => {
    if (previews.length > 1 && !hasSelectedPreviewRef.current) {
      const minPortIndex = previews.reduce(findMinPortIndex, 0);
      activePreviewIndexAtom.set(minPortIndex);
    }
  }, [previews, findMinPortIndex]);

  // Iframe-dependent actions — register them to the store so PreviewHeader can invoke them
  const reloadPreview = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!isFullscreen && containerRef.current) {
      await containerRef.current.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  }, [isFullscreen]);

  const toggleInspectorMode = useCallback(() => {
    const newInspectorMode = !isInspectorMode;
    isInspectorModeAtom.set(newInspectorMode);

    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'INSPECTOR_ACTIVATE', active: newInspectorMode }, '*');
    }
  }, [isInspectorMode]);

  useEffect(() => {
    reloadPreviewFnAtom.set(reloadPreview);
    toggleFullscreenFnAtom.set(toggleFullscreen);
    toggleInspectorFnAtom.set(toggleInspectorMode);

    return () => {
      reloadPreviewFnAtom.set(null);
      toggleFullscreenFnAtom.set(null);
      toggleInspectorFnAtom.set(null);
    };
  }, [reloadPreview, toggleFullscreen, toggleInspectorMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      isFullscreenAtom.set(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const startResizing = (e: React.PointerEvent, side: ResizeSide) => {
    if (!isDeviceModeOn) {
      return;
    }

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';

    resizingState.current = {
      isResizing: true,
      side,
      startX: e.clientX,
      startWidthPercent: widthPercent,
      windowWidth: window.innerWidth,
      pointerId: e.pointerId,
    };
  };

  const ResizeHandle = ({ side }: { side: ResizeSide }) => {
    if (!side) {
      return null;
    }

    return (
      <div
        className={`resize-handle-${side}`}
        onPointerDown={(e) => startResizing(e, side)}
        style={{
          position: 'absolute',
          top: 0,
          ...(side === 'left' ? { left: 0, marginLeft: '-7px' } : { right: 0, marginRight: '-7px' }),
          width: '15px',
          height: '100%',
          cursor: 'ew-resize',
          background: 'var(--amplify-elements-background-depth-4, rgba(0,0,0,.3))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.2s',
          userSelect: 'none',
          touchAction: 'none',
          zIndex: 10,
        }}
        onMouseOver={(e) =>
          (e.currentTarget.style.background = 'var(--amplify-elements-background-depth-4, rgba(0,0,0,.3))')
        }
        onMouseOut={(e) =>
          (e.currentTarget.style.background = 'var(--amplify-elements-background-depth-3, rgba(0,0,0,.15))')
        }
        title="Drag to resize width"
      >
        <GripIcon />
      </div>
    );
  };

  useEffect(() => {
    // Skip if not in device mode
    if (!isDeviceModeOn) {
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      const state = resizingState.current;

      if (!state.isResizing || e.pointerId !== state.pointerId) {
        return;
      }

      const dx = e.clientX - state.startX;
      const dxPercent = (dx / state.windowWidth) * 100 * SCALING_FACTOR;

      let newWidthPercent = state.startWidthPercent;

      if (state.side === 'right') {
        newWidthPercent = state.startWidthPercent + dxPercent;
      } else if (state.side === 'left') {
        newWidthPercent = state.startWidthPercent - dxPercent;
      }

      // Limit width percentage between 10% and 90%
      newWidthPercent = Math.max(10, Math.min(newWidthPercent, 90));

      // Force a synchronous update to ensure the UI reflects the change immediately
      widthPercentAtom.set(newWidthPercent);

      // Calculate and update the actual pixel width
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const newWidth = Math.round((containerWidth * newWidthPercent) / 100);
        currentWidthAtom.set(newWidth);

        // Apply the width directly to the container for immediate feedback
        const previewContainer = containerRef.current.querySelector('div[style*="width"]');

        if (previewContainer) {
          (previewContainer as HTMLElement).style.width = `${newWidthPercent}%`;
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const state = resizingState.current;

      if (!state.isResizing || e.pointerId !== state.pointerId) {
        return;
      }

      // Find all resize handles
      const handles = document.querySelectorAll('.resize-handle-left, .resize-handle-right');

      // Release pointer capture from any handle that has it
      handles.forEach((handle) => {
        if ((handle as HTMLElement).hasPointerCapture?.(e.pointerId)) {
          (handle as HTMLElement).releasePointerCapture(e.pointerId);
        }
      });

      // Reset state
      resizingState.current = {
        ...resizingState.current,
        isResizing: false,
        side: null,
        pointerId: null,
      };

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    // Add event listeners
    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    // Define cleanup function
    function cleanupResizeListeners() {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);

      // Release any lingering pointer captures
      if (resizingState.current.pointerId !== null) {
        const handles = document.querySelectorAll('.resize-handle-left, .resize-handle-right');
        handles.forEach((handle) => {
          if ((handle as HTMLElement).hasPointerCapture?.(resizingState.current.pointerId!)) {
            (handle as HTMLElement).releasePointerCapture(resizingState.current.pointerId!);
          }
        });

        // Reset state
        resizingState.current = {
          ...resizingState.current,
          isResizing: false,
          side: null,
          pointerId: null,
        };

        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    }

    // Return the cleanup function
    // eslint-disable-next-line consistent-return
    return cleanupResizeListeners;
  }, [isDeviceModeOn, SCALING_FACTOR]);

  useEffect(() => {
    const handleWindowResize = () => {
      // Update the window width in the resizing state
      resizingState.current.windowWidth = window.innerWidth;

      // Update the current width in pixels
      if (containerRef.current && isDeviceModeOn) {
        const containerWidth = containerRef.current.clientWidth;
        currentWidthAtom.set(Math.round((containerWidth * widthPercent) / 100));
      }
    };

    window.addEventListener('resize', handleWindowResize);

    // Initial calculation of current width
    if (containerRef.current && isDeviceModeOn) {
      const containerWidth = containerRef.current.clientWidth;
      currentWidthAtom.set(Math.round((containerWidth * widthPercent) / 100));
    }

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [isDeviceModeOn, widthPercent]);

  // Update current width when device mode is toggled
  useEffect(() => {
    if (containerRef.current && isDeviceModeOn) {
      const containerWidth = containerRef.current.clientWidth;
      currentWidthAtom.set(Math.round((containerWidth * widthPercent) / 100));
    }
  }, [isDeviceModeOn]);

  const GripIcon = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          color: 'var(--amplify-elements-textSecondary, rgba(0,0,0,0.5))',
          fontSize: '10px',
          lineHeight: '5px',
          userSelect: 'none',
          marginLeft: '1px',
        }}
      >
        ••• •••
      </div>
    </div>
  );

  // Function to get the scale factor for the device frame
  const getDeviceScale = useCallback(() => {
    // Always return 1 to ensure the device frame is shown at its exact size
    return 1;
  }, [isLandscape, selectedWindowSize, widthPercent]);

  // Update the device scale when needed
  useEffect(() => {
    /*
     * Intentionally disabled - we want to maintain scale of 1
     * No dynamic scaling to ensure device frame matches external window exactly
     */
    // Intentionally empty cleanup function - no cleanup needed
    return () => {
      // No cleanup needed
    };
  }, [isDeviceModeOn, showDeviceFrameInPreview, getDeviceScale, isLandscape, selectedWindowSize]);

  // Function to get the frame color based on dark mode
  const getFrameColor = useCallback(() => {
    // Check if the document has a dark class or data-theme="dark"
    const isDarkMode =
      document.documentElement.classList.contains('dark') ||
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Return a darker color for light mode, lighter color for dark mode
    return isDarkMode ? '#555' : '#111';
  }, []);

  // Function to get the correct frame padding based on orientation
  const getFramePadding = useCallback(() => {
    if (!selectedWindowSize) {
      return '40px 20px';
    }

    const isMobile = selectedWindowSize.frameType === 'mobile';

    if (isLandscape) {
      // Increase horizontal padding in landscape mode to ensure full device frame is visible
      return isMobile ? '40px 60px' : '30px 50px';
    }

    return isMobile ? '40px 20px' : '50px 30px';
  }, [isLandscape, selectedWindowSize]);

  // Effect to handle color scheme changes
  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleColorSchemeChange = () => {
      // Force a re-render when color scheme changes
      if (showDeviceFrameInPreview) {
        showDeviceFrameInPreviewAtom.set(true);
      }
    };

    darkModeMediaQuery.addEventListener('change', handleColorSchemeChange);

    return () => {
      darkModeMediaQuery.removeEventListener('change', handleColorSchemeChange);
    };
  }, [showDeviceFrameInPreview]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'INSPECTOR_READY') {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            {
              type: 'INSPECTOR_ACTIVATE',
              active: isInspectorMode,
            },
            '*',
          );
        }
      } else if (event.data.type === 'INSPECTOR_CLICK') {
        const element = event.data.elementInfo;

        navigator.clipboard.writeText(element.displayText).then(() => {
          setSelectedElement?.(element);
        });
      }
    };

    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);
  }, [isInspectorMode]);

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col relative">
      <div className="flex-1  flex justify-center items-center overflow-auto">
        <div
          style={{
            width: isDeviceModeOn ? (showDeviceFrameInPreview ? '100%' : `${widthPercent}%`) : '100%',
            height: '100%',
            overflow: 'auto',
            background: 'var(--amplify-elements-background-depth-1)',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {activePreview ? (
            <>
              {isDeviceModeOn && showDeviceFrameInPreview ? (
                <div
                  className="device-wrapper"
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: '100%',
                    height: '100%',
                    padding: '0',
                    overflow: 'auto',
                    transition: 'all 0.3s ease',
                    position: 'relative',
                  }}
                >
                  <div
                    className="device-frame-container"
                    style={{
                      position: 'relative',
                      borderRadius: selectedWindowSize.frameType === 'mobile' ? '36px' : '20px',
                      background: getFrameColor(),
                      padding: getFramePadding(),
                      boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
                      overflow: 'hidden',
                      transform: 'scale(1)',
                      transformOrigin: 'center center',
                      transition: 'all 0.3s ease',
                      margin: '40px',
                      width: isLandscape
                        ? `${selectedWindowSize.height + (selectedWindowSize.frameType === 'mobile' ? 120 : 60)}px`
                        : `${selectedWindowSize.width + (selectedWindowSize.frameType === 'mobile' ? 40 : 60)}px`,
                      height: isLandscape
                        ? `${selectedWindowSize.width + (selectedWindowSize.frameType === 'mobile' ? 80 : 60)}px`
                        : `${selectedWindowSize.height + (selectedWindowSize.frameType === 'mobile' ? 80 : 100)}px`,
                    }}
                  >
                    {/* Notch - positioned based on orientation */}
                    <div
                      style={{
                        position: 'absolute',
                        top: isLandscape ? '50%' : '20px',
                        left: isLandscape ? '30px' : '50%',
                        transform: isLandscape ? 'translateY(-50%)' : 'translateX(-50%)',
                        width: isLandscape ? '8px' : selectedWindowSize.frameType === 'mobile' ? '60px' : '80px',
                        height: isLandscape ? (selectedWindowSize.frameType === 'mobile' ? '60px' : '80px') : '8px',
                        background: '#333',
                        borderRadius: '4px',
                        zIndex: 2,
                      }}
                    />

                    {/* Home button - positioned based on orientation */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: isLandscape ? '50%' : '15px',
                        right: isLandscape ? '30px' : '50%',
                        transform: isLandscape ? 'translateY(50%)' : 'translateX(50%)',
                        width: isLandscape ? '4px' : '40px',
                        height: isLandscape ? '40px' : '4px',
                        background: '#333',
                        borderRadius: '50%',
                        zIndex: 2,
                      }}
                    />

                    <iframe
                      ref={iframeRef}
                      title="preview"
                      style={{
                        border: 'none',
                        width: isLandscape ? `${selectedWindowSize.height}px` : `${selectedWindowSize.width}px`,
                        height: isLandscape ? `${selectedWindowSize.width}px` : `${selectedWindowSize.height}px`,
                        background: 'white',
                        display: 'block',
                      }}
                      src={iframeUrl}
                      sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
                      allow="cross-origin-isolated"
                    />
                  </div>
                </div>
              ) : (
                <iframe
                  ref={iframeRef}
                  title="preview"
                  className="border-none w-full h-full bg-amplify-elements-background-depth-1"
                  src={iframeUrl}
                  sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
                  allow="geolocation; ch-ua-full-version-list; cross-origin-isolated; screen-wake-lock; publickey-credentials-get; shared-storage-select-url; ch-ua-arch; bluetooth; compute-pressure; ch-prefers-reduced-transparency; deferred-fetch; usb; ch-save-data; publickey-credentials-create; shared-storage; deferred-fetch-minimal; run-ad-auction; ch-ua-form-factors; ch-downlink; otp-credentials; payment; ch-ua; ch-ua-model; ch-ect; autoplay; camera; private-state-token-issuance; accelerometer; ch-ua-platform-version; idle-detection; private-aggregation; interest-cohort; ch-viewport-height; local-fonts; ch-ua-platform; midi; ch-ua-full-version; xr-spatial-tracking; clipboard-read; gamepad; display-capture; keyboard-map; join-ad-interest-group; ch-width; ch-prefers-reduced-motion; browsing-topics; encrypted-media; gyroscope; serial; ch-rtt; ch-ua-mobile; window-management; unload; ch-dpr; ch-prefers-color-scheme; ch-ua-wow64; attribution-reporting; fullscreen; identity-credentials-get; private-state-token-redemption; hid; ch-ua-bitness; storage-access; sync-xhr; ch-device-memory; ch-viewport-width; picture-in-picture; magnetometer; clipboard-write; microphone"
                />
              )}
              <ScreenshotSelector
                isSelectionMode={isSelectionMode}
                setIsSelectionMode={(value) => isSelectionModeAtom.set(value)}
                containerRef={iframeRef}
              />
            </>
          ) : (
            <div className="flex w-full h-full justify-center items-center bg-amplify-elements-background-depth-1 text-amplify-elements-textPrimary">
              No preview available
            </div>
          )}

          {isDeviceModeOn && !showDeviceFrameInPreview && (
            <>
              {/* Width indicator */}
              <div
                style={{
                  position: 'absolute',
                  top: '-25px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--amplify-elements-background-depth-3, rgba(0,0,0,0.7))',
                  color: 'var(--amplify-elements-textPrimary, white)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  pointerEvents: 'none',
                  opacity: resizingState.current.isResizing ? 1 : 0,
                  transition: 'opacity 0.3s',
                }}
              >
                {currentWidth}px
              </div>

              <ResizeHandle side="left" />
              <ResizeHandle side="right" />
            </>
          )}
        </div>
      </div>
    </div>
  );
});
