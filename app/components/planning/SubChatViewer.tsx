'use client';

import { memo, useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as RadixDialog from '@radix-ui/react-dialog';
import {
  X,
  XCircle,
  Coins,
  FileCode,
  MessageSquare,
  Bot,
  User,
} from 'lucide-react';
import { openDatabaseV3, getSubChat } from '~/lib/persistence/db-v3';
import type { SubChat } from '~/lib/planning/types';

// ─── Props ────────────────────────────────────────────────

interface SubChatViewerProps {
  subChatId: string;
  planId: string;
  open: boolean;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────

function formatTokenCount(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

function getMessageContent(message: { content: string | Array<{ type: string; text?: string }> }): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text!)
      .join('\n');
  }
  return '';
}

// ─── Loading Skeleton ─────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-4 bg-zinc-800 rounded w-48" />
        <div className="h-4 bg-zinc-800 rounded w-6" />
      </div>

      {/* Messages skeleton */}
      <div className="space-y-3 mt-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] space-y-2 ${i % 2 === 0 ? 'items-end' : 'items-start'}`}>
              <div className={`h-3 bg-zinc-800 rounded w-16 ${i % 2 === 0 ? 'ml-auto' : ''}`} />
              <div
                className={`h-12 bg-zinc-800 rounded-lg ${i % 2 === 0 ? 'w-64' : 'w-56'}`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer skeleton */}
      <div className="border-t border-zinc-700/50 pt-3 mt-4 flex gap-4">
        <div className="h-3 bg-zinc-800 rounded w-24" />
        <div className="h-3 bg-zinc-800 rounded w-32" />
      </div>
    </div>
  );
}

// ─── Sub-Chat Viewer ──────────────────────────────────────

export const SubChatViewer = memo(function SubChatViewer({
  subChatId,
  planId,
  open,
  onClose,
}: SubChatViewerProps) {
  const [subChat, setSubChat] = useState<SubChat | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadSubChat = useCallback(async () => {
    if (!subChatId) return;

    setLoading(true);
    setError(null);

    try {
      const db = await openDatabaseV3();

      if (!db) {
        setError('Unable to open database');
        setLoading(false);
        return;
      }

      const result = await getSubChat(db, subChatId);

      if (!result) {
        setError(`Sub-chat "${subChatId}" not found`);
      } else {
        setSubChat(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sub-chat');
    } finally {
      setLoading(false);
    }
  }, [subChatId]);

  // Load when opened
  useEffect(() => {
    if (open) {
      loadSubChat();
    } else {
      setSubChat(null);
      setError(null);
    }
  }, [open, loadSubChat]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (subChat && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [subChat]);

  return (
    <RadixDialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        </RadixDialog.Overlay>

        <RadixDialog.Content asChild>
          <motion.div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 rounded-lg shadow-xl border border-zinc-700/50 z-[9999] w-[560px] max-h-[80vh] flex flex-col focus:outline-none"
            initial={{ opacity: 0, scale: 0.96, y: '-40%' }}
            animate={{ opacity: 1, scale: 1, y: '-50%' }}
            exit={{ opacity: 0, scale: 0.96, y: '-40%' }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/50 flex-shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-zinc-400" />
                <RadixDialog.Title className="text-sm font-medium text-zinc-100">
                  Sub-Chat
                </RadixDialog.Title>
                {subChat && (
                  <span className="text-xs text-zinc-500">
                    Point #{subChat.pointIndex + 1}
                  </span>
                )}
              </div>
              <RadixDialog.Close asChild>
                <button className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </RadixDialog.Close>
            </div>

            {/* Body */}
            <AnimatePresence mode="wait">
              {loading && <LoadingSkeleton />}

              {error && !loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-6 text-center"
                >
                  <div className="flex items-center justify-center gap-2 text-red-400 text-sm">
                    <XCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                  <button
                    onClick={loadSubChat}
                    className="mt-3 text-xs text-zinc-400 hover:text-zinc-200 underline"
                  >
                    Retry
                  </button>
                </motion.div>
              )}

              {subChat && !loading && !error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col flex-1 min-h-0"
                >
                  {/* Messages */}
                  <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto px-4 py-3 space-y-3 max-h-96"
                  >
                    {subChat.messages.map((message, index) => {
                      const isUser = message.role === 'user';
                      const content = getMessageContent(message);

                      if (!content) return null;

                      return (
                        <motion.div
                          key={message.id ?? index}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.02 }}
                          className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                        >
                          {/* Avatar */}
                          <div
                            className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                              isUser
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-purple-500/20 text-purple-400'
                            }`}
                          >
                            {isUser ? (
                              <User className="w-3 h-3" />
                            ) : (
                              <Bot className="w-3 h-3" />
                            )}
                          </div>

                          {/* Bubble */}
                          <div
                            className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                              isUser
                                ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20'
                                : 'bg-zinc-800 text-zinc-300 border border-zinc-700/50'
                            }`}
                          >
                            <div className="whitespace-pre-wrap break-words">{content}</div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* Footer: Token usage + artifacts */}
                  <div className="px-4 py-3 border-t border-zinc-700/50 bg-zinc-900/80 flex-shrink-0 space-y-2">
                    {/* Token usage */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-zinc-500" />
                        <span className="text-xs text-zinc-500">
                          {formatTokenCount(subChat.tokenUsage.totalTokens)} tokens
                        </span>
                      </div>
                      <span className="text-zinc-700">|</span>
                      <span className="text-xs text-zinc-500">
                        {subChat.messages.length} messages
                      </span>
                    </div>

                    {/* Modified files */}
                    {subChat.artifacts.length > 0 && (
                      <div className="flex items-start gap-1.5 flex-wrap">
                        <FileCode className="w-3 h-3 text-zinc-500 mt-0.5" />
                        <span className="text-xs text-zinc-500 mr-1">Modified files:</span>
                        {subChat.artifacts.map((artifact) => (
                          <span
                            key={artifact}
                            className="inline-block text-[11px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/50"
                          >
                            {artifact}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
});
