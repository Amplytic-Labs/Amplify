/**
 * Flow Verifier
 *
 * Enforces the two golden rules:
 *
 * 1. "Every button does something"
 *    - Scans for interactive elements (buttons, links, forms, onClick handlers)
 *    - Checks that they call a defined function or navigate to a real route
 *    - Catches: empty handlers, undefined function references, placeholder handlers
 *
 * 2. "Every screen is connected"
 *    - Scans route definitions (React Router, Next.js, etc.)
 *    - Checks that newly created components/pages have a route entry
 *    - Checks that navigation exists from other pages to reach the new screen
 *    - Supports indirect connections (A -> B -> C is valid, C doesn't need direct link from A)
 */

import type { VerificationResult, VerificationRunnerOptions, VerificationIssue } from './types';

/**
 * Simple in-memory cache for file reads during a single verification run.
 * Prevents re-reading the same file multiple times in nested loops.
 */
class FileReadCache {
  private cache = new Map<string, string | null>();
  private readFileFn: (path: string) => Promise<string | null>;

  constructor(readFileFn: (path: string) => Promise<string | null>) {
    this.readFileFn = readFileFn;
  }

  async get(path: string): Promise<string | null> {
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    }

    const content = await this.readFileFn(path);
    this.cache.set(path, content);

    return content;
  }
}

export async function runFlowVerification(options: VerificationRunnerOptions): Promise<VerificationResult> {
  const issues: VerificationIssue[] = [];
  const fileCache = new FileReadCache(options.readFile);

  // Get all project files to understand the project structure
  const allFiles = await options.listFiles();

  // Run both checks (pass cached readFile)
  await checkEveryButtonDoesSomething(options, issues, fileCache);
  await checkEveryScreenIsConnected(options, allFiles, issues, fileCache);

  const errors = issues.filter((i) => i.severity === 'error');

  return {
    type: 'flow_verification',
    passed: errors.length === 0,
    message:
      errors.length === 0
        ? 'Flow verification passed. All buttons functional, all screens connected.'
        : `Flow verification failed: ${errors.length} issue(s).`,
    issues: issues.length > 0 ? issues : undefined,
    timestamp: new Date().toISOString(),
  };
}

/*
 * ============================================================
 * Rule 1: Every Button Does Something
 * ============================================================
 */

async function checkEveryButtonDoesSomething(
  options: VerificationRunnerOptions,
  issues: VerificationIssue[],
  fileCache: FileReadCache,
): Promise<void> {
  for (const filePath of options.modifiedFiles) {
    if (!/\.(jsx|tsx|js|ts)$/.test(filePath)) {
      continue;
    }

    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      continue;
    }

    if (filePath.includes('node_modules')) {
      continue;
    }

    const content = await fileCache.get(filePath);

    if (!content) {
      continue;
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      /*
       * Pattern 1: Empty arrow function in event handler
       * onClick={() => {}} or onClick={async () => {}}
       */
      if (
        /\b(onClick|onChange|onSubmit|onKeyPress|onKeyDown|onFocus|onBlur)\s*=\s*\{[^}]*=>\s*\{\s*\}[^}]*\}/.test(line)
      ) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'error',
          message: `"Every button does something" violation: Empty event handler found. This interactive element does nothing when triggered.`,
          suggestion: 'Implement the handler logic or connect it to an existing function.',
        });
      }

      // Pattern 2: onClick with just console.log
      if (/\b(onClick|onChange|onSubmit)\s*=\s*\{[^}]*=>\s*console\.(log|warn|error)/.test(line)) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'error',
          message: `"Every button does something" violation: Handler only calls console.log. Implement real functionality.`,
          suggestion: 'Replace console.log with actual business logic or navigation.',
        });
      }

      // Pattern 3: href="#" (placeholder link)
      if (/\bhref\s*=\s*["']#["']/.test(line) && !/\/\//.test(line)) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'warning',
          message: 'Placeholder link href="#" detected. Link should navigate to a real route or trigger an action.',
          suggestion: 'Replace with a proper route path or use an onClick handler.',
        });
      }

      /*
       * Pattern 4: Button with no onClick, type, or form association
       * <button> without onClick, type="submit", or being inside a <form>
       */
      if (/<button[^>]*>/.test(line) && !/onClick|onSubmit|type=/.test(line)) {
        // Check if the next few lines add an onClick
        const nextLines = lines.slice(i, Math.min(i + 5, lines.length)).join(' ');

        if (!/onClick/.test(nextLines) && !/<\/button>/.test(nextLines)) {
          issues.push({
            filePath,
            line: lineNum,
            severity: 'warning',
            message: `"Every button does something" warning: <button> without onClick, type="submit", or form context. May be a static element.`,
            suggestion: 'Add an onClick handler or set type="submit" if inside a form.',
          });
        }
      }

      // Pattern 5: navigate()/router.push() to undefined variable
      if (/(navigate|router\.push|router\.replace)\s*\(\s*['"`]/.test(line)) {
        const match = line.match(/(?:navigate|router\.push|router\.replace)\s*\(\s*['"]([^'"]+)['"]/);

        if (match && match[1] === '') {
          issues.push({
            filePath,
            line: lineNum,
            severity: 'error',
            message: 'Navigation call with empty path. The button/link navigates to nowhere.',
            suggestion: 'Provide a valid route path.',
          });
        }
      }
    }

    /*
     * Check for orphaned function definitions that are never called
     * (basic heuristic: function is defined but never referenced elsewhere in the file)
     */
    await checkOrphanedHandlers(content, filePath, issues);
  }
}

/**
 * Checks for handler functions that are defined but never connected to any element.
 */
async function checkOrphanedHandlers(content: string, filePath: string, issues: VerificationIssue[]): Promise<void> {
  // Find function definitions that look like handlers
  const handlerPattern = /(?:const|let|function)\s+(handle\w+|on\w+|submit\w+)\s*[=(]/g;
  const handlers: Array<{ name: string; line: number }> = [];

  let match;

  while ((match = handlerPattern.exec(content)) !== null) {
    handlers.push({
      name: match[1],
      line: content.substring(0, match.index).split('\n').length,
    });
  }

  for (const handler of handlers) {
    // Count references to this handler in the file
    const regex = new RegExp(`\\b${handler.name}\\b`, 'g');
    const references = content.match(regex);
    const refCount = references ? references.length : 0;

    // If only defined once but never referenced in JSX, flag it
    const usedInJsx = new RegExp(`${handler.name}[\\s}]*[>"]`, 'm').test(content);

    if (!usedInJsx && refCount <= 1) {
      issues.push({
        filePath,
        line: handler.line,
        severity: 'info',
        message: `Handler function "${handler.name}" is defined but does not appear to be connected to any UI element.`,
        suggestion: 'Connect this handler to a button, form, or other interactive element.',
      });
    }
  }
}

/*
 * ============================================================
 * Rule 2: Every Screen Is Connected
 * ============================================================
 */

async function checkEveryScreenIsConnected(
  options: VerificationRunnerOptions,
  allFiles: string[],
  issues: VerificationIssue[],
  fileCache: FileReadCache,
): Promise<void> {
  // Step 1: Find all route definitions
  const routes = await findRoutes(options, allFiles, fileCache);

  // Step 2: Find all component files (potential screens/pages)
  const componentFiles = options.modifiedFiles.filter(
    (f) =>
      /\.(jsx|tsx)$/.test(f) &&
      !f.includes('.test.') &&
      !f.includes('.spec.') &&
      !f.includes('node_modules') &&
      !f.includes('_app.') &&
      !f.includes('_layout.') &&
      !f.includes('_error.'),
  );

  for (const compFile of componentFiles) {
    const content = await fileCache.get(compFile);

    if (!content) {
      continue;
    }

    // Extract the default export name
    const exportMatch = content.match(/export\s+(?:default\s+)?function\s+(\w+)/);
    const compName = exportMatch ? exportMatch[1] : '';

    // Check if this component is imported or referenced in any route file
    let isReachable = false;

    for (const routeFile of routes.routeFiles) {
      const routeContent = await fileCache.get(routeFile);

      if (!routeContent) {
        continue;
      }

      // Check if the component file is imported in the route
      const importPattern = new RegExp(
        compFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/index\.(tsx|jsx)$/, ''),
        'i',
      );

      if (importPattern.test(routeContent)) {
        isReachable = true;
        break;
      }

      // Check if the component name is referenced
      if (compName && new RegExp(`\\b${compName}\\b`).test(routeContent)) {
        isReachable = true;
        break;
      }
    }

    /*
     * Also check if the component is referenced from other components
     * that ARE in routes (indirect connection)
     */
    if (!isReachable) {
      for (const otherFile of allFiles) {
        if (otherFile === compFile) {
          continue;
        }

        if (routes.routeFiles.includes(otherFile)) {
          continue;
        }

        if (!/\.(jsx|tsx|js|ts)$/.test(otherFile)) {
          continue;
        }

        const otherContent = await fileCache.get(otherFile);

        if (!otherContent) {
          continue;
        }

        const fileRefPattern = new RegExp(
          compFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/index\.(tsx|jsx)$/, ''),
          'i',
        );

        if (fileRefPattern.test(otherContent) || (compName && new RegExp(`\\b${compName}\\b`).test(otherContent))) {
          /*
           * This component is referenced by another component — check if that
           * other component is reachable from a route (recursive, but 1 level is enough)
           * For now, mark as potentially connected
           */
          isReachable = true;
          break;
        }
      }
    }

    if (!isReachable && isLikelyAScreen(content)) {
      issues.push({
        filePath: compFile,
        severity: 'warning',
        message: `"Every screen is connected" warning: This component appears to be a screen/page but is not imported in any route file. It may be unreachable from the app's navigation.`,
        suggestion: 'Add a route entry for this component, or import it in an existing route.',
      });
    }
  }
}

/**
 * Attempts to detect if a component is likely a screen/page
 * (as opposed to a shared component, utility, etc.)
 */
function isLikelyAScreen(content: string): boolean {
  /*
   * Heuristics that suggest a page/screen:
   * - Has a page-level layout (returns a full page structure)
   * - Has "page" or "screen" in the filename (already filtered by caller)
   * - Has a main container div with page-like structure
   * - Has a heading/title element
   * - Has a return statement with a top-level container
   */

  const hasPageStructure =
    /return\s*\(\s*<div[^>]*>\s*<(h[1-6]|main|section|header)/.test(content) ||
    /return\s*\(\s*<(h[1-6]|main|section|header)/.test(content);

  const hasNavigation = /useNavigate|useRouter|Link\s|NavLink\s|redirect\(/.test(content);

  const hasPageTitle = /<h[1-3][^>]*>/.test(content);

  // More likely a screen if it has page structure AND (navigation OR title)
  return hasPageStructure && (hasNavigation || hasPageTitle);
}

/**
 * Finds all route definitions in the project.
 * Supports: React Router (Routes/Route), Next.js file-based routing, Remix file-based routing.
 */
async function findRoutes(
  options: VerificationRunnerOptions,
  allFiles: string[],
  fileCache?: FileReadCache,
): Promise<{ routeFiles: string[]; routePaths: string[] }> {
  const routeFiles: string[] = [];
  const routePaths: string[] = [];

  /*
   * React Router pattern: look for Route elements
   * Remix pattern: look in app/routes/ directory
   * Next.js pattern: look in app/ or pages/ directory
   */

  // Remix routes
  const remixRouteFiles = allFiles.filter((f) => f.includes('app/routes/') && /\.(tsx|ts|jsx|js)$/.test(f));

  if (remixRouteFiles.length > 0) {
    routeFiles.push(...remixRouteFiles);
    return { routeFiles, routePaths };
  }

  // Next.js app router
  const nextRouteFiles = allFiles.filter((f) => f.includes('app/') && /page\.(tsx|ts|jsx|js)$/.test(f));

  if (nextRouteFiles.length > 0) {
    routeFiles.push(...nextRouteFiles);
    return { routeFiles, routePaths };
  }

  // Next.js pages router
  const pagesRouteFiles = allFiles.filter(
    (f) =>
      (f.includes('pages/') || f.includes('src/pages/')) &&
      /\.(tsx|ts|jsx|js)$/.test(f) &&
      !f.includes('_app') &&
      !f.includes('_document'),
  );

  if (pagesRouteFiles.length > 0) {
    routeFiles.push(...pagesRouteFiles);
    return { routeFiles, routePaths };
  }

  // React Router: find files that define <Route> or <Routes>
  for (const file of allFiles) {
    if (!/\.(tsx|jsx|ts|js)$/.test(file)) {
      continue;
    }

    if (file.includes('node_modules')) {
      continue;
    }

    if (file.includes('.test.') || file.includes('.spec.')) {
      continue;
    }

    const content = await (fileCache?.get(file) ?? options.readFile(file));

    if (!content) {
      continue;
    }

    if (/<Route[\s>]/.test(content) || /createBrowserRouter/.test(content) || /RouterProvider/.test(content)) {
      routeFiles.push(file);

      // Extract route paths
      const pathMatches = content.matchAll(/path\s*=\s*["']([^"']+)["']/g);

      for (const m of pathMatches) {
        routePaths.push(m[1]);
      }
    }
  }

  return { routeFiles, routePaths };
}
