# Plan: Implement SkillLoader (Skill Injector)

## Overview

The `SkillLoader` is the core engine for managing "Skills" (markdown-based instruction sets). It handles the discovery of available skills and provides the necessary content to the LLM's system prompt and tool-based read requests.

## Implementation Details

### 1. Skill Registry Structure

The system will rely on a JSON index file located at `/chat/skills/index.json`.
**Schema:**

```json
[
  {
    "name": "skill-id",
    "description": "Detailed trigger description",
    "path": "/chat/skills/skill-id/SKILL.md"
  }
]
```

### 2. SkillLoader Class Design

I will implement a `SkillLoader` class with the following responsibilities:

#### A. Initialization (`init`)

- Load and parse `/chat/skills/index.json`.
- Cache the registry in memory for fast access.

#### B. System Prompt Generation (`buildSystemPromptBlock`)

- Iterate through the registry.
- Generate an XML block formatted as:
  ```xml
  <available_skills>
    <skill>
      <name>...</name>
      <description>...</description>
      <location>...</location>
    </skill>
  </available_skills>
  ```
- This block will be injected into the global system prompt.

#### C. Skill Content Retrieval (`readSkill`)

- Accept a path to a skill file.
- **Security Validation**: Ensure the path starts with `/chat/skills/` to prevent directory traversal attacks.
- Read the file from the virtual filesystem and return the content.

### 3. Integration

- The `SkillLoader` will be instantiated as a singleton during the chat session initialization.
- It will be called by the `SystemPromptBuilder` during the initial API request.
- It will be called by the tool execution handler when the LLM calls `read_file` on a skill location.

## Verification Plan

- [ ] Create a sample `index.json` and a `SKILL.md` file in `/chat/skills/`.
- [ ] Call `buildSystemPromptBlock()` and verify the XML output matches the expected format.
- [ ] Call `readSkill()` with a valid path and verify content is returned.
- [ ] Call `readSkill()` with an invalid path (e.g., `/etc/passwd`) and verify it throws a security error.
