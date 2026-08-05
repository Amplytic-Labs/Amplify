/**
 * Maps a detected framework label (from `project-memory-detect.ts`) to a
 * UnoCSS icon class (`i-amplify:<name>`) for display in the sidebar /
 * ExpandableCard. The icon SVGs live in `/public/icons/*.svg` and are wired
 * into UnoCSS via `uno.config.ts`.
 *
 * Returns a fallback (`i-amplify:react`) when the framework is unknown, so
 * the UI always has a meaningful badge.
 */

export interface FrameworkMeta {
  /** UnoCSS icon class, e.g. `i-amplify:nextjs`. */
  icon: string;

  /** A tailwind-friendly gradient (from/to color stops) for thumbnail tints. */
  gradient: string;

  /** Short display label. */
  label: string;
}

const UNKNOWN: FrameworkMeta = {
  icon: 'i-amplify:react',
  gradient: 'from-purple-500/20 to-fuchsia-500/10',
  label: 'Project',
};

const MAP: Record<string, FrameworkMeta> = {
  expo: { icon: 'i-amplify:expo', gradient: 'from-sky-500/20 to-blue-500/10', label: 'Expo' },
  next: { icon: 'i-amplify:nextjs', gradient: 'from-zinc-700/30 to-zinc-900/20', label: 'Next.js' },
  nuxt: { icon: 'i-amplify:nuxt', gradient: 'from-emerald-500/20 to-green-500/10', label: 'Nuxt' },
  remix: { icon: 'i-amplify:remix', gradient: 'from-fuchsia-500/20 to-pink-500/10', label: 'Remix' },
  vite: { icon: 'i-amplify:vite', gradient: 'from-amber-500/20 to-purple-500/10', label: 'Vite' },
  react: { icon: 'i-amplify:react', gradient: 'from-cyan-500/20 to-sky-500/10', label: 'React' },
  vue: { icon: 'i-amplify:vue', gradient: 'from-emerald-500/20 to-teal-500/10', label: 'Vue' },
  svelte: { icon: 'i-amplify:svelte', gradient: 'from-orange-500/20 to-red-500/10', label: 'Svelte' },
  astro: { icon: 'i-amplify:astro', gradient: 'from-orange-500/20 to-purple-500/10', label: 'Astro' },
  angular: { icon: 'i-amplify:angular', gradient: 'from-red-500/20 to-rose-500/10', label: 'Angular' },
  solid: { icon: 'i-amplify:solidjs', gradient: 'from-blue-500/20 to-indigo-500/10', label: 'SolidJS' },
  qwik: { icon: 'i-amplify:qwik', gradient: 'from-sky-500/20 to-violet-500/10', label: 'Qwik' },
  nuxtjs: { icon: 'i-amplify:nuxt', gradient: 'from-emerald-500/20 to-green-500/10', label: 'Nuxt' },
  slidev: { icon: 'i-amplify:slidev', gradient: 'from-purple-500/20 to-fuchsia-500/10', label: 'Slidev' },
  nativescript: { icon: 'i-amplify:nativescript', gradient: 'from-cyan-500/20 to-blue-500/10', label: 'NativeScript' },
  typescript: { icon: 'i-amplify:typescript', gradient: 'from-blue-500/20 to-sky-500/10', label: 'TypeScript' },
};

/**
 * Resolve a framework label (e.g. "Vite + React", "Next.js 14",
 * "Expo (SDK 49)") to a FrameworkMeta with an icon + gradient. Matching is
 * case-insensitive on the first keyword of the label.
 */
export function getFrameworkMeta(framework?: string): FrameworkMeta {
  if (!framework) {
    return UNKNOWN;
  }

  const lower = framework.toLowerCase();

  /*
   * Check each known keyword; first match wins. Order matters for compound
   * labels like "Vite + React" — we prefer Vite's icon there.
   */
  const keys = [
    'expo',
    'next',
    'nuxt',
    'remix',
    'vite',
    'react',
    'vue',
    'svelte',
    'astro',
    'angular',
    'solid',
    'qwik',
    'slidev',
    'nativescript',
    'typescript',
  ];

  for (const key of keys) {
    if (lower.includes(key)) {
      return MAP[key] ?? UNKNOWN;
    }
  }

  return UNKNOWN;
}

/** True if the framework label indicates a mobile/native project (Expo/RN). */
export function isMobileFramework(framework?: string): boolean {
  if (!framework) {
    return false;
  }

  const lower = framework.toLowerCase();

  return lower.includes('expo') || lower.includes('react native') || lower.includes('nativescript');
}
