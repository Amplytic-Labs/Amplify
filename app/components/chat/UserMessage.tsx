/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { MODEL_REGEX, PROVIDER_REGEX } from '~/utils/constants';
import { Markdown } from './Markdown';
import { useStore } from '@nanostores/react';
import { profileStore } from '~/lib/stores/profile';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';

interface UserMessageProps {
  content: string | Array<{ type: string; text?: string; image?: string }>;
  parts:
    | (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[]
    | undefined;
}

export function UserMessage({ content, parts }: UserMessageProps) {
  const profile = useStore(profileStore);

  // Extract images from parts - look for file parts with image mime types
  const images =
    parts?.filter(
      (part): part is FileUIPart => part.type === 'file' && 'mimeType' in part && part.mimeType.startsWith('image/'),
    ) || [];

  const textContent = Array.isArray(content)
    ? stripMetadata(content.find((item) => item.type === 'text')?.text || '')
    : stripMetadata(content);

  return (
    <div className="flex flex-col items-end gap-1 w-full pt-2 pb-1">
      <div className="flex items-center gap-1.5 mb-0.5 justify-end">
        {profile?.avatar || profile?.username ? (
          <>
            <span className="text-amplify-elements-textSecondary text-[11px] font-medium">
              {profile?.username || 'You'}
            </span>
            {profile.avatar ? (
              <img
                src={profile.avatar}
                alt={profile?.username || 'User'}
                className="w-5 h-5 object-cover rounded-full border border-amplify-elements-borderColor shadow-sm"
                loading="eager"
                decoding="sync"
              />
            ) : (
              <div className="i-ph:user-circle-fill text-amplify-elements-textSecondary text-lg" />
            )}
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 bg-amplify-elements-background-depth-2 shadow-sm border border-amplify-elements-borderColor px-3.5 py-2.5 w-fit max-w-[85%] rounded-2xl rounded-tr-sm ml-auto">
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((item, index) => (
              <div key={index} className="relative rounded-lg border border-amplify-elements-borderColor/50 overflow-hidden shadow-sm bg-amplify-elements-background-depth-1">
                <img
                  src={`data:${item.mimeType};base64,${item.data}`}
                  alt={`Image ${index + 1}`}
                  className="w-auto h-auto max-h-[250px] object-contain rounded-lg"
                />
              </div>
            ))}
          </div>
        )}
        {textContent && (
          <div className="text-amplify-elements-textPrimary prose-sm prose-p:my-0 leading-relaxed">
            <Markdown html>{textContent}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function stripMetadata(content: string) {
  const artifactRegex = /<amplifyArtifact\s+[^>]*>[\s\S]*?<\/amplifyArtifact>/gm;
  return content.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '').replace(artifactRegex, '');
}
