import type { FlowVerificationResult, FlowIssue } from './types';

// ─── Internal types ───────────────────────────────────────────────────────────

interface Route {
  path: string;
  filePath: string;
  isIndex: boolean;
}

interface NavLink {
  href: string;
  filePath: string;
  line: number;
  method: 'link' | 'anchor' | 'programmatic' | 'form';
}

interface ButtonCandidate {
  /** The full match of the opening tag or attribute */
  raw: string;
  /** The text content inside the button (best-effort extraction) */
  text: string;
  /** File where the button was found */
  filePath: string;
  /** 1-based line number */
  line: number;
  /** Whether an onClick/handler was found on this element */
  hasHandler: boolean;
  /** Whether the handler appears to be a stub (empty body) */
  isStub: boolean;
  /** The handler expression, if found */
  handlerExpr?: string;
}

type Framework = 'next' | 'react' | 'vue' | 'svelte' | 'vanilla';

// ─── Regex patterns ───────────────────────────────────────────────────────────

// Button elements: <button ...>
const BUTTON_TAG_RE = /<button\b[^>]*>/gi;

// Self-closing or void interactive elements that should have handlers:
// <button>, <input type="submit">, <input type="button">
const INTERACTIVE_INPUT_RE = /<input\b[^>]*type\s*=\s*["']?(submit|button)["']?[^>]*>/gi;

// onClick / onSubmit / onChange handlers on any element
const ON_HANDLER_RE = /\bon(?:Click|Submit|Change)\s*=\s*[{(]/gi;

// Specific handler patterns
const ONCLICK_RE = /\bonClick\s*=\s*[{(]\s*([^})]+)\s*[})]/gi;

// Stub / no-op functions
const STUB_FN_RE = /\b(?:const|let|var)\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*\{?\s*\}?\s*;?\s*$/gm;

// href attributes
const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;

// Programmatic navigation: router.push(), navigate(), redirect()
const PUSH_RE = /(?:(?:router|useRouter)\.\s*push|navigate|redirect)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

// window.location / window.location.href assignments
const WINDOW_LOC_RE = /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi;

// <Link href="..."> (React Router, Next.js)
const LINK_COMPONENT_RE = /<Link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

// <a href="..."> with or without Link
const ANCHOR_RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

// <form onSubmit=...>
const FORM_ONSUBMIT_RE = /<form\b[^>]*onSubmit\s*=\s*[{(]/gi;

// Route file patterns for Next.js App Router
const NEXT_PAGE_RE = /^(?:app|src\/app)\/(.+)\/page\.(?:tsx?|jsx?)$/;
const NEXT_LAYOUT_RE = /^(?:app|src\/app)\/(.+)\/layout\.(?:tsx?|jsx?)$/;
const NEXT_ROUTE_RE = /^(?:app|src\/app)\/(.+)\/route\.(?:tsx?|jsx?)$/;

// Route file patterns for Pages Router / React Router (lazy detection)
const ROUTE_DEF_RE = /(?:path|Route)\s*[=:]\s*["']([^"']+)["']/g;

// Form action attribute
const FORM_ACTION_RE = /<form\b[^>]*action\s*=\s*["']([^"']+)["']/gi;

/**
 * FlowVerifier — Verifies two critical invariants:
 *
 * 1. **Every Button Does Something** — scans for interactive elements without
 *    handlers or with stub/empty handlers.
 *
 * 2. **Every Screen is Connected** — builds a navigation graph from the file
 *    structure and checks that every route is reachable via links, navigation
 *    calls, or form submissions.
 *
 * Uses pure regex — no AST parser dependency.
 */
export class FlowVerifier {
  /**
   * Detect the framework from file structure heuristics.
   */
  detectFramework(files: Record<string, { content: string }>): Framework {
    const fileNames = Object.keys(files);

    if (fileNames.some((f) => /^app\/page\.(tsx?|jsx?)$/.test(f)) || fileNames.some((f) => NEXT_PAGE_RE.test(f))) {
      return 'next';
    }
    if (fileNames.some((f) => /App\.vue$/.test(f))) {
      return 'vue';
    }
    if (fileNames.some((f) => /\.svelte$/.test(f))) {
      return 'svelte';
    }
    if (fileNames.some((f) => /package\.json$/.test(f))) {
      const pkg = files['package.json'];
      if (pkg) {
        const content = pkg.content;
        if (content.includes('"react"') || content.includes('"react-dom"')) {
          return 'react';
        }
      }
    }
    return 'vanilla';
  }

  /**
   * Run all flow verifications.
   *
   * @param modifiedFiles - Files that were changed (used to focus button checks)
   * @param allFiles - All files in the project
   * @param framework - Override framework detection (auto-detected if omitted)
   */
  async verify(
    modifiedFiles: string[],
    allFiles: Record<string, { content: string }>,
    framework?: Framework,
  ): Promise<FlowVerificationResult> {
    const resolvedFramework = framework ?? this.detectFramework(allFiles);

    // Filter to only TSX/JSX/Vue/Svelte files for analysis
    const componentFiles: Record<string, { content: string }> = {};
    for (const [path, file] of Object.entries(allFiles)) {
      if (/\.(tsx?|jsx?|vue|svelte)$/.test(path)) {
        componentFiles[path] = file;
      }
    }

    // Run both checks
    const buttonIssues = this.verifyButtonActions(componentFiles, modifiedFiles);
    const screenIssues = this.verifyScreenConnectivity(allFiles, resolvedFramework);

    const allIssues = [...buttonIssues, ...screenIssues];
    const hasErrors = allIssues.some((i) => i.severity === 'error');

    // Gather stats
    const buttons = this.collectAllButtons(componentFiles);
    const routes = this.extractRoutes(allFiles, resolvedFramework);
    const { links } = this.extractNavigationLinks(componentFiles);

    const reachableSet = this.computeReachableRoutes(routes, links, componentFiles);

    return {
      passed: !hasErrors,
      issues: allIssues,
      buttonsChecked: buttons.length,
      buttonsWithActions: buttons.filter((b) => b.hasHandler && !b.isStub).length,
      screensChecked: routes.length,
      screensReachable: reachableSet.size,
    };
  }

  // ─── Check 1: Every Button Does Something ────────────────────────────────

  /**
   * Verify that every interactive element has a meaningful handler.
   */
  private verifyButtonActions(
    files: Record<string, { content: string }>,
    modifiedFiles: string[],
  ): FlowIssue[] {
    const issues: FlowIssue[] = [];

    // If modifiedFiles is specified, only check those; otherwise check all
    const targetFiles =
      modifiedFiles.length > 0
        ? Object.fromEntries(
            Object.entries(files).filter(([path]) =>
              modifiedFiles.some((mod) => path.endsWith(mod) || mod.endsWith(path)),
            ),
          )
        : files;

    for (const [filePath, file] of Object.entries(targetFiles)) {
      const content = file.content;
      const lines = content.split('\n');

      // Find all <button> tags
      const buttons = this.findButtonsInFile(content, filePath, lines);

      for (const btn of buttons) {
        if (!btn.hasHandler) {
          // Check if it's inside a <form> with onSubmit (buttons in forms submit by default)
          const isInsideFormWithSubmit = this.isInsideFormWithSubmit(content, btn.line, lines);
          if (isInsideFormWithSubmit) continue;

          // Check if it's a disabled button
          if (/\bdisabled\b/i.test(btn.raw)) continue;

          // Check if it's type="button" without onClick — that's fine, but
          // type="submit" without a form handler is still an issue
          issues.push({
            message: `Button "${btn.text || '(no text)'}" has no onClick or form handler`,
            check: 'button-no-handler',
            filePath,
            line: btn.line,
            severity: 'warning',
            suggestion: 'Add an onClick handler or wrap in a <form> with onSubmit.',
          });
        } else if (btn.isStub) {
          issues.push({
            message: `Button "${btn.text || '(no text)'}" has a stub/empty handler: ${btn.handlerExpr ?? 'unknown'}`,
            check: 'button-stub-handler',
            filePath,
            line: btn.line,
            severity: 'warning',
            suggestion: 'The handler function appears to be empty. Implement the intended behavior.',
          });
        }
      }

      // Also check for <input type="submit"> / <input type="button"> without handlers
      const inputIssues = this.checkInteractiveInputs(content, filePath, lines);
      issues.push(...inputIssues);
    }

    return issues;
  }

  /**
   * Find all <button> elements and determine if they have handlers.
   */
  private findButtonsInFile(
    content: string,
    filePath: string,
    lines: string[],
  ): ButtonCandidate[] {
    const buttons: ButtonCandidate[] = [];
    BUTTON_TAG_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = BUTTON_TAG_RE.exec(content)) !== null) {
      const tagContent = match[0];
      const startIndex = match.index;

      // Determine the line number
      const lineNum = content.slice(0, startIndex).split('\n').length;

      // Check for onClick / other handlers
      const hasHandler = ON_HANDLER_RE.test(tagContent);
      ON_HANDLER_RE.lastIndex = 0;

      // Try to extract the handler expression
      let handlerExpr: string | undefined;
      let isStub = false;

      if (hasHandler) {
        const handlerMatch = ONCLICK_RE.exec(tagContent);
        ONCLICK_RE.lastIndex = 0;

        if (handlerMatch) {
          handlerExpr = handlerMatch[1].trim();
          // Check if the handler is a stub
          isStub = this.isStubExpression(handlerExpr);
        }
      }

      // Try to extract button text (first child text node)
      const text = this.extractButtonText(content, startIndex + tagContent.length);

      buttons.push({
        raw: tagContent,
        text,
        filePath,
        line: lineNum,
        hasHandler,
        isStub,
        handlerExpr,
      });
    }

    return buttons;
  }

  /**
   * Extract the text content of a button by looking past the opening tag.
   */
  private extractButtonText(content: string, afterTagIndex: number): string {
    // Look ahead up to 100 chars for text content
    const snippet = content.slice(afterTagIndex, afterTagIndex + 100);

    // Remove leading whitespace and any child tags
    const textMatch = snippet.match(/^\s*([^<\s][^<]{0,40})/);
    return textMatch ? textMatch[1].trim() : '';
  }

  /**
   * Check if a handler expression is a stub / no-op.
   */
  private isStubExpression(expr: string): boolean {
    // () => {}, () => undefined, () => null, () => { return; }
    const stubPatterns = [
      /^\s*\(\s*\)\s*=>\s*\{\s*\}\s*$/, // () => {}
      /^\s*\(\s*\)\s*=>\s*undefined\s*$/, // () => undefined
      /^\s*\(\s*\)\s*=>\s*null\s*$/, // () => null
      /^\s*\(\s*\)\s*=>\s*\{?\s*return\s*;?\s*}?\s*$/, // () => { return; }
      /^\s*\(\s*\)\s*=>\s*void\s+/i, // () => void ...
      /^\s*console\.\w+\s*\(/i, // () => console.log(...)
      /^\s*noop\b/i, // () => noop()
    ];

    return stubPatterns.some((p) => p.test(expr));
  }

  /**
   * Check if a button at a given line is inside a <form> with onSubmit.
   */
  private isInsideFormWithSubmit(
    content: string,
    buttonLine: number,
    lines: string[],
  ): boolean {
    // Walk backwards from button line to find an opening <form tag
    for (let i = buttonLine - 1; i >= Math.max(0, buttonLine - 50); i--) {
      const line = lines[i] ?? '';

      if (/<form\b/i.test(line)) {
        // Found a form — check if it has onSubmit
        if (FORM_ONSUBMIT_RE.test(line)) return true;
        FORM_ONSUBMIT_RE.lastIndex = 0;

        // Also check the next few lines for onSubmit (multi-line form tag)
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
          if (FORM_ONSUBMIT_RE.test(lines[j] ?? '')) {
            FORM_ONSUBMIT_RE.lastIndex = 0;
            return true;
          }
          FORM_ONSUBMIT_RE.lastIndex = 0;
        }

        // If the form has an action attribute, that counts as a handler
        if (FORM_ACTION_RE.test(line)) return true;
        FORM_ACTION_RE.lastIndex = 0;

        // Found a form but no onSubmit — button will trigger default submit
        // This is OK for submit buttons, not great for type="button"
        return true;
      }

      // If we hit a closing </form> before finding an opening <form>, stop
      if (/<\/form>/i.test(line)) break;
    }

    return false;
  }

  /**
   * Check for interactive <input> elements without handlers.
   */
  private checkInteractiveInputs(
    content: string,
    filePath: string,
    lines: string[],
  ): FlowIssue[] {
    const issues: FlowIssue[] = [];
    INTERACTIVE_INPUT_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = INTERACTIVE_INPUT_RE.exec(content)) !== null) {
      const tag = match[0];
      const lineNum = content.slice(0, match.index).split('\n').length;

      // If it has an onClick, it's handled
      if (ON_HANDLER_RE.test(tag)) {
        ON_HANDLER_RE.lastIndex = 0;
        continue;
      }
      ON_HANDLER_RE.lastIndex = 0;

      // Disabled inputs are fine
      if (/\bdisabled\b/i.test(tag)) continue;

      // type="submit" inside a form is OK
      if (/type\s*=\s*["']?submit/i.test(tag) && this.isInsideFormWithSubmit(content, lineNum, lines)) {
        continue;
      }

      issues.push({
        message: `Interactive input element has no click handler`,
        check: 'button-no-handler',
        filePath,
        line: lineNum,
        severity: 'info',
      });
    }

    return issues;
  }

  /**
   * Collect all button candidates for stats (without generating issues).
   */
  private collectAllButtons(files: Record<string, { content: string }>): ButtonCandidate[] {
    const all: ButtonCandidate[] = [];

    for (const [filePath, file] of Object.entries(files)) {
      const lines = file.content.split('\n');
      const buttons = this.findButtonsInFile(file.content, filePath, lines);
      all.push(...buttons);
    }

    return all;
  }

  // ─── Check 2: Every Screen is Connected ──────────────────────────────────

  /**
   * Verify that every route/screen is reachable.
   */
  private verifyScreenConnectivity(
    files: Record<string, { content: string }>,
    framework: Framework,
  ): FlowIssue[] {
    const issues: FlowIssue[] = [];

    const routes = this.extractRoutes(files, framework);
    const { links } = this.extractNavigationLinks(files);

    if (routes.length === 0) {
      return issues; // No routes found — nothing to check
    }

    const reachableSet = this.computeReachableRoutes(routes, links, files);

    // Check each route for reachability
    for (const route of routes) {
      if (route.isIndex) continue; // Index/root is always reachable

      if (!reachableSet.has(route.path)) {
        issues.push({
          message: `Screen "${route.path}" (${route.filePath}) is not reachable from any other screen`,
          check: 'screen-unreachable',
          filePath: route.filePath,
          severity: 'warning',
          suggestion: 'Add a <Link>, <a href>, or programmatic navigation to this route.',
        });
      }
    }

    // Check that all link targets actually exist
    const routePaths = new Set(routes.map((r) => r.path));
    for (const link of links) {
      // Skip external links, anchor links, and dynamic routes
      if (
        link.href.startsWith('http') ||
        link.href.startsWith('#') ||
        link.href.startsWith('mailto:') ||
        link.href.startsWith('tel:') ||
        link.href.includes('[') // e.g., /users/[id]
      ) {
        continue;
      }

      // Normalize: remove trailing slash for comparison
      const normalized = link.href.replace(/\/$/, '') || '/';

      // Check if the target route exists
      if (!routePaths.has(normalized) && !routePaths.has(`/${normalized}`)) {
        // Could be a relative path — try resolving it
        const isFileLink = this.looksLikeFilePath(link.href, files);
        if (!isFileLink) {
          issues.push({
            message: `Link to "${link.href}" does not match any known route`,
            check: 'link-target-missing',
            filePath: link.filePath,
            line: link.line,
            severity: 'info',
            suggestion: `Verify that route "${link.href}" exists.`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Extract routes from the project structure.
   */
  private extractRoutes(files: Record<string, { content: string }>, framework: Framework): Route[] {
    const routes: Route[] = [];
    const fileNames = Object.keys(files);

    switch (framework) {
      case 'next':
        this.extractNextRoutes(fileNames, files, routes);
        break;
      case 'react':
        this.extractReactRouterRoutes(files, routes);
        break;
      default:
        this.extractGenericRoutes(fileNames, routes);
    }

    return routes;
  }

  /**
   * Extract routes from Next.js App Router file structure.
   */
  private extractNextRoutes(
    fileNames: string[],
    _files: Record<string, { content: string }>,
    routes: Route[],
  ): void {
    for (const filePath of fileNames) {
      let m: RegExpExecArray | null;

      // page.tsx → route
      m = NEXT_PAGE_RE.exec(filePath);
      if (m) {
        const routePath = m[1] ? `/${m[1].replace(/\/page$/, '')}` : '/';
        routes.push({
          path: routePath === '' ? '/' : routePath,
          filePath,
          isIndex: routePath === '/' || /\/?$/.test(routePath),
        });
        NEXT_PAGE_RE.lastIndex = 0;
        continue;
      }
      NEXT_PAGE_RE.lastIndex = 0;

      // layout.tsx → not a direct route, but part of the tree
      m = NEXT_LAYOUT_RE.exec(filePath);
      if (m) {
        // Layouts wrap routes — we note them but don't treat them as screens
        NEXT_LAYOUT_RE.lastIndex = 0;
        continue;
      }
      NEXT_LAYOUT_RE.lastIndex = 0;

      // route.ts → API route
      m = NEXT_ROUTE_RE.exec(filePath);
      if (m) {
        const routePath = m[1] ? `/${m[1].replace(/\/route$/, '')}` : '/';
        routes.push({
          path: routePath === '' ? '/' : routePath,
          filePath,
          isIndex: false,
        });
        NEXT_ROUTE_RE.lastIndex = 0;
        continue;
      }
      NEXT_ROUTE_RE.lastIndex = 0;
    }
  }

  /**
   * Extract routes from React Router configuration (heuristic).
   */
  private extractReactRouterRoutes(files: Record<string, { content: string }>, routes: Route[]): void {
    // Look for route definitions in common locations
    for (const [filePath, file] of Object.entries(files)) {
      if (
        !filePath.includes('route') &&
        !filePath.includes('App.') &&
        !filePath.includes('router') &&
        !filePath.includes('Router')
      ) {
        continue;
      }

      const content = file.content;
      ROUTE_DEF_RE.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = ROUTE_DEF_RE.exec(content)) !== null) {
        const path = match[1];
        routes.push({
          path: path.startsWith('/') ? path : `/${path}`,
          filePath,
          isIndex: path === '/' || path === '/index',
        });
      }
      ROUTE_DEF_RE.lastIndex = 0;
    }
  }

  /**
   * Generic route extraction for Vue / Svelte / Vanilla.
   */
  private extractGenericRoutes(fileNames: string[], routes: Route[]): void {
    for (const filePath of fileNames) {
      // Vue: src/views/*.vue, src/pages/*.vue
      const vueMatch = filePath.match(/(?:views|pages)\/(.+)\.vue$/);
      if (vueMatch) {
        const name = vueMatch[1];
        const path = `/${name.replace(/index$/, '').replace(/\.[^.]+$/, '')}`;
        routes.push({
          path: path === '' ? '/' : path,
          filePath,
          isIndex: name === 'index',
        });
        continue;
      }

      // Svelte: src/routes/**/*.svelte
      const svelteMatch = filePath.match(/routes\/(.+)\.svelte$/);
      if (svelteMatch) {
        const segments = svelteMatch[1];
        // SvelteKit uses [param] for dynamic routes
        const path = `/${segments.replace(/\+page$/, '').replace(/index$/, '')}`;
        routes.push({
          path: path === '' ? '/' : path,
          filePath,
          isIndex: segments === 'index' || segments === '+page',
        });
        continue;
      }
    }
  }

  /**
   * Extract all links and navigation calls from component files.
   */
  private extractNavigationLinks(
    files: Record<string, { content: string }>,
  ): { links: NavLink[] } {
    const links: NavLink[] = [];

    for (const [filePath, file] of Object.entries(files)) {
      const content = file.content;
      const lines = content.split('\n');

      // <Link href="...">
      LINK_COMPONENT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = LINK_COMPONENT_RE.exec(content)) !== null) {
        const href = match[1];
        const lineNum = content.slice(0, match.index).split('\n').length;
        links.push({ href, filePath, line: lineNum, method: 'link' });
      }
      LINK_COMPONENT_RE.lastIndex = 0;

      // <a href="..."> (but not <Link href — already captured)
      ANCHOR_RE.lastIndex = 0;
      while ((match = ANCHOR_RE.exec(content)) !== null) {
        const tag = match[0];
        // Skip if it's actually a <Link> component
        if (/<Link\b/i.test(tag)) continue;

        const href = match[1];
        const lineNum = content.slice(0, match.index).split('\n').length;
        links.push({ href, filePath, line: lineNum, method: 'anchor' });
      }
      ANCHOR_RE.lastIndex = 0;

      // Programmatic navigation: router.push(), navigate(), redirect()
      PUSH_RE.lastIndex = 0;
      while ((match = PUSH_RE.exec(content)) !== null) {
        const href = match[1];
        const lineNum = content.slice(0, match.index).split('\n').length;
        links.push({ href, filePath, line: lineNum, method: 'programmatic' });
      }
      PUSH_RE.lastIndex = 0;

      // window.location
      WINDOW_LOC_RE.lastIndex = 0;
      while ((match = WINDOW_LOC_RE.exec(content)) !== null) {
        const href = match[1];
        const lineNum = content.slice(0, match.index).split('\n').length;
        links.push({ href, filePath, line: lineNum, method: 'programmatic' });
      }
      WINDOW_LOC_RE.lastIndex = 0;

      // Form action attributes
      FORM_ACTION_RE.lastIndex = 0;
      while ((match = FORM_ACTION_RE.exec(content)) !== null) {
        const href = match[1];
        const lineNum = content.slice(0, match.index).split('\n').length;
        links.push({ href, filePath, line: lineNum, method: 'form' });
      }
      FORM_ACTION_RE.lastIndex = 0;
    }

    return { links };
  }

  /**
   * Compute which routes are reachable from the navigation links.
   */
  private computeReachableRoutes(
    routes: Route[],
    links: NavLink[],
    files: Record<string, { content: string }>,
  ): Set<string> {
    const reachable = new Set<string>();
    const routePaths = new Set(routes.map((r) => r.path));

    // Index/root is always reachable
    for (const route of routes) {
      if (route.isIndex || route.path === '/') {
        reachable.add(route.path);
      }
    }

    // Join all code for programmatic reachability check
    const allCode = Object.values(files)
      .map((f) => f.content)
      .join('\n');

    // Check each link to see if it matches a known route
    for (const link of links) {
      // Skip external, anchor, and dynamic links
      if (
        link.href.startsWith('http') ||
        link.href.startsWith('#') ||
        link.href.startsWith('mailto:') ||
        link.href.startsWith('tel:')
      ) {
        continue;
      }

      // Try to match against known routes
      const normalized = link.href.replace(/\/$/, '') || '/';

      for (const routePath of routePaths) {
        if (this.pathMatches(normalized, routePath)) {
          reachable.add(routePath);
          break;
        }
      }
    }

    // Check for programmatic navigation to each route
    for (const route of routes) {
      if (reachable.has(route.path)) continue;

      if (this.isConditionallyReachable(route, allCode)) {
        reachable.add(route.path);
      }
    }

    return reachable;
  }

  /**
   * Check if a navigation href matches a route path.
   * Handles trailing slashes and relative paths.
   */
  private pathMatches(href: string, routePath: string): boolean {
    const a = href.replace(/\/$/, '') || '/';
    const b = routePath.replace(/\/$/, '') || '/';

    if (a === b) return true;
    if (a === `/${b}`) return true;

    // Check if the href is a prefix of the route (for nested routes)
    if (b.startsWith(a + '/')) return true;
    if (a.startsWith(b + '/')) return true;

    return false;
  }

  /**
   * Check if a route is reachable via programmatic navigation.
   */
  private isConditionallyReachable(route: Route, allCode: string): boolean {
    const path = route.path;

    // Look for the route path (or parts of it) in navigation calls
    // Build a pattern that matches the route path in push/navigate/redirect calls
    const pathParts = path.split('/').filter(Boolean);

    // For simple paths like "/dashboard", check for direct navigation
    if (pathParts.length <= 2) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:push|navigate|redirect)\\s*\\(\\s*["'\`]?${escaped}`, 'i');
      if (re.test(allCode)) return true;
    }

    // For nested paths, check if any parent path is navigated to
    if (pathParts.length > 1) {
      const parentPath = `/${pathParts.slice(0, -1).join('/')}`;
      const parentEscaped = parentPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parentRe = new RegExp(`(?:push|navigate|redirect)\\s*\\(\\s*["'\`]?${parentEscaped}`, 'i');
      if (parentRe.test(allCode)) return true;
    }

    // Check for dynamic route patterns: if route is /users/[id], check for /users/ in navigation
    const dynamicRe = /\/\[[^\]]+\]/;
    if (dynamicRe.test(path)) {
      const basePath = path.replace(dynamicRe, '');
      if (basePath) {
        const escaped = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?:push|navigate|redirect)\\s*\\(\\s*["'\`]${escaped}`, 'i');
        if (re.test(allCode)) return true;
      }
    }

    return false;
  }

  /**
   * Check if a link href looks like a file path rather than a route.
   */
  private looksLikeFilePath(href: string, files: Record<string, { content: string }>): boolean {
    // If it has a file extension, it's likely a file link
    if (/\.\w{2,5}$/.test(href.split('/').pop() ?? '')) {
      return true;
    }

    // If it exactly matches a file in the project, it's a file link
    if (files[href] !== undefined) {
      return true;
    }

    return false;
  }
}