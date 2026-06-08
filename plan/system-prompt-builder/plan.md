# Plan: Implement SystemPromptBuilder

## Overview

The `SystemPromptBuilder` is the orchestrator that assembles the complex system prompt required for the LLM to function as a "Claude-like" agent. It ensures that all necessary context (skills, memory, tools, and environment) is injected in the correct format.

## Implementation Details

### 1. Prompt Components

The builder will assemble the prompt from the following sources:

#### A. Base Persona

- A static or configurable set of core instructions defining the AI's identity, tone, and general constraints.

#### B. Skill Registry (`<available_skills>`)

- Call `SkillLoader.buildSystemPromptBlock()` to get the XML list of available skills.
- Inject this block with a header explaining how to use skills.

#### C. User Memory

- Call `MemoryStore.load()` to retrieve persistent facts about the user.
- Format these as a bulleted list under a `## Memory` section.

#### D. Environmental Context

- Inject current UTC time and timezone.
- Inject user location (if available).
- Describe the filesystem layout (`/workspace/` vs `/chat/`).

#### E. Tool Definitions

- Inject the JSON schemas for all available tools (bash, read_file, create_file, etc.).

### 2. Assembly Logic

I will implement a `buildSystemPrompt` function:

```typescript
async function buildSystemPrompt(conversationId: string): Promise<string> {
  const persona = await loadPersona();
  const skills = await skillLoader.buildSystemPromptBlock();
  const memory = await memoryStore.formatForPrompt();
  const context = getEnvContext();

  return `
${persona}

## Your Skills
${skills}

## Memory
${memory}

## Environment
${context}

## Available Tools
[Tool Definitions]
`.trim();
}
```

### 3. Integration

- The `SystemPromptBuilder` will be called at the start of every new conversation.
- It will be integrated into the API request pipeline, ensuring the `system` message of the LLM call contains the generated prompt.

## Verification Plan

- [ ] Log the generated system prompt to the console and verify all sections (Persona, Skills, Memory, Context) are present.
- [ ] Verify that adding a new skill to `index.json` automatically updates the generated prompt.
- [ ] Verify that updating user memory reflects in the prompt for the next conversation.
- [ ] Ensure the prompt size remains within the model's context window limits.
