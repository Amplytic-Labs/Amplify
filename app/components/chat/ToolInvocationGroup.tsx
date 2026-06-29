import { memo } from 'react';
import { ToolInvocationItem } from './ToolInvocationItem';
import type { ToolInvocationUIPart } from '@ai-sdk/ui-utils';

interface ToolInvocationGroupProps {
  parts: ToolInvocationUIPart[];
}

export const ToolInvocationGroup = memo(({ parts }: ToolInvocationGroupProps) => {
  return (
    <div className="my-2 border border-amplify-elements-borderColor rounded-md overflow-hidden">
      {parts.map((part, index) => (
        <ToolInvocationItem key={index} part={part} grouped />
      ))}
    </div>
  );
});
