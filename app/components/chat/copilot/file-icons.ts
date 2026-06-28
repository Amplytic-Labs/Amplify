/**
 * Inline SVG icons for file-type pills.
 *
 * Each icon is a small, self-contained SVG with its brand colours baked in
 * (no CSS masking, no UnoCSS dependency). This is more reliable than relying
 * on UnoCSS's `presetIcons` auto-resolution for the `logos` collection, and
 * gives us exact control over the colourised look the user wants (React atom
 * in cyan, JS in yellow, TS in blue, …).
 *
 * All icons are 16×16 viewBox-friendly and scale to the container size.
 */

interface SvgIconProps {
  className?: string;
}

const base = (children: React.ReactNode, viewBox = '0 0 256 256'): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${children}</svg>`,
  )}`;

/**
 * Map a file extension to a colourised SVG data-URI.
 *
 * Returns `null` for extensions without a dedicated brand icon — the caller
 * falls back to a generic Phosphor file icon (`i-ph:file`).
 */
export function extToIconDataUri(ext: string): string | null {
  switch (ext) {
    case 'jsx':
    case 'tsx':
      // React atom — cyan (#61DAFB)
      return base(
        `<circle cx="128" cy="128" r="24" fill="#61DAFB"/><g fill="none" stroke="#61DAFB" stroke-width="16"><ellipse cx="128" cy="128" rx="110" ry="48"/><ellipse cx="128" cy="128" rx="110" ry="48" transform="rotate(60 128 128)"/><ellipse cx="128" cy="128" rx="110" ry="48" transform="rotate(120 128 128)"/></g>`,
      );

    case 'js':
    case 'mjs':
    case 'cjs':
      // JavaScript — yellow (#F7DF1E) on dark square
      return base(
        `<rect width="256" height="256" rx="28" fill="#F7DF1E"/><path d="M67 196v-28c14 8 29 13 45 13 23 0 37-11 37-28 0-16-11-24-37-33-34-12-56-27-56-60 0-33 26-55 63-55 18 0 34 3 47 10v27c-13-8-29-13-46-13-21 0-35 10-35 25 0 15 11 22 37 31 36 13 56 28 56 61 0 35-27 56-68 56-19 0-37-4-49-11z" fill="#1a1a00"/>`,
      );

    case 'ts':
      // TypeScript — blue (#3178C6) on square
      return base(
        `<rect width="256" height="256" rx="28" fill="#3178C6"/><path d="M86 82v22h28v76h24v-76h28V82H86zm120 22c-11-6-24-9-39-9-15 0-27 4-36 11-9 8-14 18-14 30 0 12 4 22 12 29 8 7 20 13 37 18 9 3 15 6 19 9 4 3 6 7 6 12 0 5-2 9-6 12-4 3-10 4-17 4-9 0-17-2-24-5-7-4-13-9-17-16l-17 17c5 9 13 16 23 21 10 5 22 7 35 7 16 0 29-4 38-11 9-7 14-18 14-31 0-12-4-22-12-29-8-7-20-13-37-18-10-3-17-6-21-9-4-3-6-6-6-10 0-4 2-8 6-10 4-2 9-4 16-4 8 0 15 2 21 5 6 3 11 8 15 14l17-17c-5-8-12-14-21-19z" fill="#fff"/>`,
      );

    case 'json':
      // JSON — amber/yellow curly braces
      return base(
        `<path d="M96 32C64 32 64 64 48 64S32 80 32 96v32c0 16-16 16-16 32s16 16 16 32v32c0 16 0 32 16 32s16-32 48-32" fill="none" stroke="#CBCC41" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="M160 32c32 0 32 32 48 32s16 16 16 32v32c0 16 16 16 16 32s-16 16-16 32v32c0 16 0 32-16 32s-16-32-48-32" fill="none" stroke="#CBCC41" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`,
      );

    case 'css':
      // CSS3 — blue (#1572B6)
      return base(
        `<path d="M32 24l20 224 76 24 76-24 20-224H32z" fill="#1572B6"/><path d="M128 48v200l60-20 16-180H128z" fill="#33A9DC"/><path d="M128 128h-40l-3-28h43V72H56l8 88h64V128zm0 56l-32-8-2-22H66l4 44 58 16v-30z" fill="#fff"/><path d="M128 128v28h44l-4 44-40 8v30l58-16 8-88-66-6zm0-56v28h48l3-28h-51z" fill="#EBEBEB"/>`,
      );

    case 'scss':
    case 'sass':
      // Sass — pink (#CD6799)
      return base(
        `<path d="M128 16C66 16 16 66 16 128s50 112 112 112 112-50 112-112S190 16 128 16z" fill="#CD6799"/><path d="M186 140c-10 0-18 2-25 5-3-5-5-9-6-13-1-4-1-7 0-9 2-5 4-9 4-12 0-4-2-8-5-10-3-2-7-1-9 1-2 2-3 5-3 8 0 6 3 12 5 17-3 6-7 13-10 20-10 16-17 24-22 27-4 3-7 3-9 2-6-3-8-11-7-20 1-6 3-10 5-15 1-3 2-6 3-9 1-5 0-7-1-8-1-2-3-3-6-3-5 0-9 3-11 8-3 7-1 14 1 21-2 5-6 12-10 19-5 8-9 14-14 17-3 2-6 2-8 1-5-3-6-11-5-19 1-5 3-10 4-14 1-2 1-4 0-5-1-2-4-2-6-1-4 1-7 5-9 10-3 8-1 16 2 24-3 6-7 13-12 19-8 10-16 14-22 11-5-2-8-8-8-16 0-5 1-10 3-14" fill="#fff"/>`,
      );

    case 'html':
      // HTML5 — orange (#E34F26)
      return base(
        `<path d="M32 24l20 224 76 24 76-24 20-224H32z" fill="#E34F26"/><path d="M128 48v200l60-20 16-180H128z" fill="#EF652A"/><path d="M128 128H88l-3-28h43V72H56l8 88h64V128zm0 56l-32-8-2-22H66l4 44 58 16v-30z" fill="#fff"/><path d="M128 128v28h44l-4 44-40 8v30l58-16 8-88-66-6zm0-56v28h48l3-28h-51z" fill="#EBEBEB"/>`,
      );

    case 'vue':
      // Vue — green (#42B883) + dark (#35495E)
      return base(
        `<path d="M16 40l112 192L240 40h-48l-64 110-64-110H16z" fill="#42B883"/><path d="M64 40l64 110 64-110h-40l-24 42-24-42H64z" fill="#35495E"/>`,
      );

    case 'svelte':
      // Svelte — orange/red (#FF3E00)
      return base(
        `<path d="M207 86c29-42 2-82-44-86-38-3-67 15-86 48-19 33-12 69 16 88-29 42-2 82 44 86 38 3 67-15 86-48 19-33 12-69-16-88z" fill="#FF3E00"/><path d="M100 38c20-14 48-12 64 4 8 8 12 20 10 30-2 8-8 14-16 18l-4 2 4 2c14 8 20 24 14 38-8 18-32 28-54 22-12-3-20-10-24-22l-2-4 16-10 2 4c4 8 12 12 20 10 8-2 14-8 14-16 0-8-6-14-16-16l-20-4 4-16 20 2c10 0 16-6 16-14 0-8-8-14-18-14-8 0-14 4-18 10l-2 4-16-10 2-4c4-8 10-14 18-18z" fill="#fff"/>`,
      );

    case 'py':
      // Python — blue (#3776AB) + yellow (#FFD43B)
      return base(
        `<path d="M126 16c-36 0-30 16-30 16v18h32v4H82s-22-2-22 32 20 34 20 34h14v-18s-2-20 20-20h32s18 2 18-18V40s2-24-22-24h-16z" fill="#3776AB"/><path d="M130 240c36 0 30-16 30-16v-18h-32v-4h46s22 2 22-32-20-34-20-34h-14v18s2 20-20 20h-32s-18 2-18 18v32s-2 24 22 24h16z" fill="#FFD43B"/><circle cx="118" cy="40" r="6" fill="#fff"/><circle cx="138" cy="216" r="6" fill="#3776AB"/>`,
      );

    case 'go':
      // Go — cyan (#00ADD8)
      return base(
        `<path d="M176 124c-2 0-4 2-4 4s2 4 4 4 4-2 4-4-2-4-4-4z" fill="#00ADD8"/><path d="M128 24c-58 0-104 46-104 104s46 104 104 104 104-46 104-104S186 24 128 24zm44 84c-2-6-8-10-14-8-4 1-7 4-8 8-1 4 0 8 3 11 3 3 7 4 11 3 6-2 10-8 8-14zm-44-16c-8 0-16 2-22 6l-8-12c8-5 18-8 30-8 10 0 18 2 24 6l-8 12c-5-3-10-4-16-4zm-44 16c2 6 8 10 14 8 4-1 7-4 8-8 1-4 0-8-3-11-3-3-7-4-11-3-6 2-10 8-8 14z" fill="#00ADD8"/>`,
      );

    case 'rs':
    case 'rust':
      // Rust — dark orange (#DEA584)
      return base(
        `<circle cx="128" cy="128" r="108" fill="none" stroke="#DEA584" stroke-width="14"/><path d="M128 56l-10 24 20 0-10-24zm-60 36l8 24-20 12-8-24 20-12zm120 0l20 12-8 24-20-12 8-24zm-60 100l-10-24 20 0-10 24z" fill="#DEA584"/><circle cx="128" cy="128" r="36" fill="none" stroke="#DEA584" stroke-width="12"/>`,
      );

    case 'md':
    case 'mdx':
      // Markdown — blue (#083FA1) with "M↓"
      return base(
        `<rect width="256" height="256" rx="28" fill="#083FA1"/><path d="M40 80v96h176V80H40zm24 72v-48l24 30 24-30v48h-16v-22l-8 10-8-10v22H64zm96 0l-24-28v28h-16v-48h16l24 28v-28h16v48h-16z" fill="#fff"/>`,
      );

    case 'java':
      // Java — orange (#ED8B00)
      return base(
        `<path d="M96 200c-8 6-4 10 4 8 4-1 8-3 12-5l-4-6c-4 1-8 2-12 3z" fill="#ED8B00"/><path d="M180 56c-20 14-60 48-70 92-2 10-4 20-2 30 0 0 4-2 6-6 2-4 4-12 8-20 8-16 30-44 58-62 4-2 8-4 12-5l-4-20c-2-4-4-8-8-9z" fill="#ED8B00"/><path d="M88 184c20-8 40-18 56-36 16-18 26-40 34-62-12 10-26 20-38 34-14 16-24 34-34 52l-4 6-14 6z" fill="#5382A1"/><path d="M88 184l14-6 4-6c10-18 20-36 34-52 12-14 26-24 38-34 8-22 14-46 14-72-20 14-60 48-70 92-2 10-4 20-2 30l-32 48z" fill="#5382A1"/>`,
      );

    case 'c':
      return base(
        `<circle cx="128" cy="128" r="108" fill="#5C6BC0"/><path d="M118 88c-20 0-36 18-36 40s16 40 36 40c10 0 20-4 26-12l-12-10c-4 4-8 6-14 6-10 0-18-10-18-24s8-24 18-24c6 0 10 2 14 6l12-10c-6-8-16-12-26-12z" fill="#fff"/>`,
      );

    case 'cpp':
      return base(
        `<circle cx="128" cy="128" r="108" fill="#5C6BC0"/><path d="M118 88c-20 0-36 18-36 40s16 40 36 40c10 0 20-4 26-12l-12-10c-4 4-8 6-14 6-10 0-18-10-18-24s8-24 18-24c6 0 10 2 14 6l12-10c-6-8-16-12-26-12z" fill="#fff"/><path d="M160 116l-4 14h16l-4 14h-16l-6 20h-16l6-20h-16l-4 14h-16l4-14h-16l4-14h16l6-20h16l-6 20h16l4-14h16l-4 14z" fill="#fff"/>`,
      );

    case 'swift':
      // Swift — orange (#FA7343)
      return base(
        `<path d="M128 16C66 16 16 66 16 128s50 112 112 112 112-50 112-112S190 16 128 16z" fill="#FA7343"/><path d="M184 56c-20 30-50 50-80 62-6 2-12 2-18 0-8-4-14-12-14-22 0-8 4-16 10-22-16 8-28 24-28 44 0 22 16 40 38 44 8 2 16 2 24 0 30-8 56-30 70-58 4-8 6-18 6-28 0-8-2-14-8-20z" fill="#fff"/>`,
      );

    case 'dart':
      // Dart — blue (#0175C2)
      return base(
        `<path d="M140 28L48 120l36 36 128-128-72 0z" fill="#0175C2"/><path d="M84 156l-36-36 4 76 32-40zm0 0l40 40-76-4 36-36z" fill="#02569B"/><path d="M84 156l40 40 60-60-36-36-64 56z" fill="#0175C2"/>`,
      );

    case 'php':
      // PHP — purple (#777BB4)
      return base(
        `<ellipse cx="128" cy="128" rx="112" ry="64" fill="#777BB4"/><text x="128" y="148" font-family="Arial,sans-serif" font-size="56" font-weight="bold" fill="#fff" text-anchor="middle">PHP</text>`,
      );

    case 'rb':
      // Ruby — red (#CC342D)
      return base(
        `<path d="M128 16L48 88l80 152 80-152L128 16z" fill="#CC342D"/><path d="M128 16L48 88h160L128 16z" fill="#F26B5E"/><path d="M48 88l80 152V88H48z" fill="#A82520"/>`,
      );

    default:
      return null;
  }
}

/**
 * Props for the SVG icon element.
 */
export interface FileIconProps extends SvgIconProps {
  ext: string;
}

/**
 * Render a colourised file-type icon for the given extension. Falls back to a
 * generic file icon (rendered as a Phosphor class by the caller) when the
 * extension has no dedicated brand SVG.
 */
export function getFileIconStyle(ext: string): { backgroundImage: string } | null {
  const uri = extToIconDataUri(ext);

  if (!uri) {
    return null;
  }

  return {
    backgroundImage: `url("${uri}")`,
  };
}
