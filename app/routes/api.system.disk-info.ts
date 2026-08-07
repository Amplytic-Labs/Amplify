import type { ActionFunctionArgs, LoaderFunction } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';

/**
 * Disk information endpoint.
 *
 * Workers-compatible: `child_process` is NOT available in Cloudflare
 * Workers V8 isolates. This route returns environment-appropriate data:
 * - In Workers: returns a clear "not available" response
 * - In Node dev: returns mock data for development purposes
 *
 * For real disk monitoring, use a separate monitoring service or
 * Cloudflare Analytics instead.
 */

interface DiskInfo {
  filesystem: string;
  size: number;
  used: number;
  available: number;
  percentage: number;
  mountpoint: string;
  timestamp: string;
  error?: string;
}

function getDiskInfo(): DiskInfo[] {
  /*
   * Cloudflare Workers environment — disk info is not available
   * In development, return mock data for UI testing
   */
  const isDevelopment = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';

  if (isDevelopment) {
    const percentage = Math.floor(40 + Math.random() * 20);
    const totalSize = 500 * 1024 * 1024 * 1024; // 500GB
    const usedSize = Math.floor((totalSize * percentage) / 100);
    const availableSize = totalSize - usedSize;

    return [
      {
        filesystem: 'MockDisk',
        size: totalSize,
        used: usedSize,
        available: availableSize,
        percentage,
        mountpoint: '/',
        timestamp: new Date().toISOString(),
      },
      {
        filesystem: 'MockDisk2',
        size: 1024 * 1024 * 1024 * 1024, // 1TB
        used: 300 * 1024 * 1024 * 1024, // 300GB
        available: 724 * 1024 * 1024 * 1024, // 724GB
        percentage: 30,
        mountpoint: '/data',
        timestamp: new Date().toISOString(),
      },
    ];
  }

  // Production Workers — not available
  return [
    {
      filesystem: 'N/A',
      size: 0,
      used: 0,
      available: 0,
      percentage: 0,
      mountpoint: 'N/A',
      timestamp: new Date().toISOString(),
      error: 'Disk information is not available in Cloudflare Workers environment',
    },
  ];
}

export const loader: LoaderFunction = async ({ request: _request }) => {
  try {
    return json(getDiskInfo());
  } catch (error) {
    console.error('Failed to get disk info:', error);
    return json(
      [
        {
          filesystem: 'Unknown',
          size: 0,
          used: 0,
          available: 0,
          percentage: 0,
          mountpoint: '/',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
      { status: 500 },
    );
  }
};

export const action = async ({ request: _request }: ActionFunctionArgs) => {
  try {
    return json(getDiskInfo());
  } catch (error) {
    console.error('Failed to get disk info:', error);
    return json(
      [
        {
          filesystem: 'Unknown',
          size: 0,
          used: 0,
          available: 0,
          percentage: 0,
          mountpoint: '/',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
      { status: 500 },
    );
  }
};
