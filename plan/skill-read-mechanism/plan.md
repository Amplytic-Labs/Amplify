# Plan: Implement Skill Read Mechanism (MCP Tool)

## Overview

To enable "Progressive Loading" of skills, the LLM must be able to read the full content of a skill only when it decides the skill is relevant. Instead of intercepting existing tools, we will implement a dedicated MCP tool for this purpose.

## Implementation Details

### 1. MCP Tool Definition

I will register a new tool in the `MCPService` called `read_skill`.

**Tool Schema:**

- **Name**: `read_skill`
- **Description**: "Reads the full procedural instructions for a specific skill. Use this when you identify a relevant skill in the available skills list and need the detailed steps to execute the task."
- **Parameters**:
  - `skillName` (string): The unique identifier of the skill (e.g., "frontend-design").

### 2. Execution Logic

When `read_skill` is invoked:

1. **Lookup**: The tool will call `SkillLoader.getSkillContent(skillName)`.
2. **Retrieval**: `SkillLoader` will retrieve the content from the bundled assets or database.
3. **Response**: The full markdown content of the `SKILL.md` file is returned to the LLM.

### 3. Security & Validation

- **No Path Input**: By using `skillName` instead of a file path, we completely eliminate the risk of path traversal attacks.
- **Validation**: If the `skillName` does not exist in the registry, return a clear error: `"Error: Skill '...' not found."`

### 4. LLM Guidance

The system prompt will be updated to instruct the LLM:
_"If you see a skill in the available skills list that is relevant to the task, use the `read_skill` tool with the skill's name to load the full procedural instructions before proceeding."_

## Testing Plan

### 1. Unit Tests

- **Tool Registration**: Verify that `read_skill` is correctly registered in the `MCPService` with the expected schema.
- **Lookup Logic**: Verify that `SkillLoader.getSkillContent()` returns the correct content for valid names and `null` for invalid ones.
- **Error Formatting**: Verify that the tool returns a user-friendly error message when a skill is not found.

### 2. Integration Tests

- **MCP $\rightarrow$ SkillLoader**: Verify the full chain from MCP tool invocation to content retrieval from bundled assets.
- **LLM Loop**: Mock a conversation where the LLM:
  1. Receives a prompt with a skill list.
  2. Calls `read_skill`.
  3. Receives the content.
  4. Uses the content to generate a response.

### 3. Edge Cases

- **Case Sensitivity**: Test if `read_skill` handles case-insensitive skill names (e.g., "Frontend-Design" vs "frontend-design").
- **Empty Content**: Verify behavior when a skill exists in the registry but its `SKILL.md` is empty.
- **Special Characters**: Test skill names with spaces or special characters.

### 4. Security & Performance

- **Input Sanitization**: Verify that passing malicious strings (e.g., `../etc/passwd`) as `skillName` does not result in any file access outside the skill registry.
- **Latency**: Ensure the tool returns content in under 100ms.
