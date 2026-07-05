/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import type { JSONValue, Message } from 'ai';
import React, { type RefCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';
import { Messages } from './Messages.client';
import { getApiKeysFromCookies } from './APIKeyManager';
import Cookies from 'js-cookie';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import useViewport from '~/lib/hooks';
import { workbenchStore } from '~/lib/stores/workbench';
import styles from './BaseChat.module.scss';
import { ImportButtons } from '~/components/chat/chatExportAndImport/ImportButtons';
import { ExamplePrompts } from '~/components/chat/ExamplePrompts';
import GitCloneButton from './GitCloneButton';
import type { ProviderInfo } from '~/types/model';
import StarterTemplates from './StarterTemplates';
import type { ActionAlert, SupabaseAlert, DeployAlert, LlmErrorAlertType } from '~/types/actions';
import DeployChatAlert from '~/components/deploy/DeployAlert';
import ChatAlert from './ChatAlert';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { SupabaseChatAlert } from '~/components/chat/SupabaseAlert';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';
import { useStore } from '@nanostores/react';
import { StickToBottom, useStickToBottomContext } from '~/lib/hooks';
import { ChatBox } from './ChatBox';
import { PlanView } from './PlanView';
import type { DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import LlmErrorAlert from './LLMApiAlert';
import { OpenWorkspaceButton } from './OpenWorkspaceButton';
// OpenWorkspaceButton is intentionally NOT rendered in the chat UI.
// The workspace only opens when the AI injects a template, the user clones
// a GitHub repo, or the user picks a template — never via a manual button.
void OpenWorkspaceButton;

const TEXTAREA_MIN_HEIGHT = 32;

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  onStreamingChange?: (streaming: boolean) => void;
  messages?: Message[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList?: ProviderInfo[];
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  importChat?: (description: string, messages: Message[]) => Promise<void>;
  exportChat?: () => void;
  uploadedFiles?: File[];
  setUploadedFiles?: (files: File[]) => void;
  imageDataList?: string[];
  setImageDataList?: (dataList: string[]) => void;
  actionAlert?: ActionAlert;
  clearAlert?: () => void;
  supabaseAlert?: SupabaseAlert;
  clearSupabaseAlert?: () => void;
  deployAlert?: DeployAlert;
  clearDeployAlert?: () => void;
  llmErrorAlert?: LlmErrorAlertType;
  clearLlmErrorAlert?: () => void;
  data?: JSONValue[] | undefined;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  append?: (message: Message) => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: (element: ElementInfo | null) => void;
  addToolResult?: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  onWebSearchResult?: (result: string) => void;
  apiKeys?: Record<string, string>;
  onApiKeysChange?: (providerName: string, apiKey: string) => Promise<void>;
  planExecuting?: boolean;
  planProgress?: any;
  onCancelPlan?: () => void;
  onResumePlan?: () => void;
  planId?: string;
}

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      onStreamingChange,
      model,
      setModel,
      provider,
      setProvider,
      providerList,
      input = '',
      enhancingPrompt,
      handleInputChange,

      // promptEnhanced,
      enhancePrompt,
      sendMessage,
      handleStop,
      importChat,
      exportChat,
      uploadedFiles = [],
      setUploadedFiles,
      imageDataList = [],
      setImageDataList,
      messages,
      actionAlert,
      clearAlert,
      deployAlert,
      clearDeployAlert,
      supabaseAlert,
      clearSupabaseAlert,
      llmErrorAlert,
      clearLlmErrorAlert,
      data,
      chatMode,
      setChatMode,
      append,
      designScheme,
      setDesignScheme,
      selectedElement,
      setSelectedElement,
      addToolResult = () => {
        throw new Error('addToolResult not implemented');
      },
      onWebSearchResult,
      apiKeys,
      onApiKeysChange,
      planExecuting = false,
      onCancelPlan,
      onResumePlan,
      planProgress,
      planId,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [isListening, setIsListening] = useState(false);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [transcript, setTranscript] = useState('');
    const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');
    const expoUrl = useStore(expoUrlAtom);
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const isSmallViewport = useViewport(1024);

    useEffect(() => {
      if (expoUrl) {
        setQrModalOpen(true);
      }
    }, [expoUrl]);

    // SpeechRecognition transcript is used via the `transcript` state variable
    // No debug logging needed in production

    useEffect(() => {
      onStreamingChange?.(isStreaming);
    }, [isStreaming, onStreamingChange]);

    useEffect(() => {
      if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0])
            .map((result) => result.transcript)
            .join('');

          setTranscript(transcript);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: transcript },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        };

        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };

        setRecognition(recognition);

        // Cleanup: abort speech recognition on unmount to prevent memory leaks
        return () => {
          try {
            recognition.abort();
          } catch {
            // Ignore errors during cleanup
          }
        };
      }
    }, []);

    useEffect(() => {
      if (typeof window !== 'undefined') {
        setIsModelLoading('all');
        fetch('/api/models')
          .then((response) => response.json())
          .then((data) => {
            const typedData = data as { modelList: ModelInfo[] };
            setModelList(typedData.modelList);
          })
          .catch((error) => {
            console.error('Error fetching model list:', error);
          })
          .finally(() => {
            setIsModelLoading(undefined);
          });
      }
    }, [providerList, provider]);

    const handleApiKeysChange = async (providerName: string, apiKey: string) => {
      await onApiKeysChange?.(providerName, apiKey);

      setIsModelLoading(providerName);

      let providerModels: ModelInfo[] = [];

      try {
        const response = await fetch(`/api/models/${encodeURIComponent(providerName)}`);
        const data = await response.json();
        providerModels = (data as { modelList: ModelInfo[] }).modelList;
      } catch (error) {
        console.error('Error loading dynamic models for:', providerName, error);
      }

      // Only update models for the specific provider
      setModelList((prevModels) => {
        const otherModels = prevModels.filter((model) => model.provider !== providerName);
        return [...otherModels, ...providerModels];
      });
      setIsModelLoading(undefined);
    };

    const startListening = () => {
      if (recognition) {
        recognition.start();
        setIsListening(true);
      }
    };

    const stopListening = () => {
      if (recognition) {
        recognition.stop();
        setIsListening(false);
      }
    };

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      if (sendMessage) {
        sendMessage(event, messageInput);
        setSelectedElement?.(null);

        if (recognition) {
          recognition.abort(); // Stop current recognition
          setTranscript(''); // Clear transcript
          setIsListening(false);

          // Clear the input by triggering handleInputChange with empty value
          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: '' },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        }
      }
    };

    const handleFileUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (file) {
          const reader = new FileReader();

          reader.onload = (e) => {
            const base64Image = e.target?.result as string;
            setUploadedFiles?.([...uploadedFiles, file]);
            setImageDataList?.([...imageDataList, base64Image]);
          };
          reader.readAsDataURL(file);
        }
      };

      input.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            const reader = new FileReader();

            reader.onload = (e) => {
              const base64Image = e.target?.result as string;
              setUploadedFiles?.([...uploadedFiles, file]);
              setImageDataList?.([...imageDataList, base64Image]);
            };
            reader.readAsDataURL(file);
          }

          break;
        }
      }
    };

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden')}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>

        {isSmallViewport ? (
          <div className="flex flex-col lg:flex-row overflow-hidden w-full h-full">
            <div className={classNames(styles.Chat, 'flex flex-col flex-grow h-full')}>
              {!chatStarted && (
                <div id="intro" className="mt-[16vh] max-w-2xl mx-auto text-center px-4 lg:px-0">
                  <div className="relative mb-4 animate-fade-in">
                    <div className="absolute inset-0 -z-10 flex items-center justify-center pointer-events-none">
                      <div className="w-[280px] h-[80px] bg-gradient-to-r from-purple-500/20 via-fuchsia-500/20 to-pink-500/20 blur-3xl rounded-full" />
                    </div>
                    <h1 className="text-3xl lg:text-6xl font-bold text-amplify-elements-textPrimary bg-gradient-to-r from-purple-600 via-fuchsia-600 to-purple-600 dark:from-purple-400 dark:via-fuchsia-400 dark:to-purple-400 bg-clip-text text-transparent">
                      Where ideas begin
                    </h1>
                  </div>
                  <p className="text-md lg:text-xl mb-6 text-amplify-elements-textSecondary animate-fade-in animation-delay-200">
                    Bring ideas to life in seconds or get help on existing projects.
                  </p>
                  <ExamplePrompts sendMessage={sendMessage} />
                </div>
              )}
              <StickToBottom
                className={classNames('pt-2 px-2 sm:px-0 relative', {
                  'h-full flex flex-col chat-scrollbar-hide': chatStarted,
                })}
                resize="smooth"
                initial="smooth"
              >
                <StickToBottom.Content className="flex flex-col gap-4 relative ">
                  <ClientOnly>
                    {() => {
                      return chatStarted ? (
                        <Messages
                          className="flex flex-col w-full flex-1 max-w-chat pb-4 mx-auto z-1"
                          messages={messages}
                          isStreaming={isStreaming}
                          append={append}
                          chatMode={chatMode}
                          setChatMode={setChatMode}
                          provider={provider}
                          model={model}
                          addToolResult={addToolResult}
                        />
                      ) : null;
                    }}
                  </ClientOnly>
                  <ScrollToBottom />
                </StickToBottom.Content>
                <div
                  className={classNames('my-auto flex flex-col gap-2 w-full max-w-chat mx-auto z-prompt mb-6', {
                    'sticky bottom-2': chatStarted,
                  })}
                >
                  <div className="flex flex-col gap-2">
                    {deployAlert && (
                      <DeployChatAlert
                        alert={deployAlert}
                        clearAlert={() => clearDeployAlert?.()}
                        postMessage={(message: string | undefined) => {
                          sendMessage?.({} as any, message);
                          clearSupabaseAlert?.();
                        }}
                      />
                    )}
                    {supabaseAlert && (
                      <SupabaseChatAlert
                        alert={supabaseAlert}
                        clearAlert={() => clearSupabaseAlert?.()}
                        postMessage={(message) => {
                          sendMessage?.({} as any, message);
                          clearSupabaseAlert?.();
                        }}
                      />
                    )}
                    {actionAlert && (
                      <ChatAlert
                        alert={actionAlert}
                        clearAlert={() => clearAlert?.()}
                        postMessage={(message) => {
                          sendMessage?.({} as any, message);
                          clearAlert?.();
                        }}
                      />
                    )}
                    {llmErrorAlert && <LlmErrorAlert alert={llmErrorAlert} clearAlert={() => clearLlmErrorAlert?.()} />}
                    {planExecuting && planId && (
                      <PlanView planId={planId} progress={planProgress} onCancel={onCancelPlan!} onResume={onResumePlan} />
                    )}
                  </div>
                  <ChatBox
                    provider={provider}
                    setProvider={setProvider}
                    providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
                    model={model}
                    setModel={setModel}
                    modelList={modelList}
                    apiKeys={apiKeys || {}}
                    isModelLoading={isModelLoading}
                    onApiKeysChange={handleApiKeysChange}
                    uploadedFiles={uploadedFiles}
                    setUploadedFiles={setUploadedFiles}
                    imageDataList={imageDataList}
                    setImageDataList={setImageDataList}
                    textareaRef={textareaRef}
                    input={input}
                    handleInputChange={handleInputChange}
                    handlePaste={handlePaste}
                    TEXTAREA_MIN_HEIGHT={TEXTAREA_MIN_HEIGHT}
                    TEXTAREA_MAX_HEIGHT={TEXTAREA_MAX_HEIGHT}
                    isStreaming={isStreaming}
                    handleStop={handleStop}
                    handleSendMessage={handleSendMessage}
                    enhancingPrompt={enhancingPrompt}
                    enhancePrompt={enhancePrompt}
                    isListening={isListening}
                    startListening={startListening}
                    stopListening={stopListening}
                    chatStarted={chatStarted}
                    exportChat={exportChat}
                    qrModalOpen={qrModalOpen}
                    setQrModalOpen={setQrModalOpen}
                    handleFileUpload={handleFileUpload}
                    chatMode={chatMode}
                    setChatMode={setChatMode}
                    designScheme={designScheme}
                    setDesignScheme={setDesignScheme}
                    selectedElement={selectedElement}
                    setSelectedElement={setSelectedElement}
                    onWebSearchResult={onWebSearchResult}
                  />
                </div>
              </StickToBottom>
            </div>
            <ClientOnly>
              {() => (
                <Workbench
                  chatStarted={chatStarted}
                  isStreaming={isStreaming}
                  setSelectedElement={setSelectedElement}
                />
              )}
            </ClientOnly>
          </div>
        ) : (
          <div className="w-full h-full">
            {/*
              Panel order is intentionally: Workbench (first/left in DOM) → Handle → Chat (second/right in DOM).
              We then reverse the visual order with flex-row-reverse so Chat appears LEFT and Workbench appears RIGHT.
              This makes drag-right = grow workbench (intuitive), drag-left = shrink workbench.
            */}
            <PanelGroup direction="horizontal" style={{ flexDirection: 'row-reverse', overflow: 'visible' }}>
              {showWorkbench && (
                <Panel defaultSize={70} minSize={30} style={{ overflow: 'visible' }}>
                  <div className="relative h-full w-full">
                    <ClientOnly>
                      {() => (
                        <Workbench
                          chatStarted={chatStarted}
                          isStreaming={isStreaming}
                          setSelectedElement={setSelectedElement}
                        />
                      )}
                    </ClientOnly>
                  </div>
                </Panel>
              )}
              {showChat && showWorkbench && (
                <PanelResizeHandle className="relative flex items-center justify-center w-[0px] cursor-col-resize group z-10">
                  {/* visible line border between chat and workbench */}

                  {/* Invisible hit area for easier dragging without adding layout gap */}
                </PanelResizeHandle>
              )}
              {showChat && (
                <Panel
                  defaultSize={showWorkbench ? 20 : 100}
                  minSize={showWorkbench ? 15 : 100}
                  collapsible={showWorkbench}
                >
                  <div className={classNames(styles.Chat, 'flex flex-col h-full w-full relative')}>
                    {!chatStarted && (
                      <div id="intro" className="mt-[16vh] max-w-2xl mx-auto text-center px-4 lg:px-0">
                        <div className="relative mb-4 animate-fade-in">
                          <div className="absolute inset-0 -z-10 flex items-center justify-center pointer-events-none">
                            <div className="w-[340px] h-[100px] bg-gradient-to-r from-purple-500/20 via-fuchsia-500/20 to-pink-500/20 blur-3xl rounded-full" />
                          </div>
                          <h1 className="text-3xl lg:text-6xl font-bold text-amplify-elements-textPrimary bg-gradient-to-r from-purple-600 via-fuchsia-600 to-purple-600 dark:from-purple-400 dark:via-fuchsia-400 dark:to-purple-400 bg-clip-text text-transparent">
                            Where ideas begin
                          </h1>
                        </div>
                        <p className="text-md lg:text-xl mb-6 text-amplify-elements-textSecondary animate-fade-in animation-delay-200">
                          Bring ideas to life in seconds or get help on existing projects.
                        </p>
                        <ExamplePrompts sendMessage={sendMessage} />
                      </div>
                    )}
                    <StickToBottom
                      className={classNames('pt-6 px-2 sm:px-6 relative', {
                        'h-full flex flex-col chat-scrollbar-hide': chatStarted,
                      })}
                      resize="smooth"
                      initial="smooth"
                    >
                      <StickToBottom.Content className="flex flex-col gap-4 relative ">
                        <ClientOnly>
                          {() => {
                            return chatStarted ? (
                              <Messages
                                className="flex flex-col w-full flex-1 max-w-chat pb-4 mx-auto z-1"
                                messages={messages}
                                isStreaming={isStreaming}
                                append={append}
                                chatMode={chatMode}
                                setChatMode={setChatMode}
                                provider={provider}
                                model={model}
                                addToolResult={addToolResult}
                              />
                            ) : null;
                          }}
                        </ClientOnly>
                        <ScrollToBottom />
                      </StickToBottom.Content>
                      <div
                        className={classNames('my-auto flex flex-col gap-2 w-full max-w-chat mx-auto z-prompt mb-6', {
                          'sticky bottom-2': chatStarted,
                        })}
                      >
                        <div className="flex flex-col gap-2">
                          {deployAlert && (
                            <DeployChatAlert
                              alert={deployAlert}
                              clearAlert={() => clearDeployAlert?.()}
                              postMessage={(message: string | undefined) => {
                                sendMessage?.({} as any, message);
                                clearSupabaseAlert?.();
                              }}
                            />
                          )}
                          {supabaseAlert && (
                            <SupabaseChatAlert
                              alert={supabaseAlert}
                              clearAlert={() => clearSupabaseAlert?.()}
                              postMessage={(message) => {
                                sendMessage?.({} as any, message);
                                clearSupabaseAlert?.();
                              }}
                            />
                          )}
                          {actionAlert && (
                            <ChatAlert
                              alert={actionAlert}
                              clearAlert={() => clearAlert?.()}
                              postMessage={(message) => {
                                sendMessage?.({} as any, message);
                                clearAlert?.();
                              }}
                            />
                          )}
                          {llmErrorAlert && (
                            <LlmErrorAlert alert={llmErrorAlert} clearAlert={() => clearLlmErrorAlert?.()} />
                          )}
                          {planExecuting && planId && (
                            <PlanView planId={planId} progress={planProgress} onCancel={onCancelPlan!} onResume={onResumePlan} />
                          )}
                        </div>
                        <ChatBox
                          provider={provider}
                          setProvider={setProvider}
                          providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
                          model={model}
                          setModel={setModel}
                          modelList={modelList}
                          apiKeys={apiKeys || {}}
                          isModelLoading={isModelLoading}
                          onApiKeysChange={handleApiKeysChange}
                          uploadedFiles={uploadedFiles}
                          setUploadedFiles={setUploadedFiles}
                          imageDataList={imageDataList}
                          setImageDataList={setImageDataList}
                          textareaRef={textareaRef}
                          input={input}
                          handleInputChange={handleInputChange}
                          handlePaste={handlePaste}
                          TEXTAREA_MIN_HEIGHT={TEXTAREA_MIN_HEIGHT}
                          TEXTAREA_MAX_HEIGHT={TEXTAREA_MAX_HEIGHT}
                          isStreaming={isStreaming}
                          handleStop={handleStop}
                          handleSendMessage={handleSendMessage}
                          enhancingPrompt={enhancingPrompt}
                          enhancePrompt={enhancePrompt}
                          isListening={isListening}
                          startListening={startListening}
                          stopListening={stopListening}
                          chatStarted={chatStarted}
                          exportChat={exportChat}
                          qrModalOpen={qrModalOpen}
                          setQrModalOpen={setQrModalOpen}
                          handleFileUpload={handleFileUpload}
                          chatMode={chatMode}
                          setChatMode={setChatMode}
                          designScheme={designScheme}
                          setDesignScheme={setDesignScheme}
                          selectedElement={selectedElement}
                          setSelectedElement={setSelectedElement}
                          onWebSearchResult={onWebSearchResult}
                        />
                      </div>
                    </StickToBottom>
                  </div>
                </Panel>
              )}
            </PanelGroup>
          </div>
        )}
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  },
);

function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const showWorkbench = useStore(workbenchStore.showWorkbench);

  // On mobile (< 1024px), hide the gradient and scroll-to-bottom when the workspace is open
  if (typeof window !== 'undefined' && window.innerWidth < 1024 && showWorkbench) {
    return null;
  }

  return (
    !isAtBottom && (
      <>
        <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-card to-transparent h-20 z-10" />
        <button
          className="sticky z-50 bottom-0 left-0 right-0 text-4xl rounded-lg px-1.5 py-0.5 flex items-center justify-center mx-auto gap-2 bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor text-amplify-elements-textPrimary text-sm"
          onClick={() => scrollToBottom()}
        >
          Go to last message
          <span className="i-ph:arrow-down animate-bounce" />
        </button>
      </>
    )
  );
}
