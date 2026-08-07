import { DEFAULT_MODEL, MODEL_REGEX, PROVIDER_REGEX } from '~/utils/constants';
import { IGNORE_PATTERNS, type FileMap } from './constants';
import ignore from 'ignore';
import type { ContextAnnotation } from '~/types/context';

/**
 * Default provider name used as a synchronous fallback.
 * DEFAULT_PROVIDER is a Promise (lazy-loaded), so we can't access .name
 * synchronously in non-async functions. This constant provides the fallback.
 */
const DEFAULT_PROVIDER_NAME = 'Anthropic';

export function extractPropertiesFromMessage(message: any): {
  model: string;
  provider: string;
  content: string;
} {
  // UIMessage uses parts array; fall back to content for legacy messages
  const textContent = Array.isArray(message.parts)
    ? message.parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('')
    : Array.isArray(message.content)
      ? message.content.find((item: any) => item.type === 'text')?.text || ''
      : message.content || '';

  const modelMatch = textContent.match(MODEL_REGEX);
  const providerMatch = textContent.match(PROVIDER_REGEX);

  /*
   * Extract model
   * const modelMatch = message.content.match(MODEL_REGEX);
   */
  const model = modelMatch ? modelMatch[1] : DEFAULT_MODEL;

  /*
   * Extract provider
   * const providerMatch = message.content.match(PROVIDER_REGEX);
   */
  const provider = providerMatch ? providerMatch[1] : DEFAULT_PROVIDER_NAME;

  const cleanedContent = Array.isArray(message.parts)
    ? message.parts.map((part: any) => {
        if (part.type === 'text') {
          return {
            ...part,
            text: part.text?.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, ''),
          };
        }

        return part;
      })
    : Array.isArray(message.content)
      ? message.content.map((item: any) => {
          if (item.type === 'text') {
            return {
              type: 'text',
              text: item.text?.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, ''),
            };
          }

          return item;
        })
      : textContent.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '');

  return { model, provider, content: cleanedContent };
}

export function simplifyBoltActions(input: string): string {
  const actionRegex = /(<(?:bolt|amplify)Action[^>]*filePath=[^>]*>)([\s\S]*?)(<\/(?:bolt|amplify)Action>)/g;
  let out = input.replace(actionRegex, (_, openingTag, _content, closingTag) => {
    return `${openingTag}\n          ...\n        ${closingTag}`;
  });

  out = out.replace(/(<boltArtifact[^>]*>)([\s\S]*?)(<\/boltArtifact>)/g, (_0, openingTag, _content, closingTag) => {
    if (_content.includes('boltAction') || _content.includes('amplifyAction')) {
      return `${openingTag}\n  [Workspace files listed in artifact collapsed]\n${closingTag}`;
    }

    return _0;
  });

  return out;
}

export function createFilesContext(files: FileMap, useRelativePath?: boolean) {
  const ig = ignore().add(IGNORE_PATTERNS);
  let filePaths = Object.keys(files);
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  const fileContexts = filePaths
    .filter((x) => files[x] && files[x].type == 'file')
    .map((path) => {
      const dirent = files[path];

      if (!dirent || dirent.type == 'folder') {
        return '';
      }

      const codeWithLinesNumbers = dirent.content
        .split('\n')
        // .map((v, i) => `${i + 1}|${v}`)
        .join('\n');

      let filePath = path;

      if (useRelativePath) {
        filePath = path.replace('/home/project/', '');
      }

      return `<boltAction type="file" filePath="${filePath}">${codeWithLinesNumbers}</boltAction>`;
    });

  return `<boltArtifact id="code-content" title="Code Content" >\n${fileContexts.join('\n')}\n</boltArtifact>`;
}

export function extractCurrentContext(messages: any[]) {
  const lastAssistantMessage = messages.filter((x) => x.role == 'assistant').slice(-1)[0];

  if (!lastAssistantMessage) {
    return { summary: undefined, codeContext: undefined };
  }

  let summary: ContextAnnotation | undefined;
  let codeContext: ContextAnnotation | undefined;

  if (!lastAssistantMessage.annotations?.length) {
    return { summary: undefined, codeContext: undefined };
  }

  for (let i = 0; i < lastAssistantMessage.annotations.length; i++) {
    const annotation = lastAssistantMessage.annotations[i];

    if (!annotation || typeof annotation !== 'object') {
      continue;
    }

    if (!(annotation as any).type) {
      continue;
    }

    const annotationObject = annotation as any;

    if (annotationObject.type === 'codeContext') {
      codeContext = annotationObject;
      break;
    } else if (annotationObject.type === 'chatSummary') {
      summary = annotationObject;
      break;
    }
  }

  return { summary, codeContext };
}
