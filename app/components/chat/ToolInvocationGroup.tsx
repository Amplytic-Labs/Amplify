import { memo } from 'react';
import { ToolInvocationItem } from './ToolInvocationItem';

interface ToolInvocationGroupProps {
  /**
   * v7 tool parts (`type: 'tool-<name>'` or `'dynamic-tool'`) OR legacy v4
   * `tool-invocation` parts. Both shapes are accepted — they are passed
   * through to ToolInvocationItem, which uses the shape-agnostic helpers
   * in `~/lib/chat/tool-parts`.
   */
  parts: any[];
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
