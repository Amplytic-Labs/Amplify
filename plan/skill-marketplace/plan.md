# Plan: Implement Skill Marketplace (Phase 4)

## Overview

The Skill Marketplace allows users to extend the agent's capabilities by installing specialized skill bundles. This is a late-stage feature that will be implemented only after the core skill system is stable and proven.

## Implementation Details

### 1. Refined Skill Bundle Format

Skills will be packaged as `.skill` bundles (ZIP archives) with a strict manifest schema to ensure compatibility and security.

**Manifest Schema (`manifest.json`):**

- `name`, `version` (SemVer), `author`, `description`.
- `category`: ('coding' | 'design' | 'data' | 'writing' | ...).
- `minAppVersion`: Minimum version of Open Claude required.
- `dependencies`: List of other skills required.
- `permissions`: Requested access ('filesystem', 'network', 'shell').
- `estimatedTokens`: Token cost of loading the skill.

### 2. Trust & Security Model

To prevent malicious skills from compromising the system:

- **Verification**: Official skills are marked as "Verified".
- **Sandboxing**: Skills are restricted from accessing sensitive system paths.
- **Audit**: A manifest-based permission system requires user approval for high-risk permissions.
- **Community Rating**: User-driven ratings and install counts to identify quality skills.

### 3. Installation Workflow

1. **Discovery**: User browses the Marketplace UI.
2. **Installation**:
   - Bundle is downloaded and validated against the manifest schema.
   - Content is extracted to a secure user-skills directory.
   - `SkillLoader` registry is updated dynamically.
3. **Activation**: The skill is added to the available skills list for the next conversation.

### 4. Marketplace UI

- **Browse**: Category-based filtering and search.
- **Detail View**: Showcases the skill's procedural steps, examples, and trust rating.
- **Management**: A "My Skills" page to update, disable, or uninstall bundles.

## Testing Plan

### 1. Unit Tests

- **Manifest Validation**: Verify that the validator correctly identifies missing required fields or invalid SemVer versions in `manifest.json`.
- **Bundle Extraction**: Verify that the ZIP extractor correctly handles nested directories and prevents "Zip Slip" (path traversal via archive).
- **Dependency Resolver**: Verify that the system correctly identifies and warns about missing dependencies for a skill.

### 2. Integration Tests

- **Install $\rightarrow$ Load**: Verify the full flow: Download bundle $\rightarrow$ Validate $\rightarrow$ Extract $\rightarrow$ Update Registry $\rightarrow$ Inject into Prompt.
- **Uninstall Flow**: Verify that uninstalling a skill removes all its files and removes its entry from the `SkillLoader` registry.
- **Permission Gate**: Verify that a skill requesting 'shell' access is blocked unless the user explicitly grants permission in the UI.

### 3. Edge Cases

- **Version Conflict**: Test behavior when installing a newer version of an existing skill.
- **Corrupt Bundle**: Verify that a malformed ZIP file is handled gracefully with a clear error message.
- **Circular Dependencies**: Test behavior when Skill A depends on Skill B, and Skill B depends on Skill A.

### 4. Security & Trust

- **Malicious Manifest**: Attempt to install a skill with a manifest that tries to override core system skills.
- **Resource Exhaustion**: Test the installation of a massive skill bundle to ensure it doesn't crash the app or fill up the user's storage.
