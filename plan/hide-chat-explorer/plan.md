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

## Verification Plan

- [ ] Start the application.
- [ ] Create a dummy folder named `/chat` in the workspace.
- [ ] Verify that the `/chat` folder does not appear in the sidebar explorer.
- [ ] Verify that other folders remain visible.
- [ ] (If applicable) Search for a file inside `/chat` and verify it doesn't appear in search results.
