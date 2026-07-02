/**
 * Project Memory auto-detection.
 *
 * Inspects the project's current FileMap and infers structured memory fields
 * (framework, state management, backend, architecture, theme, coding style,
 * dependencies). Used to seed `Project.memory` and keep it fresh as the
 * project evolves, without overwriting fields the user has set manually.
 */

import type { FileMap } from '~/lib/stores/files';
import type { ProjectMemory } from '~/lib/persistence/project-store';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ProjectMemoryDetect');

interface DetectionResult {
  memory: Partial<ProjectMemory>;
  technologies: string[];
}

function readFile(files: FileMap, candidatePaths: string[]): string | undefined {
  for (const p of candidatePaths) {
    const entry = files[p];

    if (entry?.type === 'file' && !entry.isBinary) {
      return entry.content;
    }
  }

  return undefined;
}

function tryParseJson(text: string | undefined): any | undefined {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Extract the `dependencies` + `devDependencies` keys from a package.json. */
function extractDeps(pkg: any): { deps: Record<string, string>; dev: Record<string, string> } {
  return {
    deps: (pkg && pkg.dependencies) || {},
    dev: (pkg && pkg.devDependencies) || {},
  };
}

/** Detect framework + tech from dependencies + file markers. */
export function detectProjectMemory(files: FileMap): DetectionResult {
  const memory: Partial<ProjectMemory> = {};
  const technologies: string[] = [];

  // Find package.json anywhere in the tree (prefer root).
  const pkgPaths = Object.keys(files).filter((p) => p.endsWith('/package.json') || p === 'package.json');

  const rootPkgPath = pkgPaths.find((p) => p === 'package.json') || pkgPaths[0];
  const pkgText = readFile(files, rootPkgPath ? [rootPkgPath] : []);
  const pkg = tryParseJson(pkgText);

  if (pkg) {
    const { deps, dev } = extractDeps(pkg);
    const all = { ...deps, ...dev };
    const depNames = Object.keys(all);

    // ── Framework ──────────────────────────────────────────────
    if (all.expo) {
      memory.framework = `Expo (SDK ${all.expo})`;
      technologies.push('Expo', 'React Native');
    } else if (all.next) {
      memory.framework = `Next.js ${all.next}`;
      technologies.push('Next.js');
    } else if (all.nuxt) {
      memory.framework = `Nuxt ${all.nuxt}`;
      technologies.push('Nuxt');
    } else if (all['@remix-run/react']) {
      memory.framework = `Remix ${all['@remix-run/react']}`;
      technologies.push('Remix');
    } else if (all.vite && all.react) {
      memory.framework = `Vite + React`;
      technologies.push('Vite', 'React');
    } else if (all.vite) {
      memory.framework = `Vite`;
      technologies.push('Vite');
    } else if (all.react) {
      memory.framework = `React ${all.react}`;
      technologies.push('React');
    } else if (all.vue) {
      memory.framework = `Vue ${all.vue}`;
      technologies.push('Vue');
    } else if (all.svelte) {
      memory.framework = `Svelte ${all.svelte}`;
      technologies.push('Svelte');
    } else if (all.astro) {
      memory.framework = `Astro ${all.astro}`;
      technologies.push('Astro');
    }

    // ── State management ───────────────────────────────────────
    if (all.zustand) {
      memory.stateManagement = 'Zustand';
      technologies.push('Zustand');
    } else if (all['@reduxjs/toolkit'] || all.redux) {
      memory.stateManagement = 'Redux Toolkit';
      technologies.push('Redux');
    } else if (all.jotai) {
      memory.stateManagement = 'Jotai';
      technologies.push('Jotai');
    } else if (all['@tanstack/react-query']) {
      memory.stateManagement = 'TanStack Query';
      technologies.push('TanStack Query');
    } else if (all.mobx) {
      memory.stateManagement = 'MobX';
      technologies.push('MobX');
    } else if (all.pinia) {
      memory.stateManagement = 'Pinia';
      technologies.push('Pinia');
    }

    // ── Backend ────────────────────────────────────────────────
    if (all['@supabase/supabase-js']) {
      memory.backend = 'Supabase';
      technologies.push('Supabase');
    } else if (all.appwrite) {
      memory.backend = 'Appwrite';
      technologies.push('Appwrite');
    } else if (all['@prisma/client'] || all.prisma) {
      memory.backend = 'Prisma';
      technologies.push('Prisma');
    } else if (all.firebase) {
      memory.backend = 'Firebase';
      technologies.push('Firebase');
    } else if (all['drizzle-orm']) {
      memory.backend = 'Drizzle ORM';
      technologies.push('Drizzle');
    }

    // ── Styling / theme ────────────────────────────────────────
    if (all.nativewind) {
      memory.theme = 'NativeWind';
      technologies.push('NativeWind');
    } else if (all.tailwindcss || all['@tailwindcss/vite']) {
      memory.theme = 'Tailwind CSS';
      technologies.push('Tailwind');
    } else if (all['styled-components']) {
      memory.theme = 'styled-components';
      technologies.push('styled-components');
    } else if (all['@emotion/react']) {
      memory.theme = 'Emotion';
      technologies.push('Emotion');
    }

    // ── Coding style ───────────────────────────────────────────
    if (all.typescript || rootPkgPath?.endsWith('package.json')) {
      // If the project ships a tsconfig, assume TS.
      const hasTsConfig = Object.keys(files).some((p) => p === 'tsconfig.json' || p.endsWith('/tsconfig.json'));

      if (hasTsConfig || depNames.includes('typescript')) {
        memory.codingStyle = 'TypeScript, functional components';
      }
    }

    // ── Dependencies (notable) ─────────────────────────────────
    const notable = depNames.filter((d) =>
      [
        'react-router',
        'react-router-dom',
        '@react-navigation/native',
        'expo-router',
        'framer-motion',
        'react-native-reanimated',
        'lucide-react',
        'react-icons',
        'zod',
        'react-hook-form',
        'formik',
        'axios',
        'swr',
        'date-fns',
        'clsx',
      ].includes(d),
    );
    memory.dependencies = Array.from(new Set([...notable])).sort();
  }

  // ── Architecture heuristic ───────────────────────────────────
  const paths = Object.keys(files);
  const hasAppDir = paths.some((p) => p.startsWith('app/') && (p.endsWith('page.tsx') || p.endsWith('layout.tsx')));
  const hasSrcApp = paths.some((p) => p.startsWith('src/app/'));
  const hasFeaturesDir = paths.some((p) => p.startsWith('features/') || p.startsWith('src/features/'));

  if (hasAppDir || hasSrcApp) {
    memory.architecture = 'App Router (route-based)';
  } else if (hasFeaturesDir) {
    memory.architecture = 'Feature-based';
  }

  // ── Mobile detection ─────────────────────────────────────────
  const isMobile =
    paths.some((p) => p === 'app.json' || p.endsWith('/app.json')) &&
    !!tryParseJson(
      readFile(
        files,
        paths.filter((p) => p === 'app.json' || p.endsWith('/app.json')),
      ),
    );

  if (isMobile && !memory.framework) {
    memory.framework = 'React Native / Expo';
  }

  // Dedup technologies
  const tech = Array.from(new Set(technologies));

  logger.info('Detected project memory:', memory);

  return { memory, technologies: tech };
}

/**
 * Merge detected memory into an existing memory object WITHOUT clobbering
 * fields the user has explicitly set. We only fill in missing fields and
 * refresh `dependencies` (which is data, not opinion).
 */
export function mergeDetectedMemory(
  current: ProjectMemory | undefined,
  detected: Partial<ProjectMemory>,
): ProjectMemory {
  const merged: ProjectMemory = { ...(current ?? {}) };

  (Object.keys(detected) as (keyof ProjectMemory)[]).forEach((key) => {
    const val = detected[key];

    if (val === undefined || val === null) {
      return;
    }

    if (key === 'dependencies') {
      const set = new Set([...(merged.dependencies ?? []), ...(val as string[])]);
      merged.dependencies = Array.from(set).sort();
    } else if ((merged as any)[key] === undefined || (merged as any)[key] === '') {
      (merged as any)[key] = val;
    }
  });

  merged.updatedAt = new Date().toISOString();

  return merged;
}

/**
 * Build a compact file-tree summary for prompt injection. Lists up to N
 * paths (depth-first, directories first) so the model knows the project
 * layout without loading every file's content.
 */
export function buildFileTreeSummary(files: FileMap, maxEntries = 80): string {
  const paths = Object.keys(files).sort();

  if (paths.length === 0) {
    return '(empty project)';
  }

  const lines: string[] = [];
  let count = 0;

  for (const p of paths) {
    if (count >= maxEntries) {
      lines.push(`… ${paths.length - count} more entries`);
      break;
    }

    const entry = files[p];
    const kind = entry?.type === 'folder' ? '/' : entry?.isBinary ? ' (binary)' : '';
    lines.push(`${p}${kind}`);
    count++;
  }

  return lines.join('\n');
}
