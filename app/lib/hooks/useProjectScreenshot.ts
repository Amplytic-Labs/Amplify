import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { db } from '~/lib/persistence/useChatHistory';
import { projectStore } from '~/lib/persistence/project-store';
import { getProjectScreenshot, type ProjectScreenshot } from '~/lib/persistence/project-screenshots';

/**
 * Load a single project's screenshot (data URL) from IndexedDB. Re-fetches
 * whenever the project's `screenshotAt` flag changes (set by the capture
 * service after a new capture), so the ExpandableCard updates live.
 */
export function useProjectScreenshot(projectId: string | undefined): ProjectScreenshot | undefined {
  const [shot, setShot] = useState<ProjectScreenshot | undefined>(undefined);

  /*
   * Subscribe to the project store version so we re-read screenshotAt when it
   * changes (the capture service bumps it after storing a new screenshot).
   */
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error — _versionStore is private but stable across releases.
  const version = useStore(projectStore._versionStore);

  useEffect(() => {
    let cancelled = false;

    if (!projectId || !db) {
      setShot(undefined);

      return;
    }

    getProjectScreenshot(db, projectId)
      .then((s) => {
        if (!cancelled) {
          setShot(s);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShot(undefined);
        }
      });

    // eslint-disable-next-line consistent-return
    return () => {
      cancelled = true;
    };
  }, [projectId, version]);

  return shot;
}
