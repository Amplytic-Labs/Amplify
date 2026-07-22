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
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { MotionDropdown } from '~/components/ui/MotionDropdown';
import { DeployButton } from '~/components/deploy/DeployButton';
import { PreviewHeader } from '~/components/workbench/PreviewHeader';
import SvgGradientText from '~/components/ui/SVGgradient';
import { MobileWorkbenchTabBar } from '~/components/ui/MobileWorkbenchTabBar';
import { findRenderableFiles } from '~/lib/renderable/registry';
import { SidebarTrigger } from '~/components/ui/shadcn/sidebar';

const CodeIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="2.5"
    stroke="currentColor"
    className={className}
  >
    <polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const EyeIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="2.5"
    stroke="currentColor"
    className={className}
  >
    <path
      d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RenderIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="2.5"
    stroke="currentColor"
    className={className}
  >
    <polygon points="5 3 19 12 5 21 5 3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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
      { value: 'code', text: 'Code', icon: CodeIcon },
      { value: 'preview', text: 'Preview', icon: EyeIcon },
    ];

    if (hasRenderableFiles) {
      options.push({ value: 'render', text: 'Render', icon: RenderIcon });
    }

    return options;
  }, [hasRenderableFiles]);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  const isSmallViewport = useViewport(1024);

  return (
    <header
      className={classNames('flex items-center  justify-between h-[var(--header-height)] relative z-[10]', {
        'border-transparent': !chat.started,
        'border-amplify-elements-borderColor': chat.started,
      })}
    >
      {/* Mobile Layout */}
      <div className={classNames('lg:hidden flex items-center justify-between w-full')}>
        {showWorkbench ? (
          // Workbench open: Back | [Tab Bar] | Deploy
          <>
            <button
              onClick={() => workbenchStore.showWorkbench.set(false)}
              className="flex items-center gap-1 text-sm shrink-0 bg-transparent  text-amplify-elements-textPrimary hover:text-accent transition-colors"
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
                className="flex-1 truncate text-lg text-amplify-elements-textPrimary flex items-center"
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
        <div className="flex items-center gap-2 z-logo text-amplify-elements-textPrimary cursor-pointer">
          <div className="text-2xl font-semibold text-accent flex items-center">
            <SidebarTrigger />
            <div
              data-orientation="vertical"
              role="none"
              data-slot="separator"
              className="shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px mr-2 data-[orientation=vertical]:h-4"
            />
            {chat.started && Object.keys(files).length > 0 ? (
              <MotionDropdown
                align="center"
                trigger={
                  <div
                    className="flex-1 pr-4 truncate text-[16px] text-amplify-elements-textPrimary cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-center gap-1.5"
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
                className="flex-1 pr-4 top-5 truncate text-lg text-amplify-elements-textPrimary flex items-center justify-center"
                style={{ fontFamily: "'Almarai', sans-serif", fontWeight: 400 }}
              >
                <ClientOnly>{() => <ChatDescription />}</ClientOnly>
              </div>
            )}
            {/* Slider positioned fixed to align with workbench left edge (desktop only) */}
            {showWorkbench &&
              (workbenchLeftPosition !== null ? (
                <div className="fixed  hidden md:flex items-center " style={{ left: workbenchLeftPosition }}>
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />

                  {showWorkbench && selectedView === 'preview' && <PreviewHeader />}
                </div>
              ) : (
                <div className="hidden md:block">
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                </div>
              ))}
          </div>
        </div>

        {/* Preview toolbar — centered horizontally in the header */}

        {showWorkbench && <DeployButton />}
      </div>
    </header>
  );
}
