import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { LLMManager } from '~/lib/modules/llm/manager';
import { stripIndents } from '~/utils/stripIndent';
import type { ProviderInfo } from '~/types/model';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';

export async function action(args: ActionFunctionArgs) {
  return chatTitleAction(args);
}

const logger = createScopedLogger('api.chat-title');

/**
 * Generates a short, human-readable title (4-8 words) for a chat
 * conversation based on the first user message and (optionally) the
 * first assistant reply.
 *
 * This is called client-side after the first assistant response in a
 * new chat, so the chat shows up in the sidebar with a meaningful name
 * instead of being invisible (untitled chats were previously filtered
 * out of the Recent Chats list entirely).
 *
 * Returns: { title: string } as JSON.
 */
async function chatTitleAction({ context, request }: ActionFunctionArgs) {
  const { message, model, provider } = await request.json<{
    message: string;
    model: string;
    provider: ProviderInfo;
  }>();

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  try {
    const llmManager = LLMManager.getInstance();
    const providerName = provider?.name || 'Z.ai';
    const modelName = model || 'glm-4.7-flash';

    const providerInstance = llmManager.getProvider(providerName);

    if (!providerInstance) {
      throw new Error(`Provider ${providerName} not found`);
    }

    const modelInstance = providerInstance.getModelInstance({
      model: modelName,
      serverEnv: context.cloudflare?.env as any,
      apiKeys,
      providerSettings,
    });

    const result = await generateText({
      model: modelInstance,
      system: stripIndents`
        You generate a concise title (4 to 8 words, no quotes, no punctuation at the end)
        for a chat conversation based on the user's first message.

        Rules:
        - 4 to 8 words maximum
        - No quotes, no trailing period
        - Title case (capitalize major words)
        - Capture the core intent/action
        - If the message is a greeting ("hi", "hello"), return "New Conversation"
        - If the message is unclear, return "Quick Chat"

        Respond with ONLY the title text. No explanations, no markdown.
      `,
      prompt: message.slice(0, 500),
      maxTokens: 30,
      temperature: 0.3,
    });

    let title = result.text.trim();

    // Strip any quotes the model may have added
    title = title.replace(/^["'`]|["'`]$/g, '').trim();

    // Enforce a max length safety net
    if (title.length > 80) {
      title = title.slice(0, 77) + '…';
    }

    // If the model returned empty or refused, fall back
    if (!title || title.toLowerCase().includes('i cannot') || title.toLowerCase().includes('i can\'t')) {
      const fallback = message.slice(0, 60).trim();
      title = fallback || 'New Conversation';
    }

    return new Response(JSON.stringify({ title }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    logger.error('Failed to generate chat title:', error);

    // Fall back to a truncated version of the message so the chat still
    // gets a title and shows up in the sidebar.
    const fallback = message.slice(0, 60).trim() || 'New Conversation';

    return new Response(JSON.stringify({ title: fallback, fallback: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
