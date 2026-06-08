# Plan: Extend PromptLibrary for Skill & Memory Injection

## Overview

Instead of building a separate `SystemPromptBuilder`, we will extend the existing `PromptLibrary` (`app/lib/common/prompt-library.ts`). This ensures that skills and memory are available across all prompt variants (default, optimized, etc.) and maintains consistency with the existing prompt management system.

## Implementation Details

### 1. Integration Point

I will modify the `PromptLibrary` class to accept an optional `ContextOptions` object during prompt retrieval.

**Proposed Method Signature:**

```typescript
static getPrompt(promptId: string, options: PromptOptions, context?: {
  skills?: SkillContext;
  memory?: UserMemory;
  env?: EnvContext;
})
```

### 2. Injection Logic

The `PromptLibrary` will now perform a multi-stage assembly:

1. **Base Prompt**: Retrieve the base system prompt from the library based on `promptId`.
2. **Skill Injection**:
   - Call `SkillLoader.getRelevantSkills()` to get a compact list of available skills.
   - Append this list to the prompt under a `## Available Skills` section.
3. **Memory Injection**:
   - Call `MemoryStore.formatForPrompt()` to get user facts.
   - Append this to the prompt under a `## User Memory` section.
4. **Environmental Context**:
   - Inject current time, timezone, and workspace layout.

### 3. Token Budgeting

To prevent context overflow, the `PromptLibrary` will coordinate with the `SkillLoader` to truncate the skill list if the total prompt size exceeds the model's limit.

### 4. Integration with API

The `api.chat.ts` route will be updated to:

1. Initialize `SkillLoader` and `MemoryStore`.
2. Pass the resulting context into `PromptLibrary.getPrompt()`.
3. Send the final assembled prompt to the LLM.

## Testing Plan

### 1. Unit Tests

- **Assembly Logic**: Verify that `getPrompt()` correctly concatenates the base prompt, skills, memory, and environment context in the correct order.
- **Variant Support**: Verify that skills and memory are injected regardless of the `promptId` used (e.g., 'default' vs 'optimized').
- **Null Handling**: Verify that the prompt remains valid even if `skills` or `memory` are empty or undefined.

### 2. Integration Tests

- **End-to-End Prompt Flow**: Trace a request from `api.chat.ts` $\rightarrow$ `PromptLibrary` $\rightarrow$ `SkillLoader`/`MemoryStore` and verify the final string sent to the LLM.
- **Token Budget Enforcement**: Mock a scenario with 50 skills and verify that the `PromptLibrary` truncates the list to fit the model's context window.

### 3. Edge Cases

- **Extreme Memory Size**: Test behavior when the user has hundreds of stored facts.
- **Conflicting Instructions**: Verify that injected skills do not contradict the base persona instructions.
- **Empty Base Prompt**: Ensure the system doesn't crash if a `promptId` is requested that doesn't exist in the library.

### 4. Performance

- **Generation Latency**: Measure the time to assemble the final prompt; it must be negligible (< 20ms).
- **Memory Overhead**: Ensure that the `ContextOptions` object doesn't cause memory leaks during high-concurrency chat sessions.
