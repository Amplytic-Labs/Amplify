---
name: webapp-builder
description: >
  Use this skill whenever the user asks to build a full web application, website, or web project.
  Triggers: "build a web app", "create a website", "make a React app", "build a dashboard",
  "create a landing page", "web application", "full-stack web app", "SaaS app", "portfolio site".
  Also use when the user requests a multi-page web project with routing, forms, or backend integration.
  Do NOT use for single-file HTML pages (use html-page skill instead).
  Do NOT use for single React components (use react-component skill instead).
  Do NOT use for mobile apps (use mobile-app-development skill instead).
  Do NOT use for file generation like .docx, .pdf (those use the blank template directly).
---

# Web App Builder Skill

You are an expert senior web developer building production-ready web applications. Follow these guidelines strictly.

## Available Templates

Choose the most appropriate template based on the user's requirements:

| Template             | Use When                                                                       |
| -------------------- | ------------------------------------------------------------------------------ |
| **Vite React**       | Default choice for most React web apps, SPAs, dashboards                       |
| **Vite Shadcn**      | When the user explicitly asks for shadcn/ui or needs premium component styling |
| **NextJS Shadcn**    | Full-stack React app with SSR/SSG, API routes, and shadcn/ui                   |
| **Basic Astro**      | Static sites, blogs, content-heavy sites, marketing pages                      |
| **Vanilla Vite**     | Simple JS projects, no framework needed                                        |
| **Vite Typescript**  | TypeScript-first projects without React                                        |
| **Vue**              | Vue.js applications                                                            |
| **Angular**          | Enterprise Angular applications                                                |
| **Remix Typescript** | Full-stack Remix apps with nested routing                                      |
| **SolidJS**          | High-performance reactive applications                                         |
| **Qwik Typescript**  | Resumable apps with instant loading                                            |
| **Slidev**           | Developer presentations using Markdown                                         |

## Step-by-Step Workflow

### Step 1: Analyze Requirements

Before writing any code:

1. Determine the app type (SPA, SSR, static, full-stack)
2. Identify the primary framework needed
3. List core pages/routes
4. Determine data management needs (local state, API, database)
5. Check if Supabase or another backend is needed

### Step 2: Select and Inject Template

Call `inject_template` with the appropriate template name:

```
inject_template({ templateName: "Vite React" })
```

Wait for the template to be injected before proceeding.

### Step 3: Request Capabilities

Call `request_capabilities` with `capability: 'app_builder'`. This gives you the file creation syntax (artifact XML tags) needed to write application code. Do NOT skip this step.

### Step 4: Load a Design System

For UI-heavy applications, load a design system that matches the brand/domain:

- **stripe** — fintech, payment apps
- **vercel** — developer tools, SaaS
- **linear-app** — project management, productivity
- **notion** — docs, knowledge management
- **apple** — premium consumer products
- **airbnb** — travel, marketplace apps
- **spotify** — media, entertainment

Follow the loaded design system's visual guidelines precisely.

### Step 5: Plan the File Structure

For React (Vite React / Vite Shadcn):

```
src/
├── App.tsx              # Root component with routing
├── main.tsx             # Entry point
├── index.css            # Global styles
├── components/          # Reusable components
│   ├── ui/              # shadcn components (if applicable)
│   ├── layout/          # Header, Footer, Sidebar
│   └── shared/          # Cross-feature components
├── pages/               # Route-level page components
├── hooks/               # Custom React hooks
├── lib/                 # Utilities, API clients
├── types/               # TypeScript type definitions
└── assets/              # Static assets (referenced, not binary)
```

### Step 6: Implement Pages

For each page:

1. Create the page component with proper TypeScript types
2. Implement all states: loading, empty, error, success
3. Use the design system's color palette, typography, and spacing
4. Ensure responsive design (mobile, tablet, desktop)
5. Add proper meta tags and accessibility attributes

### Step 7: Set Up Routing

For Vite React:

```tsx
// App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### Step 8: Wire Up Data Layer

For Supabase integration:

```tsx
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL!, import.meta.env.VITE_SUPABASE_ANON_KEY!);
export default supabase;
```

Create `.env` with the provided Supabase credentials.

## Technology Stack Rules

### Always Use

- **Vite** as the build tool and dev server
- **Tailwind CSS** for styling (unless design system specifies otherwise)
- **Lucide React** for icons
- **TypeScript** for type safety
- **Pexels** for stock photos

### Never Use

- Binary files or base64-encoded assets
- External CDN scripts (everything must be npm-installed)
- `dangerouslySetInnerHTML` without sanitization
- Inline styles for layout (use Tailwind classes)

## Design Requirements

Every web app MUST:

1. Be **responsive** — test at 320px, 768px, 1024px, 1440px widths
2. Have **loading states** — skeleton loaders, spinners
3. Have **error states** — user-friendly error messages
4. Have **empty states** — helpful CTAs when no data exists
5. Use **consistent spacing** — follow an 8px grid system
6. Have **accessible navigation** — keyboard support, ARIA labels
7. Use **semantic HTML** — proper heading hierarchy, landmark elements

## Critical Rules

1. **NEVER create a page without content** — populate with realistic domain data
2. **ALWAYS add `npm run dev` as the start command** (last action, after all files)
3. **NEVER skip the design system** — load one for every UI-heavy app
4. **ALWAYS verify imports** — every symbol used must be imported
5. **NEVER use spread in array literals** — WebContainer parser rejects `[a, ...arr.map(fn)]`
6. **ALWAYS use valid Pexels URLs** — never Unsplash or placeholder services
7. **NEVER create `.env` with real secrets** — use environment variables from Supabase connection
8. **ALWAYS check `package.json` scripts** before running any npm command

## Common Pitfalls

| Pitfall                                  | Fix                                                          |
| ---------------------------------------- | ------------------------------------------------------------ |
| `react-router-dom` not installed         | Add to `package.json` dependencies before install            |
| Missing `index.css` import in `main.tsx` | Add `import './index.css'` at top of entry                   |
| Tailwind classes not working             | Verify `tailwind.config.js` content paths include `./src/**` |
| Environment variables undefined          | Ensure `.env` exists and variables start with `VITE_`        |
| Build fails with TypeScript errors       | Add proper types or use `// @ts-ignore` for third-party libs |
| Spread operator crash in WebContainer    | Extract mapped array to a variable before spreading          |

## Output Format

When building a web app, produce:

1. Updated `package.json` with ALL dependencies
2. Shell command: `npm install`
3. All source files in the correct directories
4. `.env` file if Supabase is connected
5. Configuration files (Tailwind, Vite, etc.) if modified
6. Start command: `npm run dev` (LAST action)
