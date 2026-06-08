# Plan: Implement Custom Skill Installation/Marketplace (Phase 4)

## Overview

The Skill Marketplace transforms the agent from a fixed-capability tool into an extensible platform. Users can discover, install, and manage specialized skills to tailor the AI to their specific needs.

## Implementation Details

### 1. Skill Bundle Format

To allow sharing, skills will be packaged as "Skill Bundles".
**Format**: A `.skill` file (essentially a ZIP archive) containing:

- `SKILL.md` (The core instructions)
- `manifest.json` (Version, author, dependencies, category)
- `references/` (Optional documentation)
- `scripts/` (Optional helper scripts)
- `assets/` (Optional templates/icons)

### 2. Installation Workflow

1. **Discovery**: User finds a skill in the Marketplace UI.
2. **Installation**:
   - The app downloads the `.skill` bundle.
   - The bundle is extracted into `/chat/skills/{skill-name}/`.
   - The `index.json` registry is updated to include the new skill.
3. **Activation**: The `SkillLoader` detects the change and the skill becomes available in the next system prompt generation.

### 3. Marketplace UI

- **Browse Page**: Categories (Coding, Writing, Data Analysis, etc.), Top Rated, and Newest skills.
- **Skill Detail Page**: Description, examples of what the skill can do, and an "Install" button.
- **My Skills Page**: A list of installed skills with the ability to update or uninstall them.

### 4. Advanced Configurations

- **Per-Project Skills**: Allow users to assign specific skills to specific projects (e.g., a "React Native" skill only for the mobile app project).
- **Private Skills**: Allow users to create and save their own local skills.

## Verification Plan

- [ ] Create a manual `.skill` bundle and "install" it by extracting it to the skills folder. Verify it appears in the system prompt.
- [ ] Implement a basic UI that lists skills from a remote JSON API and allows "installing" them.
- [ ] Verify that uninstalling a skill removes it from the registry and the filesystem.
- [ ] Test per-project skill assignment and verify the LLM only sees the relevant skills.
