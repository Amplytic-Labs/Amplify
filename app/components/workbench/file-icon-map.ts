/**
 * Comprehensive mapping from file extensions or specific filenames to vscode-icons classes.
 * These classes are written as full literals so UnoCSS presetIcons detects them.
 */

const SPECIAL_FILES: Record<string, string> = {
  'package.json': 'i-vscode-icons:file-type-package',
  'tsconfig.json': 'i-vscode-icons:file-type-tsconfig',
  'jsconfig.json': 'i-vscode-icons:file-type-jsconfig',
  'vite.config.ts': 'i-vscode-icons:file-type-vite',
  'vite.config.js': 'i-vscode-icons:file-type-vite',
  'uno.config.ts': 'i-vscode-icons:file-type-unocss',
  Dockerfile: 'i-vscode-icons:file-type-docker',
  'docker-compose.yml': 'i-vscode-icons:file-type-docker',
  'docker-compose.yaml': 'i-vscode-icons:file-type-docker',
  '.gitignore': 'i-vscode-icons:file-type-git',
  '.env': 'i-vscode-icons:file-type-dotenv',
  'README.md': 'i-vscode-icons:file-type-markdown',
  LICENSE: 'i-vscode-icons:file-type-license',
  'pnpm-lock.yaml': 'i-vscode-icons:file-type-pnpm',
  'package-lock.json': 'i-vscode-icons:file-type-npm',
  'yarn.lock': 'i-vscode-icons:file-type-yarn',
  '.prettierrc': 'i-vscode-icons:file-type-prettier',
  'eslint.config.js': 'i-vscode-icons:file-type-eslint',
  'eslint.config.mjs': 'i-vscode-icons:file-type-eslint',
  'eslint.config.ts': 'i-vscode-icons:file-type-eslint',
};

const EXTENSION_MAP: Record<string, string> = {
  // TypeScript / JavaScript
  ts: 'i-vscode-icons:file-type-typescript',
  tsx: 'i-vscode-icons:file-type-typescript',
  js: 'i-vscode-icons:file-type-js',
  jsx: 'i-vscode-icons:file-type-reactjs',
  mjs: 'i-vscode-icons:file-type-js',
  cjs: 'i-vscode-icons:file-type-js',
  json: 'i-vscode-icons:file-type-json',
  json5: 'i-vscode-icons:file-type-json5',
  jsonc: 'i-vscode-icons:file-type-json',

  // Web
  html: 'i-vscode-icons:file-type-html',
  css: 'i-vscode-icons:file-type-css',
  scss: 'i-vscode-icons:file-type-scss',
  sass: 'i-vscode-icons:file-type-sass',
  less: 'i-vscode-icons:file-type-less',
  vue: 'i-vscode-icons:file-type-vue',
  svelte: 'i-vscode-icons:file-type-svelte',
  astro: 'i-vscode-icons:file-type-astro',

  // Backend / Languages
  py: 'i-vscode-icons:file-type-python',
  go: 'i-vscode-icons:file-type-go',
  rs: 'i-vscode-icons:file-type-rust',
  java: 'i-vscode-icons:file-type-java',
  c: 'i-vscode-icons:file-type-c',
  cpp: 'i-vscode-icons:file-type-cpp',
  cc: 'i-vscode-icons:file-type-cpp',
  cxx: 'i-vscode-icons:file-type-cpp',
  cs: 'i-vscode-icons:file-type-csharp',
  rb: 'i-vscode-icons:file-type-ruby',
  php: 'i-vscode-icons:file-type-php',
  swift: 'i-vscode-icons:file-type-swift',
  dart: 'i-vscode-icons:file-type-dartlang',
  kt: 'i-vscode-icons:file-type-kotlin',
  kts: 'i-vscode-icons:file-type-kotlin',
  scala: 'i-vscode-icons:file-type-scala',
  lua: 'i-vscode-icons:file-type-lua',
  r: 'i-vscode-icons:file-type-r',
  zig: 'i-vscode-icons:file-type-zig',
  nim: 'i-vscode-icons:file-type-nim',
  ex: 'i-vscode-icons:file-type-elixir',
  exs: 'i-vscode-icons:file-type-elixir',
  hs: 'i-vscode-icons:file-type-haskell',
  clj: 'i-vscode-icons:file-type-clojure',
  cljs: 'i-vscode-icons:file-type-clojurescript',
  el: 'i-vscode-icons:file-type-emacs',
  fs: 'i-vscode-icons:file-type-fsharp',
  fsx: 'i-vscode-icons:file-type-fsharp',

  // Config / Data
  toml: 'i-vscode-icons:file-type-toml',
  yaml: 'i-vscode-icons:file-type-yaml',
  yml: 'i-vscode-icons:file-type-yaml',
  xml: 'i-vscode-icons:file-type-xml',
  sql: 'i-vscode-icons:file-type-sql',
  sqlite: 'i-vscode-icons:file-type-sqlite',
  db: 'i-vscode-icons:file-type-sqlite',
  graphql: 'i-vscode-icons:file-type-graphql',
  gql: 'i-vscode-icons:file-type-graphql',
  proto: 'i-vscode-icons:file-type-protobuf',
  protobuf: 'i-vscode-icons:file-type-protobuf',

  // Docs / Text
  md: 'i-vscode-icons:file-type-markdown',
  mdx: 'i-vscode-icons:file-type-mdx',
  txt: 'i-vscode-icons:file-type-text',
  pdf: 'i-vscode-icons:file-type-pdf2',
  docx: 'i-vscode-icons:file-type-word2',
  xlsx: 'i-vscode-icons:file-type-excel',
  pptx: 'i-vscode-icons:file-type-powerpoint',

  // Media / Images
  svg: 'i-vscode-icons:file-type-svg',
  png: 'i-vscode-icons:file-type-image',
  jpg: 'i-vscode-icons:file-type-image',
  jpeg: 'i-vscode-icons:file-type-image',
  gif: 'i-vscode-icons:file-type-image',
  webp: 'i-vscode-icons:file-type-image',
  ico: 'i-vscode-icons:file-type-image',
  bmp: 'i-vscode-icons:file-type-image',

  // Archives / Binary
  zip: 'i-vscode-icons:file-type-zip',
  tar: 'i-vscode-icons:file-type-binary',
  gz: 'i-vscode-icons:file-type-binary',
  tgz: 'i-vscode-icons:file-type-binary',
  rar: 'i-vscode-icons:file-type-binary',
  '7z': 'i-vscode-icons:file-type-binary',
  wasm: 'i-vscode-icons:file-type-wasm',
  bin: 'i-vscode-icons:file-type-binary',

  // Shells
  sh: 'i-vscode-icons:file-type-shell',
  bash: 'i-vscode-icons:file-type-shell',
  zsh: 'i-vscode-icons:file-type-shell',
  fish: 'i-vscode-icons:file-type-shell',
  ps1: 'i-vscode-icons:file-type-powershell',
  psm1: 'i-vscode-icons:file-type-powershell2',

  // Ecosystem
  vite: 'i-vscode-icons:file-type-vite',
  vitest: 'i-vscode-icons:file-type-vitest',
  eslint: 'i-vscode-icons:file-type-eslint',
  prettier: 'i-vscode-icons:file-type-prettier',
  tailwind: 'i-vscode-icons:file-type-tailwind',
  unocss: 'i-vscode-icons:file-type-unocss',
  postcss: 'i-vscode-icons:file-type-postcss',
  jest: 'i-vscode-icons:file-type-jest',
  mocha: 'i-vscode-icons:file-type-mocha',
  cypress: 'i-vscode-icons:file-type-cypress',
  playwright: 'i-vscode-icons:file-type-playwright',
  storybook: 'i-vscode-icons:file-type-storybook',
  prisma: 'i-vscode-icons:file-type-prisma',
  terraform: 'i-vscode-icons:file-type-terraform',
  tf: 'i-vscode-icons:file-type-terraform',
  ansible: 'i-vscode-icons:file-type-ansible',
  helm: 'i-vscode-icons:file-type-helm',
};

/**
 * Maps a filename to a vscode-icons class based on extension or exact match.
 * Falls back to a generic file icon if no match is found.
 */
export function getFileTypeIconClass(fileName: string): string {
  // 1. Check for exact matches (special files)
  if (SPECIAL_FILES[fileName]) {
    return SPECIAL_FILES[fileName];
  }

  // 2. Check for extension match
  const dotIdx = fileName.lastIndexOf('.');

  if (dotIdx > 0) {
    const ext = fileName.slice(dotIdx + 1).toLowerCase();

    if (EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext];
    }
  }

  // 3. Fallbacks
  return fileName.includes('.') ? 'i-vscode-icons:file' : 'i-vscode-icons:default-file';
}
