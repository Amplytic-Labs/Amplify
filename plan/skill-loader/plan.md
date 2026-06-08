# Plan: Implement SkillLoader (Integrated & Token-Aware)

## Overview

The `SkillLoader` is responsible for managing the discovery and loading of "Skills" (procedural markdown instructions). Unlike the previous version, it now integrates with the existing `PromptLibrary` and implements a token budget to prevent context overflow.

## Implementation Details

### 1. Skill Source & Registry

Skills will no longer be stored in a virtual filesystem. Instead:

- **Core Skills**: Bundled as static assets within the application build.
- **User Skills**: Fetched from a database (Appwrite) or loaded from `localStorage`.
- **Registry**: A JSON index (name, description, path/ID) is used for discovery.

### 2. Token Budget Management

To prevent the system prompt from exceeding the LLM's context window:

- **Budget Allocation**: Define a `maxSkillTokens` limit (e.g., 20% of the total context window).
- **Prioritization**: Skills are injected based on relevance or a priority score.
- **Counting**: Use a tokenizer (e.g., `tiktoken` or provider-specific) to count tokens in the skill metadata before injection.

### 3. Integration with PromptLibrary

The `SkillLoader` will not build its own prompt. Instead, it will provide a `SkillContext` object to the `PromptLibrary`.

**Flow:**
`PromptLibrary.getPrompt()` $\rightarrow$ calls `SkillLoader.getRelevantSkills()` $\rightarrow$ injects compact XML/Markdown list into the base prompt.

### 4. Skill Content Retrieval

Full skill content is retrieved on-demand via an MCP tool (`read_skill`).

- **Security**: Since skills are now bundled or DB-backed, the `read_skill` tool will use a lookup table (ID $\rightarrow$ Content) rather than direct filesystem paths, eliminating path traversal risks.

## Testing Plan

### 1. Unit Tests

- **Registry Loading**: Verify `loadRegistry()` handles missing, empty, or malformed JSON files without crashing.
- **Token Counting**: Verify the tokenizer accurately counts tokens for various skill descriptions and matches provider-specific counts.
- **Budget Logic**: Verify `getRelevantSkills()` returns the maximum number of skills that fit within the `maxSkillTokens` limit.
- **Prioritization**: Verify that skills with higher priority scores are selected over lower priority ones when the budget is tight.

### 2. Integration Tests

- **PromptLibrary Handshake**: Verify that `PromptLibrary.getPrompt()` correctly calls `SkillLoader` and the resulting system prompt contains the expected skill list.
- **MCP Tool Linkage**: Verify that the `read_skill` MCP tool correctly invokes `SkillLoader.getSkillContent()` and returns the expected markdown.

### 3. Edge Cases

- **Empty Registry**: Ensure the system functions normally when no skills are available.
- **Oversized Skills**: Test behavior when a single skill's metadata exceeds the entire token budget.
- **Invalid IDs**: Verify that requesting a non-existent skill ID returns a clean "Not Found" error.

### 4. Performance & Security

- **Latency**: Measure the time taken to filter and inject skills; it must not add more than 50ms to the prompt generation.
- **Isolation**: Verify that `SkillLoader` cannot be tricked into reading files outside of the bundled assets or DB records.
