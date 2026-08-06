// Local no-op PostCSS config so Vite does NOT walk up the directory tree
// and pick up the parent Next.js project's postcss.config.mjs (which uses
// a plugin shape Vite rejects). Open-Claude uses UnoCSS, not PostCSS.
export default { plugins: [] };
