# Plan: Implement Artifact Output Path & Watcher

## Overview

Artifacts are high-value deliverables (code, documents, diagrams) that the LLM creates. Instead of just appearing as text in the chat, they are written to a specific directory and rendered in a dedicated side-panel for a better user experience.

## Implementation Details

### 1. The Artifact Path

All renderable outputs must be written to:
`/chat/outputs/artifacts/`

### 2. The Watcher Mechanism

I will implement a filesystem watcher (or intercept the `create_file` tool) to detect new files in the artifact directory.

**Logic:**

1. LLM calls `create_file(path, content)`.
2. If `path` starts with `/chat/outputs/artifacts/`:
   - Trigger the `ArtifactManager`.
   - Notify the UI to open the Artifact Panel.

### 3. The Rendering Engine

The `ArtifactManager` will determine the renderer based on the file extension:

| Extension       | Renderer | Implementation                                               |
| :-------------- | :------- | :----------------------------------------------------------- |
| `.md`           | Markdown | Use `react-markdown` or similar.                             |
| `.html`         | HTML/JS  | Render in a sandboxed `<iframe>`.                            |
| `.jsx` / `.tsx` | React    | Compile using `esbuild-wasm` and render in a preview iframe. |
| `.svg`          | SVG      | Render as an inline SVG image.                               |
| `.mermaid`      | Diagram  | Use `mermaid.js` to render the diagram.                      |
| `.pdf`          | PDF      | Use a PDF viewer component.                                  |

### 4. UI Integration

- **Artifact Panel**: A slide-out panel on the right side of the chat.
- **Version Control**: If the LLM updates an artifact, the panel should show the new version (and optionally allow switching between versions).
- **Download/Copy**: Provide buttons to download the raw file or copy the content.

## Sub-Feature Breakdown

- **PDF Generation**: Integrate a library like `jspdf` or `pdf-lib` if the LLM needs to "create" a PDF.
- **Doc Generation**: Use a template-based approach for `.docx` files.
- **React Sandbox**: Implement a secure environment for executing JSX code.

## Verification Plan

- [ ] Create a file at `/chat/outputs/artifacts/test.md`. Verify the Artifact Panel opens and renders markdown.
- [ ] Create a file at `/chat/outputs/artifacts/test.html`. Verify it renders in an iframe.
- [ ] Create a file at `/chat/outputs/artifacts/test.mermaid`. Verify the diagram renders.
- [ ] Update an existing artifact and verify the UI refreshes the content.
