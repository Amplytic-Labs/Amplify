# Plan: Hide /chat/ from File Explorer

## Overview

The goal is to ensure that the internal `/chat/` directory (used for skills, tools, and session metadata) is completely invisible to the user in the VS Code-like file explorer UI. This maintains the "silent workspace" abstraction.

## Implementation Details

### 1. Identify Target Components

I need to locate the components responsible for rendering the file system tree. Based on the project structure, I will look for:

- `app/components/sidebar/` (likely contains the explorer)
- Any component named `FileTree`, `Explorer`, or `FileSystem`.

### 2. Define Hidden Paths

I will create a configuration constant to manage hidden directories.

```typescript
const HIDDEN_PATHS = ['/chat', '/chat/'];
```

### 3. Implement Filtering Logic

In the component that iterates over the filesystem entries (likely using a recursive function or a flat list of files), I will implement a filter:

```typescript
function isVisible(path: string): boolean {
  return !HIDDEN_PATHS.some((hidden) => path.startsWith(hidden));
}
```

### 4. Integration Points

- **File Tree Rendering**: Apply `isVisible` filter before mapping files to UI components.
- **Search/Quick Open**: If the app has a file search feature, ensure `/chat/` files are excluded from results.
- **Breadcrumbs**: Ensure that if a user somehow navigates to a file in `/chat/`, the breadcrumbs don't expose the root `/chat/` folder.

## Testing Plan

### 1. UI Verification

- **Sidebar Explorer**: Create a folder named `/chat` in the project root. Verify it is not rendered in the file tree.
- **Nested Paths**: Create a folder `/chat/internal/secrets`. Verify that neither the root `/chat` nor any of its children are visible.
- **Positive Test**: Create a folder `/chat-logs`. Verify that it IS visible (ensuring the filter isn't too aggressive).

### 2. Integration Tests

- **Search/Quick Open**: Use the global search (if available) to look for a file inside `/chat/`. Verify it does not appear in the results.
- **Breadcrumbs**: Manually navigate to a file in `/chat/` (via URL or console). Verify that the breadcrumb navigation does not expose the `/chat/` root.

### 3. Edge Cases

- **Case Sensitivity**: Test if `/CHAT` or `/Chat` are also hidden (depending on the OS/Filesystem).
- **Root-level files**: Verify that files in the root directory (e.g., `package.json`) remain visible.
