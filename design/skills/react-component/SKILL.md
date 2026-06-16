---
name: react-component
description: >
  Use this skill whenever the user asks to create a single React component, UI widget, or
  reusable component — NOT a full application. Triggers: "create a React component",
  "build a modal", "make a data table", "create a form component", "build a chart component",
  "React UI widget", "reusable component", "shadcn component", "React card component".
  Also use when the user wants a single interactive element to add to an existing project.
  Do NOT use for full web applications (use webapp-builder skill instead).
  Do NOT use for React Native components (use react-native-component skill instead).
---

# React Component Creation Skill

You are an expert React developer creating polished, reusable components. Follow these guidelines strictly.

## Template

This skill uses the **Vite React** or **Vite Shadcn** template depending on complexity.

| Template        | When to Use                                     |
| --------------- | ----------------------------------------------- |
| **Vite React**  | Simple components, no shadcn dependency         |
| **Vite Shadcn** | Complex components needing shadcn/ui primitives |

- **Injection**: Call `inject_template` with the appropriate template name.

## Step-by-Step Workflow

### Step 1: Analyze the Component

Before writing any code:

1. Identify the component's purpose and API (props interface)
2. List all states the component can be in
3. Determine dependencies (icons, animations, data)
4. Decide if shadcn/ui primitives would help

### Step 2: Inject Template

Call `inject_template` with the chosen template. Wait for injection to complete.

### Step 3: Request Capabilities

Call `request_capabilities` with `capability: 'app_builder'`. This gives you the file creation syntax (artifact XML tags) needed to write code. Do NOT skip this step.

### Step 4: Load a Design System (If UI-Focused)

For visually rich components, load a matching design system and follow its visual guidelines.

### Step 5: Build the Component

Create the component in `src/components/`:

```tsx
// src/components/DataTable.tsx
import { useState, useMemo } from 'react';

interface Column<T> {
  key: keyof T;
  header: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  searchable?: boolean;
  pageSize?: number;
}

export function DataTable<T>({ columns, data, searchable = true, pageSize = 10 }: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!search) return data;
    return data.filter((row) =>
      columns.some((col) => String(row[col.key]).toLowerCase().includes(search.toLowerCase())),
    );
  }, [data, search, columns]);

  // ... rest of implementation
}
```

### Step 5: Create the Showcase Page

Integrate the component into the app's main page so it's immediately visible:

```tsx
// src/App.tsx or src/pages/index.tsx
import { DataTable } from './components/DataTable';

const sampleData = [
  { id: 1, name: 'Alice', role: 'Engineer', status: 'Active' },
  // ... 5-10 realistic items
];

const columns = [
  { key: 'name', header: 'Name' },
  { key: 'role', header: 'Role' },
  { key: 'status', header: 'Status' },
];

function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-3xl font-bold mb-8">Component Demo</h1>
      <DataTable columns={columns} data={sampleData} searchable />
    </div>
  );
}

export default App;
```

### Step 6: Add Realistic Data

NEVER use empty arrays or placeholder data. Every component must demonstrate:

- **Populated state** — 5-10 realistic items
- **Empty state** — friendly message when no data
- **Loading state** — skeleton or spinner
- **Error state** — error message with retry option

## Component Design Rules

### Props API

- Use TypeScript interfaces for all props
- Provide sensible defaults
- Use generics for data-driven components
- Keep the API surface small — avoid prop drilling

### Styling

- Use **Tailwind CSS** for all styling
- Support dark mode with `dark:` variants
- Use consistent spacing (4px/8px grid)
- Add hover/focus/active states for interactive elements
- Use `transition` for smooth state changes

### Accessibility

- Add `aria-label`, `aria-expanded`, `aria-selected` as appropriate
- Support keyboard navigation (Tab, Enter, Escape, Arrow keys)
- Use proper `role` attributes for custom widgets
- Ensure 4.5:1 contrast ratio for all text

### Performance

- Use `React.memo` for expensive renders
- Use `useMemo` for derived data
- Use `useCallback` for event handlers passed to children
- Virtualize long lists with `react-window` or `@tanstack/virtual`

## Common Component Patterns

### Modal / Dialog

```tsx
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}
```

Key features: backdrop click to close, Escape key, focus trap, scroll lock

### Data Table

Key features: sorting, filtering, pagination, row selection, column resize

### Form

Key features: validation, error messages, controlled/uncontrolled modes, submit handler

### Chart/Visualization

Use Recharts or Chart.js. Always include: legend, tooltip, responsive sizing

### Navigation

Key features: active state indicator, responsive collapse, keyboard navigation

## Critical Rules

1. **NEVER create a component without a showcase page** — it must be visible
2. **ALWAYS use TypeScript** — proper types for all props
3. **ALWAYS include realistic data** — no empty states as default
4. **NEVER use inline styles** — use Tailwind classes
5. **ALWAYS handle edge cases** — empty data, long text, special characters
6. **NEVER forget keyboard support** — every interactive element must be keyboard-accessible
7. **ALWAYS verify imports** — every symbol used must be in the import statement
8. **NEVER use spread in array literals** — WebContainer parser limitation

## Output Format

When creating a React component, produce:

1. Updated `package.json` with new dependencies
2. Shell command: `npm install`
3. Component file in `src/components/`
4. Updated `App.tsx` or main page to showcase the component
5. Start command: `npm run dev` (LAST action)
