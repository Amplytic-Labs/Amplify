# Plan: Implement Memory System (MemoryStore)

## Overview

The Memory System allows the AI to remember facts about the user across different conversations (e.g., "The user prefers TypeScript over JavaScript", "The user is working on a project called CampusSwap"). This creates a personalized experience.

## Implementation Details

### 1. Storage Backend

Initially, memory will be stored in a JSON file at `/chat/memory/user.json`. For production, this will migrate to an Appwrite collection.

**Data Schema:**

```json
[
  {
    "key": "preferred_language",
    "value": "TypeScript",
    "addedAt": "2026-06-08T10:00:00Z"
  }
]
```

### 2. MemoryStore Class Design

I will implement a `MemoryStore` class with the following methods:

#### A. `load()`

- Read the `user.json` file.
- Parse and return the array of `UserFact` objects.

#### B. `add(key, value)`

- Load existing facts.
- Check if the key already exists; if so, update the value. Otherwise, push a new fact.
- Write the updated array back to the file.

#### C. `remove(key)`

- Filter out the fact with the matching key.
- Write the updated array back to the file.

#### D. `formatForPrompt(facts)`

- Convert the array of facts into a human-readable string for the system prompt.
- Example: `"- preferred_language: TypeScript\n- project_name: CampusSwap"`

### 3. Integration

- **System Prompt**: The `SystemPromptBuilder` will call `MemoryStore.formatForPrompt()` and inject the result into the `## Memory` section.
- **LLM Interaction**: The LLM will be given a tool (e.g., `update_user_memory`) to explicitly save new facts it learns about the user during a conversation.

## Verification Plan

- [ ] Call `add('name', 'Imtiaz')` and verify the `user.json` file is updated.
- [ ] Call `load()` and verify the correct facts are retrieved.
- [ ] Call `formatForPrompt()` and verify the output is a clean bulleted list.
- [ ] Verify that the `SystemPromptBuilder` correctly includes these facts in the final prompt.
