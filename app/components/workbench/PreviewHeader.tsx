import { memo, useCallback, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import { PortDropdown } from './PortDropdown';
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

  // Don't render if there's no preview available
  if (!hasPreview) {
    return null;
  }

  return (
    <>
      {isPortDropdownOpen && <div className="fixed inset-0 z-50" onClick={() => isPortDropdownOpenAtom.set(false)} />}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <IconButton icon="i-ph:arrow-clockwise" onClick={reloadPreview} />
          <IconButton
            icon="i-ph:selection"
            onClick={() => isSelectionModeAtom.set(!isSelectionMode)}
            className={isSelectionMode ? 'bg-bolt-elements-background-depth-3' : ''}
          />
        </div>

        <div className="flex-grow flex items-center gap-1 bg-bolt-elements-preview-addressBar-background border border-bolt-elements-borderColor text-bolt-elements-preview-addressBar-text rounded-full px-1 py-1 text-sm hover:bg-bolt-elements-preview-addressBar-backgroundHover hover:focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within-border-bolt-elements-borderColorActive focus-within:text-bolt-elements-preview-addressBar-textActive">
          <PortDropdown
            activePreviewIndex={activePreviewIndex}
            setActivePreviewIndex={(index) => activePreviewIndexAtom.set(index)}
            isDropdownOpen={isPortDropdownOpen}
            setHasSelectedPreview={(value) => (hasSelectedPreviewRef.current = value)}
            setIsDropdownOpen={(value) => isPortDropdownOpenAtom.set(value)}
            previews={previews}
          />
          <input
            title="URL Path"
            ref={inputRef}
            className="w-full bg-transparent outline-none"
            type="text"
            value={displayPath}
            onChange={(event) => displayPathAtom.set(event.target.value)}
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
            disabled={!activePreview}
          />
        </div>

        <div className="flex items-center gap-2">
          <IconButton
            icon="i-ph:devices"
            onClick={() => isDeviceModeOnAtom.set(!isDeviceModeOn)}
            title={isDeviceModeOn ? 'Switch to Responsive Mode' : 'Switch to Device Mode'}
          />

          {expoUrl && (
            <IconButton icon="i-ph:qr-code" onClick={() => isExpoQrModalOpenAtom.set(true)} title="Show QR" />
          )}

          <ExpoQrModal open={isExpoQrModalOpen} onClose={() => isExpoQrModalOpenAtom.set(false)} />

          {isDeviceModeOn && (
            <>
              <IconButton
                icon="i-ph:device-rotate"
                onClick={() => isLandscapeAtom.set(!isLandscape)}
                title={isLandscape ? 'Switch to Portrait' : 'Switch to Landscape'}
              />
              <IconButton
                icon={showDeviceFrameInPreview ? 'i-ph:device-mobile' : 'i-ph:device-mobile-slash'}
                onClick={() => showDeviceFrameInPreviewAtom.set(!showDeviceFrameInPreview)}
                title={showDeviceFrameInPreview ? 'Hide Device Frame' : 'Show Device Frame'}
              />
            </>
          )}
          <IconButton
            icon="i-ph:cursor-click"
            onClick={toggleInspectorMode}
            className={
              isInspectorMode ? 'bg-bolt-elements-background-depth-3 !text-bolt-elements-item-contentAccent' : ''
            }
            title={isInspectorMode ? 'Disable Element Inspector' : 'Enable Element Inspector'}
          />
          <IconButton
            icon={isFullscreen ? 'i-ph:arrows-in' : 'i-ph:arrows-out'}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          />

          <div className="flex items-center relative">
            <IconButton
              icon="i-ph:list"
              onClick={() => isWindowSizeDropdownOpenAtom.set(!isWindowSizeDropdownOpen)}
              title="New Window Options"
            />
            {isWindowSizeDropdownOpen && (
              <>
                <div className="fixed inset-0 z-50" onClick={() => isWindowSizeDropdownOpenAtom.set(false)} />
                <div className="absolute right-0 top-full mt-2 z-50 min-w-[240px] max-h-[400px] overflow-y-auto bg-white dark:bg-black rounded-xl shadow-2xl border border-[#E5E7EB] dark:border-[rgba(255,255,255,0.1)] overflow-hidden">
                  <div className="p-3 border-b border-[#E5E7EB] dark:border-[rgba(255,255,255,0.1)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-[#111827] dark:text-gray-300">Window Options</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        className="flex w-full justify-between items-center text-start bg-transparent text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
                        onClick={openInNewTab}
                      >
                        <span>Open in new tab</span>
                        <div className="i-ph:arrow-square-out h-5 w-4" />
                      </button>
                      <button
                        className="flex w-full justify-between items-center text-start bg-transparent text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
                        onClick={() => {
                          if (!activePreview?.baseUrl) {
                            return;
                          }
                          const match = activePreview.baseUrl.match(
                            /^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/,
                          );
                          if (!match) {
                            return;
                          }
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
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-bolt-elements-textTertiary">Show Device Frame</span>
                        <button
                          className={`w-10 h-5 rounded-full transition-colors duration-200 ${showDeviceFrame ? 'bg-[#6D28D9]' : 'bg-gray-300 dark:bg-gray-700'} relative`}
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
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-bolt-elements-textTertiary">Landscape Mode</span>
                        <button
                          className={`w-10 h-5 rounded-full transition-colors duration-200 ${isLandscape ? 'bg-[#6D28D9]' : 'bg-gray-300 dark:bg-gray-700'} relative`}
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
                      className="w-full px-4 py-3.5 text-left text-[#111827] dark:text-gray-300 text-sm whitespace-nowrap flex items-center gap-3 group hover:bg-[#F5EEFF] dark:hover:bg-gray-900 bg-white dark:bg-black"
                      onClick={() => {
                        selectedWindowSizeAtom.set(size);
                        isWindowSizeDropdownOpenAtom.set(false);
                        openInNewWindow(size);
                      }}
                    >
                      <div
                        className={`${size.icon} w-5 h-5 text-[#6B7280] dark:text-gray-400 group-hover:text-[#6D28D9] dark:group-hover:text-[#6D28D9] transition-colors duration-200`}
                      />
                      <div className="flex-grow flex flex-col">
                        <span className="font-medium group-hover:text-[#6D28D9] dark:group-hover:text-[#6D28D9] transition-colors duration-200">
                          {size.name}
                        </span>
                        <span className="text-xs text-[#6B7280] dark:text-gray-400 group-hover:text-[#6D28D9] dark:group-hover:text-[#6D28D9] transition-colors duration-200">
                          {isLandscape && (size.frameType === 'mobile' || size.frameType === 'tablet')
                            ? `${size.height} × ${size.width}`
                            : `${size.width} × ${size.height}`}
                          {size.hasFrame && showDeviceFrame ? ' (with frame)' : ''}
                        </span>
                      </div>
                      {selectedWindowSize.name === size.name && (
                        <div className="text-[#6D28D9] dark:text-[#6D28D9]">
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
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
});
