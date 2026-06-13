---
name: html-page
description: >
  Use this skill whenever the user asks to create a standalone HTML page, single-file website,
  or simple web page without a framework. Triggers: "create an HTML page", "make a landing page",
  "build a simple webpage", "single HTML file", "static page", "portfolio page as HTML",
  "HTML with CSS and JS".
  Also use for pages that should work without npm install or a build step.
  Do NOT use for full web applications with routing (use webapp-builder skill instead).
  Do NOT use for React/Vue/Angular apps (use webapp-builder skill instead).
---

# HTML Page Creation Skill

You are an expert frontend developer creating beautiful, self-contained HTML pages. Follow these guidelines strictly.

## Template

This skill uses the **blank** template (no framework scaffold needed).

- **Template Name**: `blank`
- No `inject_template` call needed — work directly in the workspace.

## Step-by-Step Workflow

### Step 1: Analyze Requirements

Before writing any code:

1. Identify the page purpose and content structure
2. Determine if it's a single section or multi-section page
3. List interactive elements needed (forms, tabs, modals, etc.)
4. Check if a design system would enhance the result

### Step 2: Choose Approach

| Approach                   | When to Use                                                |
| -------------------------- | ---------------------------------------------------------- |
| **Single HTML file**       | Simple pages, demos, quick prototypes                      |
| **HTML + separate CSS/JS** | Pages with complex styling or interactions                 |
| **Vanilla Vite**           | When the page needs hot reload or will grow into a project |

For most requests, a single HTML file is the fastest and best approach.

### Step 3: Load a Design System (Optional)

For high-quality visual results, load a matching design system:

- **stripe** — clean fintech aesthetic
- **apple** — premium minimal
- **vercel** — modern developer tools
- **linear-app** — sleek productivity
- **notion** — clean documentation

Follow its color, typography, and spacing guidelines.

### Step 4: Build the Page

Structure every HTML page with:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page Title</title>
    <!-- Tailwind CDN for quick styling -->
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      /* Custom styles here */
    </style>
  </head>
  <body class="bg-white text-gray-900 antialiased">
    <!-- Page content -->
    <script>
      // Interactive behavior here
    </script>
  </body>
</html>
```

### Step 5: Add Content & Interactivity

For each page:

1. Use semantic HTML5 elements (`<header>`, `<main>`, `<section>`, `<footer>`)
2. Include realistic, domain-relevant content (not lorem ipsum)
3. Use Pexels for images: `https://images.pexels.com/photos/{id}/pexels-photo-{id}.jpeg`
4. Add smooth scroll, intersection observer animations, and hover effects
5. Make all interactive elements keyboard-accessible

### Step 6: Ensure Responsiveness

Use Tailwind's responsive prefixes:

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- Cards -->
</div>
```

Test mentally at: 320px (mobile), 768px (tablet), 1024px (laptop), 1440px (desktop).

## Technology Choices

### Styling (pick one)

1. **Tailwind CDN** (recommended) — fastest for prototyping
   ```html
   <script src="https://cdn.tailwindcss.com"></script>
   ```
2. **Embedded `<style>`** — for custom CSS without dependencies
3. **Separate CSS file** — for pages that will be maintained

### Icons

- Use inline SVG for simple icons
- Use Lucide Icons CDN for a broader set:
  ```html
  <script src="https://unpkg.com/lucide@latest"></script>
  ```

### Animations

- Use CSS `@keyframes` for simple animations
- Use Intersection Observer for scroll-triggered animations
- Use CSS `transition` for hover/focus effects

## Design Requirements

Every HTML page MUST:

1. Have a **clear visual hierarchy** — headings, subheadings, body text
2. Be **fully responsive** — works on mobile through desktop
3. Have **smooth interactions** — hover effects, transitions, scroll behavior
4. Use **consistent spacing** — 4px/8px grid
5. Include **realistic content** — no placeholder text
6. Have **proper meta tags** — title, viewport, charset
7. Use **accessible markup** — ARIA labels, alt text, semantic elements

## Critical Rules

1. **NEVER use external CSS frameworks** beyond Tailwind CDN
2. **ALWAYS use Tailwind CDN** unless user explicitly asks for custom CSS
3. **NEVER use Unsplash** — always Pexels for images
4. **ALWAYS include viewport meta tag** — mobile responsiveness is mandatory
5. **NEVER use `!important`** in CSS — fix specificity properly
6. **ALWAYS validate HTML** — proper nesting, closed tags, valid attributes
7. **NEVER put JavaScript in `<head>`** without `defer` or `DOMContentLoaded`
8. **ALWAYS use semantic HTML** — divs alone are not sufficient

## Common Patterns

### Hero Section

```html
<section class="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
  <div class="max-w-4xl mx-auto px-6 text-center">
    <h1 class="text-5xl md:text-7xl font-bold text-gray-900 mb-6">Headline</h1>
    <p class="text-xl text-gray-600 mb-8">Subheadline description</p>
    <a href="#features" class="inline-block px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
      Get Started
    </a>
  </div>
</section>
```

### Feature Grid

```html
<section class="py-20 px-6">
  <div class="max-w-6xl mx-auto">
    <h2 class="text-3xl font-bold text-center mb-12">Features</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <!-- Feature cards -->
    </div>
  </div>
</section>
```

### Testimonial Section

```html
<section class="py-20 bg-gray-50 px-6">
  <div class="max-w-4xl mx-auto">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <!-- Testimonial cards with avatar, quote, name -->
    </div>
  </div>
</section>
```

## Output Format

When creating an HTML page, produce:

1. The HTML file (typically `index.html` or a named file)
2. Any separate CSS files if needed (`.css`)
3. Any separate JS files if needed (`.js`)
4. No npm install needed for standalone HTML pages
