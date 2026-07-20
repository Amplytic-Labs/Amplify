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

const collectionName = 'amplify';

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
    50: '#FFF1F4',
    100: '#FFE1E7',
    200: '#FFC8D3',
    300: '#FF9FB1',
    400: '#FF5A7E',
    500: '#FF2056',
    600: '#E6003A',
    700: '#BD002F',
    800: '#990027',
    900: '#7A0020',
    950: '#4D0014',
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
  safelist: [
    ...Object.keys(customIconCollection[collectionName] || {}).map((x) => `i-amplify:${x}`),
    ...vscodeIconClasses,
  ],
  shortcuts: {
    'amplify-ease-cubic-bezier': 'ease-[cubic-bezier(0.4,0,0.2,1)]',
    'transition-theme': 'transition-[background-color,border-color,color] duration-150 amplify-ease-cubic-bezier',
    kdb: 'bg-amplify-elements-code-background text-amplify-elements-code-text py-1 px-1.5 rounded-md',
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
      amplify: {
        elements: {
          borderColor: 'var(--amplify-elements-borderColor)',
          borderColorActive: 'var(--amplify-elements-borderColorActive)',
          background: {
            /*
             * DEFAULT resolves `bg-amplify-elements-background` (used by the
             * Button `default` variant and several containers) to
             * `transparent`. Per the project-wide design rule, any
             * container / button that does NOT carry an explicit `bg-*`
             * class must render TRANSPARENT — it inherits whatever its
             * parent paints. This eliminates the "white-on-white" default
             * that previously made plain Buttons / Cards / Inputs look
             * like flat slabs of the page background.
             *
             * Containers that need a solid theme-aware surface MUST opt in
             * explicitly via `bg-amplify-elements-background-depth-1/2/3/4`
             * or another explicit `bg-*` class.
             *
             * See `app/styles/variables.scss` for the source-of-truth token
             * definition and the full rationale.
             */
            DEFAULT: 'var(--amplify-elements-background)',
            depth: {
              1: 'var(--amplify-elements-bg-depth-1)',
              2: 'var(--amplify-elements-bg-depth-2)',
              3: 'var(--amplify-elements-bg-depth-3)',
              4: 'var(--amplify-elements-bg-depth-4)',
            },
          },
          textPrimary: 'var(--amplify-elements-textPrimary)',
          textSecondary: 'var(--amplify-elements-textSecondary)',
          textTertiary: 'var(--amplify-elements-textTertiary)',
          code: {
            background: 'var(--amplify-elements-code-background)',
            text: 'var(--amplify-elements-code-text)',
          },
          button: {
            primary: {
              background: 'var(--amplify-elements-button-primary-background)',
              backgroundHover: 'var(--amplify-elements-button-primary-backgroundHover)',
              text: 'var(--amplify-elements-button-primary-text)',
            },
            secondary: {
              background: 'var(--amplify-elements-button-secondary-background)',
              backgroundHover: 'var(--amplify-elements-button-secondary-backgroundHover)',
              text: 'var(--amplify-elements-button-secondary-text)',
            },
            danger: {
              background: 'var(--amplify-elements-button-danger-background)',
              backgroundHover: 'var(--amplify-elements-button-danger-backgroundHover)',
              text: 'var(--amplify-elements-button-danger-text)',
            },
          },
          item: {
            contentDefault: 'var(--amplify-elements-item-contentDefault)',
            contentActive: 'var(--amplify-elements-item-contentActive)',
            contentAccent: 'var(--amplify-elements-item-contentAccent)',
            contentDanger: 'var(--amplify-elements-item-contentDanger)',
            backgroundDefault: 'var(--amplify-elements-item-backgroundDefault)',
            backgroundActive: 'var(--amplify-elements-item-backgroundActive)',
            backgroundAccent: 'var(--amplify-elements-item-backgroundAccent)',
            backgroundDanger: 'var(--amplify-elements-item-backgroundDanger)',
          },
          actions: {
            background: 'var(--amplify-elements-actions-background)',
            code: {
              background: 'var(--amplify-elements-actions-code-background)',
            },
          },
          artifacts: {
            background: 'var(--amplify-elements-artifacts-background)',
            backgroundHover: 'var(--amplify-elements-artifacts-backgroundHover)',
            borderColor: 'var(--amplify-elements-artifacts-borderColor)',
            inlineCode: {
              background: 'var(--amplify-elements-artifacts-inlineCode-background)',
              text: 'var(--amplify-elements-artifacts-inlineCode-text)',
            },
          },
          messages: {
            background: 'var(--amplify-elements-messages-background)',
            linkColor: 'var(--amplify-elements-messages-linkColor)',
            code: {
              background: 'var(--amplify-elements-messages-code-background)',
            },
            inlineCode: {
              background: 'var(--amplify-elements-messages-inlineCode-background)',
              text: 'var(--amplify-elements-messages-inlineCode-text)',
            },
          },
          icon: {
            success: 'var(--amplify-elements-icon-success)',
            error: 'var(--amplify-elements-icon-error)',
            primary: 'var(--amplify-elements-icon-primary)',
            secondary: 'var(--amplify-elements-icon-secondary)',
            tertiary: 'var(--amplify-elements-icon-tertiary)',
          },
          preview: {
            addressBar: {
              background: 'var(--amplify-elements-preview-addressBar-background)',
              backgroundHover: 'var(--amplify-elements-preview-addressBar-backgroundHover)',
              backgroundActive: 'var(--amplify-elements-preview-addressBar-backgroundActive)',
              text: 'var(--amplify-elements-preview-addressBar-text)',
              textActive: 'var(--amplify-elements-preview-addressBar-textActive)',
            },
          },
          terminals: {
            background: 'var(--amplify-elements-terminals-background)',
            buttonBackground: 'var(--amplify-elements-terminals-buttonBackground)',
          },
          dividerColor: 'var(--amplify-elements-dividerColor)',
          /*
           * Focus / accent token — registers `bg-amplify-elements-focus`,
           * `text-amplify-elements-focus`, `ring-amplify-elements-focus`
           * with UnoCSS so the classes actually generate CSS. Previously
           * these classes were used in APIKeyPopup / ModelSelector / etc.
           * but the token wasn't registered here OR in variables.scss,
           * so the classes silently produced no styles and buttons
           * rendered with no background.
           */
          focus: 'var(--amplify-elements-focus)',
          focusHover: 'var(--amplify-elements-focus-hover)',
          focusForeground: 'var(--amplify-elements-focus-foreground)',
          loader: {
            background: 'var(--amplify-elements-loader-background)',
            progress: 'var(--amplify-elements-loader-progress)',
          },
          prompt: {
            background: 'var(--amplify-elements-prompt-background)',
          },
          sidebar: {
            dropdownShadow: 'var(--amplify-elements-sidebar-dropdownShadow)',
            buttonBackgroundDefault: 'var(--amplify-elements-sidebar-buttonBackgroundDefault)',
            buttonBackgroundHover: 'var(--amplify-elements-sidebar-buttonBackgroundHover)',
            buttonText: 'var(--amplify-elements-sidebar-buttonText)',
          },
          cta: {
            background: 'var(--amplify-elements-cta-background)',
            text: 'var(--amplify-elements-cta-text)',
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
