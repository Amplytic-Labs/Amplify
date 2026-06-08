# Plan: Extend Existing Artifact System

## Overview

bolt.diy already has a sophisticated artifact system using `<boltArtifact>` and `<boltAction>` tags. Instead of rebuilding it, we will extend the existing infrastructure to support a wider range of renderable types and add versioning.

## Implementation Details

### 1. Extending the Rendering Engine

The current system handles code and shell actions. I will extend the `Artifact` component and `StreamingMessageParser` to support:

- **Markdown (`.md`)**: Integrate a high-quality markdown renderer in the artifact panel.
- **SVG (`.svg`)**: Render inline vector graphics.
- **Mermaid (`.mermaid`)**: Integrate `mermaid.js` to render diagrams.
- **HTML/JS (`.html`)**: Render in a sandboxed `<iframe>`.

### 2. Artifact Versioning

To allow users to track changes to a generated artifact:

- **Version Store**: Implement a simple in-memory or `localStorage` store that tracks content changes for a specific `filePath`.
- **UI Controls**: Add "Previous" and "Next" buttons to the Artifact panel to switch between versions.
- **Diff View**: (Optional) Implement a side-by-side diff view for artifact versions.

### 3. Enhanced Export Options

Add utility buttons to the Artifact UI:

- **Download**: Export the raw file to the user's local machine.
- **Copy**: Copy the content to the clipboard.

### 4. Integration with ActionRunner

Ensure that when the LLM creates a file that is designated as an "artifact" (e.g., via a specific path or tag), the `ActionRunner` triggers the Artifact Panel to open.

## Testing Plan

### 1. Unit Tests

- **Extension Mapping**: Verify that the `Artifact` component correctly maps `.md`, `.svg`, `.mermaid`, and `.html` to their respective renderers.
- **Version Store**: Verify that `addVersion()` correctly stores content and `getVersion(n)` retrieves the correct iteration.
- **Export Logic**: Verify that the "Download" function generates a blob with the correct MIME type and filename.

### 2. Integration Tests

- **Parser $\rightarrow$ UI**: Verify that a `<boltArtifact>` tag in the LLM stream triggers the opening of the Artifact panel with the correct content.
- **ActionRunner $\rightarrow$ Versioning**: Verify that every `file` action targeting an artifact path creates a new version in the store.
- **Renderer Sandbox**: Verify that HTML artifacts are rendered in a sandboxed iframe and cannot access the parent window's cookies or localStorage.

### 3. Edge Cases

- **Malformed Content**: Test how the Mermaid and Markdown renderers handle syntax errors (should show a graceful error message, not crash).
- **Large Artifacts**: Test rendering of a 1MB SVG or a 10,000-line Markdown file for performance lags.
- **Rapid Updates**: Verify that multiple rapid updates to the same artifact don't cause race conditions in the version store.

### 4. E2E / Behavioral Tests

- **Full Cycle**: Request the AI to "Create a mermaid diagram of the system architecture, then update it to add a database". Verify the panel opens, renders the first version, and then allows switching to the second version.
- **Export Test**: Create an artifact and verify it can be downloaded and opened in an external editor.
