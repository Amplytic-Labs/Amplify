import { useStore } from '@nanostores/react';
import { description as descriptionStore } from '~/lib/persistence';

export function ChatDescription() {
  const initialDescription = useStore(descriptionStore)!;

  if (!initialDescription) {
    return null;
  }

  return <div className="flex items-center justify-center top-0.4 relative">{initialDescription}</div>;
}
