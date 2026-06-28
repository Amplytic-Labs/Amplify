import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { motion, LayoutGroup, AnimatePresence } from 'framer-motion';
import { workbenchStore } from '~/lib/stores/workbench';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import {
  activePreviewIndexAtom,
  isPortDropdownOpenAtom,
  isWindowSizeDropdownOpenAtom,
  isSelectionModeAtom,
  isInspectorModeAtom,
  isDeviceModeOnAtom,
  isFullscreenAtom,
  displayPathAtom,
  iframeUrlAtom,
  selectedWindowSizeAtom,
  isLandscapeAtom,
  showDeviceFrameAtom,
  showDeviceFrameInPreviewAtom,
  isExpoQrModalOpenAtom,
  reloadPreviewFnAtom,
  toggleFullscreenFnAtom,
  toggleInspectorFnAtom,
  hasSelectedPreviewRef,
  WINDOW_SIZES,
  type WindowSizeOption,
} from '~/lib/stores/previewHeader';

const InjectFonts = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600&display=swap');
    .custom-scroll::-webkit-scrollbar {
      width: 4px;
    }
    .custom-scroll::-webkit-scrollbar-track {
      background: transparent;
    }
    .custom-scroll::-webkit-scrollbar-thumb {
      background: var(--bolt-elements-borderColor);
      border-radius: 2px;
    }
  `}</style>
);

const springTransition = {
  type: 'spring',
  bounce: 0.12,
  duration: 0.55,
};

const getContentTransition = (isActive: boolean) => ({
  opacity: { duration: isActive ? 0.3 : 0.05, delay: isActive ? 0.15 : 0 },
  scale: { duration: isActive ? 0.3 : 0.05, delay: isActive ? 0.15 : 0 },
  filter: { duration: isActive ? 0.3 : 0.05, delay: isActive ? 0.15 : 0 },
  default: springTransition,
});

// Tooltip wrapper component
const IconWithTooltip = ({
  id,
  tooltip,
  children,
  hideTooltip = false,
  hoveredIcon,
  setHoveredIcon,
}: {
  id: string;
  tooltip: string;
  children: React.ReactNode;
  hideTooltip?: boolean;
  hoveredIcon: string | null;
  setHoveredIcon: (id: string | null) => void;
}) => (
  <div
    className="relative inline-flex items-center justify-center"
    onMouseEnter={() => !hideTooltip && setHoveredIcon(id)}
    onMouseLeave={() => setHoveredIcon(null)}
  >
    {children}
    <AnimatePresence>
      {hoveredIcon === id && !hideTooltip && (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-bolt-elements-background-depth-1 backdrop-blur-sm text-[10px] font-medium text-bolt-elements-textPrimary px-2 py-1 rounded-md whitespace-nowrap pointer-events-none z-[9999] border border-bolt-elements-borderColor shadow-sm"
        >
          {tooltip}
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

export const PreviewHeader = memo(() => {
  const inputRef = useRef<HTMLInputElement>(null);

  const previews = useStore(workbenchStore.previews);
  const activePreviewIndex = useStore(activePreviewIndexAtom);
  const activePreview = previews[activePreviewIndex];

  const isPortDropdownOpen = useStore(isPortDropdownOpenAtom);
  const isWindowSizeDropdownOpen = useStore(isWindowSizeDropdownOpenAtom);
  const isSelectionMode = useStore(isSelectionModeAtom);
  const isInspectorMode = useStore(isInspectorModeAtom);
  const isDeviceModeOn = useStore(isDeviceModeOnAtom);
  const isFullscreen = useStore(isFullscreenAtom);
  const displayPath = useStore(displayPathAtom);
  const selectedWindowSize = useStore(selectedWindowSizeAtom);
  const isLandscape = useStore(isLandscapeAtom);
  const showDeviceFrame = useStore(showDeviceFrameAtom);
  const showDeviceFrameInPreview = useStore(showDeviceFrameInPreviewAtom);
  const isExpoQrModalOpen = useStore(isExpoQrModalOpenAtom);
  const expoUrl = useStore(expoUrlAtom);

  const hasPreview = previews.length > 0;

  const reloadPreviewFn = useStore(reloadPreviewFnAtom);
  const toggleFullscreenFn = useStore(toggleFullscreenFnAtom);
  const toggleInspectorFn = useStore(toggleInspectorFnAtom);

  const reloadPreview = () => reloadPreviewFn?.();
  const toggleFullscreen = () => toggleFullscreenFn?.();
  const toggleInspectorMode = () => toggleInspectorFn?.();

  // Animated UI states
  const [activePart, setActivePart] = useState('port');
  const [hoveredIcon, setHoveredIcon] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const windowOptionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        isPortDropdownOpenAtom.set(false);
      }
      if (windowOptionsRef.current && !windowOptionsRef.current.contains(event.target as Node)) {
        isWindowSizeDropdownOpenAtom.set(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openInNewTab = () => {
    if (activePreview?.baseUrl) {
      window.open(activePreview.baseUrl, '_blank');
    }
  };

  const getFrameColor = useCallback(() => {
    const isDarkMode =
      document.documentElement.classList.contains('dark') ||
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    return isDarkMode ? '#555' : '#111';
  }, []);

  const openInNewWindow = (size: WindowSizeOption) => {
    if (activePreview?.baseUrl) {
      const match = activePreview.baseUrl.match(/^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/);
      if (match) {
        const previewId = match[1];
        const previewUrl = `/webcontainer/preview/${previewId}`;
        let width = size.width;
        let height = size.height;
        if (isLandscape && (size.frameType === 'mobile' || size.frameType === 'tablet')) {
          width = size.height;
          height = size.width;
        }
        if (showDeviceFrame && size.hasFrame) {
          const frameWidth = size.frameType === 'mobile' ? (isLandscape ? 120 : 40) : 60;
          const frameHeight = size.frameType === 'mobile' ? (isLandscape ? 80 : 80) : isLandscape ? 60 : 100;
          const newWindow = window.open(
            '',
            '_blank',
            `width=${width + frameWidth},height=${height + frameHeight + 40},menubar=no,toolbar=no,location=no,status=no`,
          );
          if (!newWindow) {
            return;
          }
          const frameColor = getFrameColor();
          const frameRadius = size.frameType === 'mobile' ? '36px' : '20px';
          const framePadding =
            size.frameType === 'mobile'
              ? isLandscape
                ? '40px 60px'
                : '40px 20px'
              : isLandscape
                ? '30px 50px'
                : '50px 30px';
          const notchTop = isLandscape ? '50%' : '20px';
          const notchLeft = isLandscape ? '30px' : '50%';
          const notchTransform = isLandscape ? 'translateY(-50%)' : 'translateX(-50%)';
          const notchWidth = isLandscape ? '8px' : size.frameType === 'mobile' ? '60px' : '80px';
          const notchHeight = isLandscape ? (size.frameType === 'mobile' ? '60px' : '80px') : '8px';
          const homeBottom = isLandscape ? '50%' : '15px';
          const homeRight = isLandscape ? '30px' : '50%';
          const homeTransform = isLandscape ? 'translateY(50%)' : 'translateX(50%)';
          const homeWidth = isLandscape ? '4px' : '40px';
          const homeHeight = isLandscape ? '40px' : '4px';
          const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${size.name} Preview</title><style>body{margin:0;padding:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f0f0;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}.device-container{position:relative}.device-name{position:absolute;top:-30px;left:0;right:0;text-align:center;font-size:14px;color:#333}.device-frame{position:relative;border-radius:${frameRadius};background:${frameColor};padding:${framePadding};box-shadow:0 10px 30px rgba(0,0,0,0.2);overflow:hidden}.device-frame:before{content:'';position:absolute;top:${notchTop};left:${notchLeft};transform:${notchTransform};width:${notchWidth};height:${notchHeight};background:#333;border-radius:4px;z-index:2}.device-frame:after{content:'';position:absolute;bottom:${homeBottom};right:${homeRight};transform:${homeTransform};width:${homeWidth};height:${homeHeight};background:#333;border-radius:50%;z-index:2}iframe{border:none;width:${width}px;height:${height}px;background:white;display:block}</style></head><body><div class="device-container"><div class="device-name">${size.name} ${isLandscape ? '(Landscape)' : '(Portrait)'}</div><div class="device-frame"><iframe src="${previewUrl}" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin" allow="cross-origin-isolated"></iframe></div></div></body></html>`;
          newWindow.document.open();
          newWindow.document.write(htmlContent);
          newWindow.document.close();
        } else {
          const newWindow = window.open(
            previewUrl,
            '_blank',
            `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`,
          );
          if (newWindow) {
            newWindow.focus();
          }
        }
      }
    }
  };

  if (!hasPreview) {
    return null;
  }

  const sortedPreviews = [...previews]
    .map((previewInfo, index) => ({ ...previewInfo, index }))
    .sort((a, b) => a.port - b.port);

  const selectedPort = activePreview?.port || '';

  return (
    <div
      className="w-full flex items-center justify-center p-2 select-none relative z-40"
      style={{ fontFamily: "'Roboto Mono', monospace" }}
    >
      <InjectFonts />
      <LayoutGroup>
        <motion.div layout transition={springTransition} className="flex items-center gap-[2px] relative">
          {/* ═══ PORT SELECTOR ═══ */}
          <div ref={dropdownRef} className="relative">
            <motion.div
              layout
              transition={springTransition}
              onMouseEnter={() => (activePart !== 'port' ? setHoveredIcon('port') : setHoveredIcon(null))}
              onMouseLeave={() => setHoveredIcon(null)}
              onClick={() => {
                if (activePart !== 'port') {
                  setActivePart('port');
                  isPortDropdownOpenAtom.set(false);
                } else {
                  isPortDropdownOpenAtom.set(!isPortDropdownOpen);
                }
              }}
              style={{
                borderRadius: '14px',
                height: '38px',
              }}
              className={`relative flex items-center justify-center overflow-visible transition-colors duration-200 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)] ${
                activePart === 'port'
                  ? 'px-[14px] w-auto cursor-pointer'
                  : 'w-[12px] p-0 cursor-pointer hover:bg-bolt-elements-background-depth-2'
              }`}
            >
              <AnimatePresence>
                {hoveredIcon === 'port' && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-bolt-elements-background-depth-1 backdrop-blur-sm text-[10px] font-medium text-bolt-elements-textPrimary px-2 py-1 rounded-md whitespace-nowrap pointer-events-none z-[9999] border border-bolt-elements-borderColor shadow-sm"
                  >
                    Ports
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div
                layout
                animate={{
                  opacity: activePart === 'port' ? 1 : 0,
                  scale: activePart === 'port' ? 1 : 0.8,
                  filter: activePart === 'port' ? 'blur(0px)' : 'blur(4px)',
                }}
                transition={getContentTransition(activePart === 'port')}
                className="flex items-center text-sm font-medium text-bolt-elements-textPrimary whitespace-nowrap"
              >
                <div className="i-ph:plug w-3.5 h-3.5 mr-2" />
                <span>{selectedPort}</span>
                <svg
                  className={`w-3 h-3 ml-1.5 opacity-50 transition-transform duration-200 ${isPortDropdownOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </motion.div>
            </motion.div>

            <AnimatePresence>
              {isPortDropdownOpen && activePart === 'port' && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  style={{
                    borderRadius: '12px',
                  }}
                  className="absolute left-0 mt-2 w-[130px] z-50 py-1.5 custom-scroll max-h-[200px] overflow-y-auto bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor shadow-lg"
                >
                  {sortedPreviews.map((preview) => (
                    <div
                      key={preview.port}
                      onClick={(e) => {
                        e.stopPropagation();
                        activePreviewIndexAtom.set(preview.index);
                        isPortDropdownOpenAtom.set(false);
                        hasSelectedPreviewRef.current = true;
                      }}
                      className={`px-3 py-1.5 text-xs text-left cursor-pointer transition-colors duration-150 flex items-center justify-between ${
                        activePreviewIndex === preview.index
                          ? 'text-bolt-elements-item-contentAccent bg-bolt-elements-background-depth-2 font-semibold'
                          : 'text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 hover:text-bolt-elements-item-contentActive'
                      }`}
                    >
                      <span>{preview.port}</span>
                      {activePreviewIndex === preview.index && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      )}
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ═══ TOOLS / SCREEN OPTIONS ═══ */}
          <motion.div
            layout
            transition={springTransition}
            onMouseEnter={() => (activePart !== 'tools' ? setHoveredIcon('tools') : setHoveredIcon(null))}
            onMouseLeave={() => setHoveredIcon(null)}
            onClick={() => {
              if (activePart !== 'tools') {
                setActivePart('tools');
                isPortDropdownOpenAtom.set(false);
              }
            }}
            style={{
              borderRadius: '14px',
              height: '38px',
            }}
            className={`relative flex items-center justify-center overflow-visible transition-colors duration-200 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)] ${
              activePart === 'tools'
                ? 'px-[14px] w-auto cursor-default'
                : 'w-[12px] p-0 cursor-pointer hover:bg-bolt-elements-background-depth-2'
            }`}
          >
            <AnimatePresence>
              {hoveredIcon === 'tools' && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-bolt-elements-background-depth-1 backdrop-blur-sm text-[10px] font-medium text-bolt-elements-textPrimary px-2 py-1 rounded-md whitespace-nowrap pointer-events-none z-[9999] border border-bolt-elements-borderColor shadow-sm"
                >
                  Tools
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              layout
              animate={{
                opacity: activePart === 'tools' ? 1 : 0,
                scale: activePart === 'tools' ? 1 : 0.8,
                filter: activePart === 'tools' ? 'blur(0px)' : 'blur(4px)',
              }}
              transition={getContentTransition(activePart === 'tools')}
              className="flex items-center gap-3.5 text-bolt-elements-textPrimary whitespace-nowrap"
              style={{ pointerEvents: activePart === 'tools' ? 'auto' : 'none' }}
            >
              <IconWithTooltip id="refresh" tooltip="Refresh" hoveredIcon={hoveredIcon} setHoveredIcon={setHoveredIcon}>
                <div
                  className="i-ph:arrow-clockwise w-5 h-5 text-bolt-elements-textPrimary hover:text-bolt-elements-item-contentActive transition-colors cursor-pointer"
                  onClick={reloadPreview}
                />
              </IconWithTooltip>

              <IconWithTooltip
                id="selection"
                tooltip="Selection Mode"
                hoveredIcon={hoveredIcon}
                setHoveredIcon={setHoveredIcon}
              >
                <div
                  className={`flex items-center justify-center p-1 rounded-md transition-colors cursor-pointer ${isSelectionMode ? 'bg-bolt-elements-background-depth-2 text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 hover:text-bolt-elements-item-contentActive'}`}
                  onClick={() => isSelectionModeAtom.set(!isSelectionMode)}
                >
                  <div className="i-ph:selection w-5 h-5" />
                </div>
              </IconWithTooltip>

              <IconWithTooltip
                id="devices"
                tooltip={isDeviceModeOn ? 'Switch to Responsive Mode' : 'Switch to Device Mode'}
                hideTooltip={isDeviceModeOn}
                hoveredIcon={hoveredIcon}
                setHoveredIcon={setHoveredIcon}
              >
                <div
                  className={`flex items-center justify-center p-1 rounded-md transition-colors cursor-pointer ${isDeviceModeOn ? 'bg-bolt-elements-background-depth-2 text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 hover:text-bolt-elements-item-contentActive'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    isDeviceModeOnAtom.set(!isDeviceModeOn);
                  }}
                >
                  <div className="i-ph:devices w-5 h-5" />
                </div>
              </IconWithTooltip>

              <AnimatePresence>
                {isDeviceModeOn && (
                  <>
                    <motion.div
                      initial={{ opacity: 0, x: -10, scale: 0.8 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -10, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                      className="flex items-center"
                    >
                      <IconWithTooltip
                        id="landscape"
                        tooltip={isLandscape ? 'Switch to Portrait' : 'Switch to Landscape'}
                        hoveredIcon={hoveredIcon}
                        setHoveredIcon={setHoveredIcon}
                      >
                        <div
                          className="i-ph:device-rotate w-5 h-5 text-bolt-elements-textPrimary hover:text-bolt-elements-item-contentActive transition-colors cursor-pointer"
                          onClick={() => isLandscapeAtom.set(!isLandscape)}
                        />
                      </IconWithTooltip>
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, x: -10, scale: 0.8 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -10, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                      className="flex items-center"
                    >
                      <IconWithTooltip
                        id="frame"
                        tooltip={showDeviceFrameInPreview ? 'Hide Device Frame' : 'Show Device Frame'}
                        hoveredIcon={hoveredIcon}
                        setHoveredIcon={setHoveredIcon}
                      >
                        <div
                          className={`${showDeviceFrameInPreview ? 'i-ph:device-mobile' : 'i-ph:device-mobile-slash'} w-5 h-5 text-bolt-elements-textPrimary hover:text-bolt-elements-item-contentActive transition-colors cursor-pointer`}
                          onClick={() => showDeviceFrameInPreviewAtom.set(!showDeviceFrameInPreview)}
                        />
                      </IconWithTooltip>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              {expoUrl && (
                <IconWithTooltip id="qr" tooltip="Show QR" hoveredIcon={hoveredIcon} setHoveredIcon={setHoveredIcon}>
                  <div
                    className="i-ph:qr-code w-5 h-5 text-bolt-elements-textPrimary hover:text-bolt-elements-item-contentActive transition-colors cursor-pointer"
                    onClick={() => isExpoQrModalOpenAtom.set(true)}
                  />
                </IconWithTooltip>
              )}

              <IconWithTooltip
                id="inspector"
                tooltip={isInspectorMode ? 'Disable Element Inspector' : 'Enable Element Inspector'}
                hoveredIcon={hoveredIcon}
                setHoveredIcon={setHoveredIcon}
              >
                <div
                  className={`flex items-center justify-center p-1 rounded-md transition-colors cursor-pointer ${isInspectorMode ? 'bg-bolt-elements-background-depth-2 text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 hover:text-bolt-elements-item-contentActive'}`}
                  onClick={toggleInspectorMode}
                >
                  <div className="i-ph:cursor-click w-5 h-5" />
                </div>
              </IconWithTooltip>

              <IconWithTooltip
                id="fullscreen"
                tooltip={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                hoveredIcon={hoveredIcon}
                setHoveredIcon={setHoveredIcon}
              >
                <div
                  className={`${isFullscreen ? 'i-ph:arrows-in' : 'i-ph:arrows-out'} w-5 h-5 text-bolt-elements-textPrimary hover:text-bolt-elements-item-contentActive transition-colors cursor-pointer`}
                  onClick={toggleFullscreen}
                />
              </IconWithTooltip>

              <div ref={windowOptionsRef} className="relative flex items-center">
                <IconWithTooltip
                  id="windowoptions"
                  tooltip="Window Options"
                  hoveredIcon={hoveredIcon}
                  setHoveredIcon={setHoveredIcon}
                >
                  <div
                    className="i-ph:list w-5 h-5 text-bolt-elements-textPrimary hover:text-bolt-elements-item-contentActive transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      isWindowSizeDropdownOpenAtom.set(!isWindowSizeDropdownOpen);
                    }}
                  />
                </IconWithTooltip>

                {isWindowSizeDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 z-50 min-w-[240px] max-h-[400px] overflow-y-auto bg-bolt-elements-background-depth-3 rounded-xl shadow-2xl border border-bolt-elements-borderColor overflow-hidden cursor-default text-left">
                    <div className="p-3 border-b border-bolt-elements-borderColor">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-bolt-elements-textPrimary font-sans">
                          Window Options
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          className="flex w-full justify-between items-center text-start bg-transparent text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary font-sans"
                          onClick={openInNewTab}
                        >
                          <span>Open in new tab</span>
                          <div className="i-ph:arrow-square-out h-5 w-4" />
                        </button>
                        <button
                          className="flex w-full justify-between items-center text-start bg-transparent text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary font-sans"
                          onClick={() => {
                            if (!activePreview?.baseUrl) return;
                            const match = activePreview.baseUrl.match(
                              /^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/,
                            );
                            if (!match) return;
                            const previewId = match[1];
                            const previewUrl = `/webcontainer/preview/${previewId}`;
                            window.open(
                              previewUrl,
                              `preview-${previewId}`,
                              'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes',
                            );
                          }}
                        >
                          <span>Open in new window</span>
                          <div className="i-ph:browser h-5 w-4" />
                        </button>
                        <div className="flex items-center justify-between font-sans">
                          <span className="text-xs text-bolt-elements-textTertiary">Show Device Frame</span>
                          <button
                            className={`w-10 h-5 rounded-full transition-colors duration-200 ${showDeviceFrame ? 'bg-bolt-elements-item-contentAccent' : 'bg-bolt-elements-background-depth-4'} relative`}
                            onClick={(e) => {
                              e.stopPropagation();
                              showDeviceFrameAtom.set(!showDeviceFrame);
                            }}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${showDeviceFrame ? 'transform translate-x-5' : ''}`}
                            />
                          </button>
                        </div>
                        <div className="flex items-center justify-between font-sans">
                          <span className="text-xs text-bolt-elements-textTertiary">Landscape Mode</span>
                          <button
                            className={`w-10 h-5 rounded-full transition-colors duration-200 ${isLandscape ? 'bg-bolt-elements-item-contentAccent' : 'bg-bolt-elements-background-depth-4'} relative`}
                            onClick={(e) => {
                              e.stopPropagation();
                              isLandscapeAtom.set(!isLandscape);
                            }}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${isLandscape ? 'transform translate-x-5' : ''}`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                    {WINDOW_SIZES.map((size) => (
                      <button
                        key={size.name}
                        className="w-full px-4 py-3.5 text-left text-bolt-elements-textPrimary text-sm whitespace-nowrap flex items-center gap-3 group hover:bg-bolt-elements-background-depth-2 bg-transparent font-sans"
                        onClick={() => {
                          selectedWindowSizeAtom.set(size);
                          isWindowSizeDropdownOpenAtom.set(false);
                          openInNewWindow(size);
                        }}
                      >
                        <div
                          className={`${size.icon} w-5 h-5 text-bolt-elements-textSecondary group-hover:text-bolt-elements-item-contentAccent transition-colors duration-200`}
                        />
                        <div className="flex-grow flex flex-col">
                          <span className="font-medium group-hover:text-bolt-elements-item-contentAccent transition-colors duration-200">
                            {size.name}
                          </span>
                          <span className="text-xs text-bolt-elements-textSecondary group-hover:text-bolt-elements-item-contentAccent transition-colors duration-200">
                            {isLandscape && (size.frameType === 'mobile' || size.frameType === 'tablet')
                              ? `${size.height} × ${size.width}`
                              : `${size.width} × ${size.height}`}
                            {size.hasFrame && showDeviceFrame ? ' (with frame)' : ''}
                          </span>
                        </div>
                        {selectedWindowSize.name === size.name && (
                          <div className="text-bolt-elements-item-contentAccent">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>

          {/* ═══ PATH INPUT ═══ */}
          <motion.div
            layout
            transition={springTransition}
            onMouseEnter={() => (activePart !== 'input' ? setHoveredIcon('input') : setHoveredIcon(null))}
            onMouseLeave={() => setHoveredIcon(null)}
            onClick={() => {
              setActivePart('input');
              setTimeout(() => inputRef.current?.focus(), 100);
            }}
            style={{
              borderRadius: '14px',
              height: '38px',
            }}
            className={`relative flex items-center justify-center overflow-visible transition-colors duration-200 bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)] ${
              activePart === 'input'
                ? 'w-[240px] px-3 cursor-default'
                : 'w-[12px] p-0 cursor-pointer hover:bg-bolt-elements-background-depth-2'
            }`}
          >
            <AnimatePresence>
              {hoveredIcon === 'input' && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-bolt-elements-background-depth-1 backdrop-blur-sm text-[10px] font-medium text-bolt-elements-textPrimary px-2 py-1 rounded-md whitespace-nowrap pointer-events-none z-[9999] border border-bolt-elements-borderColor shadow-sm"
                >
                  Path
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              layout
              animate={{ opacity: activePart === 'input' ? 1 : 0, scale: activePart === 'input' ? 1 : 0.8 }}
              transition={getContentTransition(activePart === 'input')}
              className="w-full flex items-center h-full gap-1"
              style={{ pointerEvents: activePart === 'input' ? 'auto' : 'none' }}
            >
              <input
                ref={inputRef}
                type="text"
                placeholder="path"
                value={displayPath}
                onChange={(e) => displayPathAtom.set(e.target.value.replace(/^\//, ''))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && activePreview) {
                    let targetPath = displayPath.trim();
                    if (!targetPath.startsWith('/')) {
                      targetPath = '/' + targetPath;
                    }
                    const fullUrl = activePreview.baseUrl + targetPath;
                    iframeUrlAtom.set(fullUrl);
                    displayPathAtom.set(targetPath);
                    if (inputRef.current) {
                      inputRef.current.blur();
                    }
                  }
                }}
                className="w-full bg-transparent text-xs text-bolt-elements-textPrimary border-none outline-none focus:ring-0 font-medium placeholder-bolt-elements-textTertiary"
              />
            </motion.div>
          </motion.div>
        </motion.div>
      </LayoutGroup>
      <ExpoQrModal open={isExpoQrModalOpen} onClose={() => isExpoQrModalOpenAtom.set(false)} />
    </div>
  );
});
