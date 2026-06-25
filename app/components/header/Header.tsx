import { useMemo } from 'react';
import useViewport from '~/lib/hooks';
import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { Slider, type SliderOption } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { sidebarStore } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtonsContent } from './HeaderActionButtons.client';
import { UserDropdown } from './UserDropdown.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { MotionDropdown } from '~/components/ui/MotionDropdown';
import { DeployButton } from '~/components/deploy/DeployButton';
import { PreviewHeader } from '~/components/workbench/PreviewHeader';
import SvgGradientText from '~/components/ui/SVGgradient';
import { MobileWorkbenchTabBar } from '~/components/ui/MobileWorkbenchTabBar';
import { findRenderableFiles } from '~/lib/renderable/registry';
import { SidebarTrigger } from '~/components/ui/shadcn/sidebar';

export function Header() {
  const chat = useStore(chatStore);
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const sidebarOpen = useStore(sidebarStore);

  const selectedView = useStore(workbenchStore.currentView);
  const fileHistory = useStore(workbenchStore.fileHistory);
  const workbenchLeftPosition = useStore(workbenchStore.workbenchLeftPosition);
  const files = useStore(workbenchStore.files);

  // Only show Render tab when at least one renderable file exists
  const hasRenderableFiles = useMemo(() => findRenderableFiles(files).length > 0, [files]);

  const sliderOptions = useMemo((): SliderOption<WorkbenchViewType>[] => {
    const options: SliderOption<WorkbenchViewType>[] = [
      { value: 'code', text: 'Code' },
      { value: 'preview', text: 'Preview' },
    ];

    if (hasRenderableFiles) {
      options.push({ value: 'render', text: 'Render' });
    }

    if (Object.keys(fileHistory).length > 1) {
      options.push({ value: 'diff', text: 'Diff' });
    }

    return options;
  }, [fileHistory, hasRenderableFiles]);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  const isSmallViewport = useViewport(1024);

  return (
    <header
      className={classNames('flex items-center  justify-between h-[var(--header-height)] relative z-[10]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      {/* Mobile Layout */}
      <div className={classNames('lg:hidden flex items-center justify-between w-full')}>
        {showWorkbench ? (
          // Workbench open: Back | [Tab Bar] | Deploy
          <>
            <button
              onClick={() => workbenchStore.showWorkbench.set(false)}
              className="flex items-center gap-1 text-sm shrink-0 bg-bolt-elements-background-depth-1  text-bolt-elements-textPrimary hover:text-accent transition-colors"
            >
              <div className="i-ph:caret-left text-lg" />
              <span className=" xs:inline">Back</span>
            </button>

            {/* Centering wrapper — lets the pill bar stay compact (content width) and be centred */}
            <div className="flex-1 flex justify-center  min-w-0 m">
              <MobileWorkbenchTabBar selected={selectedView} onSelect={setSelectedView} />
            </div>

            <DeployButton />
          </>
        ) : (
          // Chat view: SidebarTrigger + Logo + Title | Preview button
          <>
            <div className="flex items-center gap-2 min-w-0">
              <SidebarTrigger />

              <div
                className="flex-1 truncate text-lg text-bolt-elements-textPrimary flex items-center"
                style={{ fontFamily: "'Almarai', sans-serif", fontWeight: 400 }}
              >
                <ClientOnly>{() => <ChatDescription />}</ClientOnly>
              </div>
            </div>
            {chat.started && (
              <button
                onClick={() => workbenchStore.showWorkbench.set(true)}
                className="ml-2 shrink-0 px-3 py-1.5 text-sm bg-accent-500 text-white rounded-md hover:bg-accent-600 transition-colors"
              >
                Preview
              </button>
            )}
          </>
        )}
      </div>

      {/* Desktop Layout */}
      <div className={classNames('hidden lg:flex items-center justify-between w-full')}>
        <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
          <div className="text-2xl font-semibold text-accent flex items-center">
            <SidebarTrigger />
            {showWorkbench && (
              <>
                
                <div
                  data-orientation="vertical"
                  role="none"
                  data-slot="separator"
                  className="shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px mr-2 data-[orientation=vertical]:h-4"
                />
                {chat.started ? (
                  <MotionDropdown
                    align="center"
                    trigger={
                      <div
                        className="flex-1 pr-4 truncate text-[16px] text-bolt-elements-textPrimary cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-center gap-1.5"
                        style={{ fontFamily: "'Geist', sans-serif", fontWeight: 400 }}
                      >
                        <ClientOnly>{() => <ChatDescription />}</ClientOnly>
                        <div className="i-ph:caret-down-bold text-[16px] opacity-100 relative top-0.7" />
                      </div>
                    }
                  >
                    <HeaderActionButtonsContent />
                  </MotionDropdown>
                ) : (
                  <div
                    className="flex-1 pr-4 top-5 truncate text-lg text-bolt-elements-textPrimary flex items-center justify-center"
                    style={{ fontFamily: "'Almarai', sans-serif", fontWeight: 400 }}
                  >
                    <ClientOnly>{() => <ChatDescription />}</ClientOnly>
                  </div>
                )}
              </>
            )}
            {/* Slider positioned fixed to align with workbench left edge (desktop only) */}
            {showWorkbench &&
              (workbenchLeftPosition !== null ? (
                <div className="fixed top-4 hidden md:block" style={{ left: workbenchLeftPosition }}>
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                </div>
              ) : (
                <div className="hidden md:block">
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                </div>
              ))}
          </div>
        </div>

        {/* Preview toolbar — centered horizontally in the header */}
        {showWorkbench && selectedView === 'preview' && (
          <div className="absolute left-1/2 -translate-x-1/2 flex justify-center">
            <PreviewHeader />
          </div>
        )}

        {showWorkbench && <DeployButton />}
      </div>
    </header>
  );
}
