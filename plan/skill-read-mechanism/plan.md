# Plan: Implement Skill Read Mechanism (read_file intercept)

## Overview

To enable "Progressive Loading" of skills, the LLM must be able to read the full content of a `SKILL.md` file only when it decides the skill is relevant. This is achieved by intercepting the standard `read_file` tool call.

## Implementation Details

### 1. Tool Execution Interceptor

I will modify the central tool execution handler (the function that maps tool names to their implementation).

### 2. Routing Logic

When the `read_file` tool is invoked with a `path` argument:

1. **Check for Skill Path**:
   - If `path.startsWith('/chat/skills/')`:
     - Delegate the read operation to `SkillLoader.readSkill(path)`.
     - Return the content of the skill file.
2. **Fallback to Workspace**:
   - If the path does not match the skill prefix:
     - Delegate the read operation to the standard WebContainer filesystem (`webcontainer.fs.readFile`).
     - Return the content of the project file.

### 3. Error Handling

- If `SkillLoader` throws a security error (path out of bounds), return a clear error message to the LLM: `"Error: Access denied. You can only read files within the /chat/skills/ directory."`
- If the file does not exist in either location, return a standard `"File not found"` error.

### 4. LLM Guidance

The system prompt will be updated to instruct the LLM:
_"If you see a skill in <available_skills> that is relevant to the task, use the `read_file` tool on its <location> path to load the full instructions before proceeding."_

## Verification Plan

- [ ] Mock a `read_file` call with a path to a skill: `/chat/skills/frontend-design/SKILL.md`. Verify it returns the skill content.
- [ ] Mock a `read_file` call with a path to a project file: `/workspace/src/main.ts`. Verify it returns the project file content.
- [ ] Mock a `read_file` call with an invalid path. Verify it returns a "File not found" error.
- [ ] Verify that the LLM actually calls `read_file` after seeing a relevant skill in the system prompt.
