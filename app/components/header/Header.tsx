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

export function Header() {
  const chat = useStore(chatStore);
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const sidebarOpen = useStore(sidebarStore);

  const selectedView = useStore(workbenchStore.currentView);
  const fileHistory = useStore(workbenchStore.fileHistory);
  const workbenchLeftPosition = useStore(workbenchStore.workbenchLeftPosition);

  const sliderOptions = useMemo((): SliderOption<WorkbenchViewType>[] => {
    // Always show all tabs so users can navigate freely; content loads when available
    const options: SliderOption<WorkbenchViewType>[] = [
      { value: 'code', text: 'Code' },
      { value: 'preview', text: 'Preview' },
      { value: 'render', text: 'Render' },
    ];

    if (Object.keys(fileHistory).length > 1) {
      options.push({ value: 'diff', text: 'Diff' });
    }

    return options;
  }, [fileHistory]);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  const isSmallViewport = useViewport(1024);

  return (
    <header
      className={classNames('flex items-center px-4 justify-between h-[var(--header-height)] relative', {
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
          // Chat view: Logo + Title | Preview button
          <>
            <div className="flex items-center gap-2 min-w-0">
              <a href="/">
                <div className="w-[40px] inline-block hidden dark:hidden">
                  <SvgGradientText
                    viewBox="0 0 1080 1080"
                    className="w-[40px] "
                    colors={['#5227FF', '#FF9FFC', '#00f2fa']}
                  >
                    <path
                      d="M883.298 822H643.396V468.006L500.374 581.424L197 820.746V549.975L332.349 443.244H646.476L882.619 257L883.298 449.095L883.298 822Z"
                      fill="#09090B"
                    />
                  </SvgGradientText>
                </div>
                <div className="w-[40px] inline-block hidden dark:block">
                  <SvgGradientText
                    viewBox="0 0 1080 1080"
                    className="w-[40px] "
                    colors={['#5227FF', '#FF9FFC', '#00f2fa']}
                  >
                    <path
                      d="M883.298 822H643.396V468.006L500.374 581.424L197 820.746V549.975L332.349 443.244H646.476L882.619 257L883.298 449.095L883.298 822Z"
                      fill="#ffffff"
                    />
                  </SvgGradientText>
                </div>
              </a>
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
          {!showWorkbench && (
            <div
              className={classNames(
                'text-xl cursor-pointer hover:text-accent transition-colors',
                sidebarOpen ? 'i-ph:sidebar-simple-duotone text-accent' : 'i-ph:sidebar-simple-duotone',
              )}
              onClick={() => sidebarStore.set(!sidebarStore.get())}
            />
          )}
          <div className="text-2xl font-semibold text-accent flex items-center">
            <a href="/">
              <div className="w-[40px] inline-block hidden dark:hidden">
                <SvgGradientText
                  viewBox="0 0 1080 1080"
                  className="w-[40px] "
                  colors={['#5227FF', '#FF9FFC', '#00f2fa']}
                >
                  <path
                    d="M883.298 822H643.396V468.006L500.374 581.424L197 820.746V549.975L332.349 443.244H646.476L882.619 257L883.298 449.095L883.298 822Z"
                    fill="#09090B"
                  />
                </SvgGradientText>
              </div>
              <div className="w-[40px] inline-block hidden dark:block">
                <SvgGradientText
                  viewBox="0 0 1080 1080"
                  className="w-[40px] "
                  colors={['#5227FF', '#FF9FFC', '#00f2fa']}
                >
                  <path
                    d="M883.298 822H643.396V468.006L500.374 581.424L197 820.746V549.975L332.349 443.244H646.476L882.619 257L883.298 449.095L883.298 822Z"
                    fill="#ffffff"
                  />
                </SvgGradientText>
              </div>
            </a>
            {showWorkbench && (
              <>
                <div className="h-6 w-0.7 rounded-full bg-gray-300 dark:bg-gray-600 rotate-15 mx-3" />
                <UserDropdown />
                <div className="h-6 w-0.7 rounded-full bg-gray-300 dark:bg-gray-600 rotate-15 mx-3" />
                {chat.started ? (
                  <MotionDropdown
                    align="center"
                    trigger={
                      <div
                        className="flex-1 pr-4 truncate text-lg text-bolt-elements-textPrimary cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-center"
                        style={{ fontFamily: "'Almarai', sans-serif", fontWeight: 400 }}
                      >
                        <ClientOnly>{() => <ChatDescription />}</ClientOnly>
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
            {/* Slider positioned absolutely to align with workbench left edge (desktop only) */}
            {showWorkbench &&
              (workbenchLeftPosition !== null ? (
                <div className="absolute hidden md:block" style={{ left: workbenchLeftPosition }}>
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
