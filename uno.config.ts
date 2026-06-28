/**
 * Collect all vscode-icons class names from the file-icon-map so UnoCSS
 * generates the CSS even though they are resolved dynamically at runtime.
 */
import { globSync } from 'fast-glob';
import fs from 'node:fs/promises';
import { basename } from 'node:path';
import { defineConfig, presetIcons, presetUno, transformerDirectives } from 'unocss';

// ── vscode-icons safelist ──────────────────────────────────────────
const vscodeIconClasses: string[] = [
  // Languages
  'i-vscode-icons:file-type-typescript',
  'i-vscode-icons:file-type-js',
  'i-vscode-icons:file-type-js-official',
  'i-vscode-icons:file-type-reactjs',
  'i-vscode-icons:file-type-reactts',
  'i-vscode-icons:file-type-python',
  'i-vscode-icons:file-type-go',
  'i-vscode-icons:file-type-rust',
  'i-vscode-icons:file-type-java',
  'i-vscode-icons:file-type-c',
  'i-vscode-icons:file-type-cpp',
  'i-vscode-icons:file-type-csharp',
  'i-vscode-icons:file-type-ruby',
  'i-vscode-icons:file-type-php',
  'i-vscode-icons:file-type-swift',
  'i-vscode-icons:file-type-dartlang',
  'i-vscode-icons:file-type-kotlin',
  'i-vscode-icons:file-type-scala',
  'i-vscode-icons:file-type-lua',
  'i-vscode-icons:file-type-r',
  'i-vscode-icons:file-type-zig',
  'i-vscode-icons:file-type-nim',
  'i-vscode-icons:file-type-elixir',
  'i-vscode-icons:file-type-haskell',
  'i-vscode-icons:file-type-clojure',
  'i-vscode-icons:file-type-clojurescript',
  'i-vscode-icons:file-type-emacs',
  'i-vscode-icons:file-type-fsharp',
  'i-vscode-icons:file-type-julia',
  'i-vscode-icons:file-type-groovy',
  'i-vscode-icons:file-type-crystal',
  'i-vscode-icons:file-type-elm',
  'i-vscode-icons:file-type-purescript',
  'i-vscode-icons:file-type-reason',
  'i-vscode-icons:file-type-ocaml',
  'i-vscode-icons:file-type-solidity',
  'i-vscode-icons:file-type-vlang',
  'i-vscode-icons:file-type-prolog',
  'i-vscode-icons:file-type-fortran',
  'i-vscode-icons:file-type-lisp',
  'i-vscode-icons:file-type-vue',
  'i-vscode-icons:file-type-svelte',
  'i-vscode-icons:file-type-astro',
  'i-vscode-icons:file-type-coffeescript',
  // Web
  'i-vscode-icons:file-type-html',
  'i-vscode-icons:file-type-css',
  'i-vscode-icons:file-type-scss',
  'i-vscode-icons:file-type-sass',
  'i-vscode-icons:file-type-less',
  'i-vscode-icons:file-type-stylus',
  // Data / Config
  'i-vscode-icons:file-type-json',
  'i-vscode-icons:file-type-json-official',
  'i-vscode-icons:file-type-json5',
  'i-vscode-icons:file-type-toml',
  'i-vscode-icons:file-type-yaml',
  'i-vscode-icons:file-type-xml',
  'i-vscode-icons:file-type-config',
  'i-vscode-icons:file-type-sql',
  'i-vscode-icons:file-type-sqlite',
  'i-vscode-icons:file-type-graphql',
  'i-vscode-icons:file-type-protobuf',
  'i-vscode-icons:file-type-prisma',
  'i-vscode-icons:file-type-drizzle-orm',
  // Docs / Text
  'i-vscode-icons:file-type-markdown',
  'i-vscode-icons:file-type-mdx',
  'i-vscode-icons:file-type-text',
  'i-vscode-icons:file-type-pdf2',
  'i-vscode-icons:file-type-word2',
  'i-vscode-icons:file-type-excel',
  'i-vscode-icons:file-type-powerpoint',
  'i-vscode-icons:file-type-asciidoc',
  'i-vscode-icons:file-type-org',
  'i-vscode-icons:file-type-tex',
  'i-vscode-icons:file-type-wikitext',
  'i-vscode-icons:file-type-textile',
  // Media / Images
  'i-vscode-icons:file-type-image',
  'i-vscode-icons:file-type-svg',
  'i-vscode-icons:file-type-audio',
  'i-vscode-icons:file-type-video',
  'i-vscode-icons:file-type-font',
  // Archives / Binary
  'i-vscode-icons:file-type-zip',
  'i-vscode-icons:file-type-wasm',
  'i-vscode-icons:file-type-binary',
  // Shells
  'i-vscode-icons:file-type-shell',
  'i-vscode-icons:file-type-powershell',
  'i-vscode-icons:file-type-powershell2',
  'i-vscode-icons:file-type-bat',
  // Ecosystem / Tooling
  'i-vscode-icons:file-type-docker',
  'i-vscode-icons:file-type-cmake',
  'i-vscode-icons:file-type-bazel',
  'i-vscode-icons:file-type-vite',
  'i-vscode-icons:file-type-vitest',
  'i-vscode-icons:file-type-eslint',
  'i-vscode-icons:file-type-prettier',
  'i-vscode-icons:file-type-tailwind',
  'i-vscode-icons:file-type-unocss',
  'i-vscode-icons:file-type-postcss',
  'i-vscode-icons:file-type-postcssconfig',
  'i-vscode-icons:file-type-jest',
  'i-vscode-icons:file-type-mocha',
  'i-vscode-icons:file-type-cypress',
  'i-vscode-icons:file-type-playwright',
  'i-vscode-icons:file-type-storybook',
  'i-vscode-icons:file-type-stylelint',
  'i-vscode-icons:file-type-markdownlint',
  'i-vscode-icons:file-type-tslint',
  'i-vscode-icons:file-type-biome',
  'i-vscode-icons:file-type-editorconfig',
  'i-vscode-icons:file-type-browserslist',
  'i-vscode-icons:file-type-terraform',
  'i-vscode-icons:file-type-ansible',
  'i-vscode-icons:file-type-helm',
  'i-vscode-icons:file-type-liquid',
  'i-vscode-icons:file-type-handlebars',
  'i-vscode-icons:file-type-pug',
  'i-vscode-icons:file-type-nunjucks',
  'i-vscode-icons:file-type-ejs',
  'i-vscode-icons:file-type-haml',
  'i-vscode-icons:file-type-slim',
  'i-vscode-icons:file-type-webpack',
  'i-vscode-icons:file-type-rollup',
  'i-vscode-icons:file-type-yarn',
  'i-vscode-icons:file-type-pnpm',
  'i-vscode-icons:file-type-npm',
  'i-vscode-icons:file-type-node',
  'i-vscode-icons:file-type-bun',
  'i-vscode-icons:file-type-deno',
  'i-vscode-icons:file-type-gradle',
  'i-vscode-icons:file-type-maven',
  'i-vscode-icons:file-type-sln',
  'i-vscode-icons:file-type-csproj',
  'i-vscode-icons:file-type-testjs',
  'i-vscode-icons:file-type-testts',
  'i-vscode-icons:file-type-rspec',
  'i-vscode-icons:file-type-dotenv',
  'i-vscode-icons:file-type-package',
  'i-vscode-icons:file-type-tsconfig',
  'i-vscode-icons:file-type-jsconfig',
  'i-vscode-icons:file-type-git',
  'i-vscode-icons:file-type-license',
  'i-vscode-icons:file-type-key',
  'i-vscode-icons:file-type-cert',
  'i-vscode-icons:file-type-typedoc',
  'i-vscode-icons:file-type-cheader',
  'i-vscode-icons:file-type-cppheader',
  'i-vscode-icons:file-type-verilog',
  'i-vscode-icons:file-type-vhdl',
  'i-vscode-icons:file-type-assembly',
  // Fallbacks
  'i-vscode-icons:file',
  'i-vscode-icons:default-file',
];

const iconPaths = globSync('./icons/*.svg');

const collectionName = 'bolt';

const customIconCollection = iconPaths.reduce(
  (acc, iconPath) => {
    const [iconName] = basename(iconPath).split('.');

    acc[collectionName] ??= {};
    acc[collectionName][iconName] = async () => fs.readFile(iconPath, 'utf8');

    return acc;
  },
  {} as Record<string, Record<string, () => Promise<string>>>,
);

const BASE_COLORS = {
  white: '#FFFFFF',
  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    950: '#0A0A0A',
  },
  accent: {
    50: '#F8F5FF',
    100: '#F0EBFF',
    200: '#E1D6FF',
    300: '#CEBEFF',
    400: '#B69EFF',
    500: '#9C7DFF',
    600: '#8A5FFF',
    700: '#7645E8',
    800: '#6234BB',
    900: '#502D93',
    950: '#2D1959',
  },
  green: {
    50: '#F0FDF4',
    100: '#DCFCE7',
    200: '#BBF7D0',
    300: '#86EFAC',
    400: '#4ADE80',
    500: '#22C55E',
    600: '#16A34A',
    700: '#15803D',
    800: '#166534',
    900: '#14532D',
    950: '#052E16',
  },
  orange: {
    50: '#FFFAEB',
    100: '#FEEFC7',
    200: '#FEDF89',
    300: '#FEC84B',
    400: '#FDB022',
    500: '#F79009',
    600: '#DC6803',
    700: '#B54708',
    800: '#93370D',
    900: '#792E0D',
  },
  red: {
    50: '#FEF2F2',
    100: '#FEE2E2',
    200: '#FECACA',
    300: '#FCA5A5',
    400: '#F87171',
    500: '#EF4444',
    600: '#DC2626',
    700: '#B91C1C',
    800: '#991B1B',
    900: '#7F1D1D',
    950: '#450A0A',
  },
};

const COLOR_PRIMITIVES = {
  ...BASE_COLORS,
  alpha: {
    white: generateAlphaPalette(BASE_COLORS.white),
    gray: generateAlphaPalette(BASE_COLORS.gray[900]),
    red: generateAlphaPalette(BASE_COLORS.red[500]),
    accent: generateAlphaPalette(BASE_COLORS.accent[500]),
  },
};

export default defineConfig({
  safelist: [...Object.keys(customIconCollection[collectionName] || {}).map((x) => `i-bolt:${x}`), ...vscodeIconClasses],
  shortcuts: {
    'bolt-ease-cubic-bezier': 'ease-[cubic-bezier(0.4,0,0.2,1)]',
    'transition-theme': 'transition-[background-color,border-color,color] duration-150 bolt-ease-cubic-bezier',
    kdb: 'bg-bolt-elements-code-background text-bolt-elements-code-text py-1 px-1.5 rounded-md',
    'max-w-chat': 'max-w-[var(--chat-max-width)]',
  },
  rules: [
    /**
     * This shorthand doesn't exist in Tailwind and we overwrite it to avoid
     * any conflicts with minified CSS classes.
     */
    ['b', {}],
  ],
  theme: {
    colors: {
      ...COLOR_PRIMITIVES,
      background: 'var(--background)',
      foreground: 'var(--foreground)',
      muted: {
        DEFAULT: 'var(--muted)',
        foreground: 'var(--muted-foreground)',
      },
      border: 'var(--border)',
      sidebar: {
        DEFAULT: 'var(--sidebar)',
        foreground: 'var(--sidebar-foreground)',
        primary: 'var(--sidebar-primary)',
        'primary-foreground': 'var(--sidebar-primary-foreground)',
        accent: 'var(--sidebar-accent)',
        'accent-foreground': 'var(--sidebar-accent-foreground)',
        border: 'var(--sidebar-border)',
        ring: 'var(--sidebar-ring)',
      },
      card: {
        DEFAULT: 'var(--card)',
        foreground: 'var(--card-foreground)',
      },
      popover: {
        DEFAULT: 'var(--popover)',
        foreground: 'var(--popover-foreground)',
      },
      bolt: {
        elements: {
          borderColor: 'var(--bolt-elements-borderColor)',
          borderColorActive: 'var(--bolt-elements-borderColorActive)',
          background: {
            depth: {
              1: 'var(--bolt-elements-bg-depth-1)',
              2: 'var(--bolt-elements-bg-depth-2)',
              3: 'var(--bolt-elements-bg-depth-3)',
              4: 'var(--bolt-elements-bg-depth-4)',
            },
          },
          textPrimary: 'var(--bolt-elements-textPrimary)',
          textSecondary: 'var(--bolt-elements-textSecondary)',
          textTertiary: 'var(--bolt-elements-textTertiary)',
          code: {
            background: 'var(--bolt-elements-code-background)',
            text: 'var(--bolt-elements-code-text)',
          },
          button: {
            primary: {
              background: 'var(--bolt-elements-button-primary-background)',
              backgroundHover: 'var(--bolt-elements-button-primary-backgroundHover)',
              text: 'var(--bolt-elements-button-primary-text)',
            },
            secondary: {
              background: 'var(--bolt-elements-button-secondary-background)',
              backgroundHover: 'var(--bolt-elements-button-secondary-backgroundHover)',
              text: 'var(--bolt-elements-button-secondary-text)',
            },
            danger: {
              background: 'var(--bolt-elements-button-danger-background)',
              backgroundHover: 'var(--bolt-elements-button-danger-backgroundHover)',
              text: 'var(--bolt-elements-button-danger-text)',
            },
          },
          item: {
            contentDefault: 'var(--bolt-elements-item-contentDefault)',
            contentActive: 'var(--bolt-elements-item-contentActive)',
            contentAccent: 'var(--bolt-elements-item-contentAccent)',
            contentDanger: 'var(--bolt-elements-item-contentDanger)',
            backgroundDefault: 'var(--bolt-elements-item-backgroundDefault)',
            backgroundActive: 'var(--bolt-elements-item-backgroundActive)',
            backgroundAccent: 'var(--bolt-elements-item-backgroundAccent)',
            backgroundDanger: 'var(--bolt-elements-item-backgroundDanger)',
          },
          actions: {
            background: 'var(--bolt-elements-actions-background)',
            code: {
              background: 'var(--bolt-elements-actions-code-background)',
            },
          },
          artifacts: {
            background: 'var(--bolt-elements-artifacts-background)',
            backgroundHover: 'var(--bolt-elements-artifacts-backgroundHover)',
            borderColor: 'var(--bolt-elements-artifacts-borderColor)',
            inlineCode: {
              background: 'var(--bolt-elements-artifacts-inlineCode-background)',
              text: 'var(--bolt-elements-artifacts-inlineCode-text)',
            },
          },
          messages: {
            background: 'var(--bolt-elements-messages-background)',
            linkColor: 'var(--bolt-elements-messages-linkColor)',
            code: {
              background: 'var(--bolt-elements-messages-code-background)',
            },
            inlineCode: {
              background: 'var(--bolt-elements-messages-inlineCode-background)',
              text: 'var(--bolt-elements-messages-inlineCode-text)',
            },
          },
          icon: {
            success: 'var(--bolt-elements-icon-success)',
            error: 'var(--bolt-elements-icon-error)',
            primary: 'var(--bolt-elements-icon-primary)',
            secondary: 'var(--bolt-elements-icon-secondary)',
            tertiary: 'var(--bolt-elements-icon-tertiary)',
          },
          preview: {
            addressBar: {
              background: 'var(--bolt-elements-preview-addressBar-background)',
              backgroundHover: 'var(--bolt-elements-preview-addressBar-backgroundHover)',
              backgroundActive: 'var(--bolt-elements-preview-addressBar-backgroundActive)',
              text: 'var(--bolt-elements-preview-addressBar-text)',
              textActive: 'var(--bolt-elements-preview-addressBar-textActive)',
            },
          },
          terminals: {
            background: 'var(--bolt-elements-terminals-background)',
            buttonBackground: 'var(--bolt-elements-terminals-buttonBackground)',
          },
          dividerColor: 'var(--bolt-elements-dividerColor)',
          loader: {
            background: 'var(--bolt-elements-loader-background)',
            progress: 'var(--bolt-elements-loader-progress)',
          },
          prompt: {
            background: 'var(--bolt-elements-prompt-background)',
          },
          sidebar: {
            dropdownShadow: 'var(--bolt-elements-sidebar-dropdownShadow)',
            buttonBackgroundDefault: 'var(--bolt-elements-sidebar-buttonBackgroundDefault)',
            buttonBackgroundHover: 'var(--bolt-elements-sidebar-buttonBackgroundHover)',
            buttonText: 'var(--bolt-elements-sidebar-buttonText)',
          },
          cta: {
            background: 'var(--bolt-elements-cta-background)',
            text: 'var(--bolt-elements-cta-text)',
          },
        },
      },
    },
  },
  transformers: [transformerDirectives()],
  presets: [
    presetUno({
      dark: {
        light: '[data-theme="light"]',
        dark: '[data-theme="dark"]',
      },
    }),
    presetIcons({
      warn: true,
      collections: {
        ...customIconCollection,
      },
      unit: 'em',
    }),
  ],
});

/**
 * Generates an alpha palette for a given hex color.
 *
 * @param hex - The hex color code (without alpha) to generate the palette from.
 * @returns An object where keys are opacity percentages and values are hex colors with alpha.
 *
 * Example:
 *
 * ```
 * {
 *   '1': '#FFFFFF03',
 *   '2': '#FFFFFF05',
 *   '3': '#FFFFFF08',
 * }
 * ```
 */
function generateAlphaPalette(hex: string) {
  return [1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].reduce(
    (acc, opacity) => {
      const alpha = Math.round((opacity / 100) * 255)
        .toString(16)
        .padStart(2, '0');

      acc[opacity] = `${hex}${alpha}`;

      return acc;
    },
    {} as Record<number, string>,
  );
}
