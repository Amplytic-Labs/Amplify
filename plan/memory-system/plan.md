# Plan: Implement Persistent Memory System

## Overview

The Memory System allows the AI to remember facts about the user across different conversations. To ensure persistence in the ephemeral WebContainer environment, we will use a combination of `localStorage` and a backend database (Appwrite).

## Implementation Details

### 1. Storage Strategy

- **Client-Side**: Use `localStorage` for immediate, low-latency access to user facts.
- **Cloud-Side**: Use an Appwrite collection (keyed by User ID) for cross-device synchronization and permanent storage.
- **Sync Logic**: On startup, the app will sync `localStorage` with the Appwrite backend.

### 2. MemoryStore Class Design

I will implement a `MemoryStore` class with the following methods:

#### A. `load()`

- Retrieve facts from `localStorage`.
- Return an array of `UserFact` objects.

#### B. `add(key, value)`

- Update the local `localStorage` cache.
- Trigger an asynchronous update to the Appwrite backend.

#### C. `remove(key)`

- Remove the fact from `localStorage`.
- Trigger a deletion in the Appwrite backend.

#### D. `formatForPrompt(facts)`

- Convert the facts into a concise bulleted list for the system prompt.
- Example: `"- preferred_language: TypeScript\n- project_name: CampusSwap"`

### 3. Integration

#### A. Prompt Injection

The `PromptLibrary` will call `MemoryStore.formatForPrompt()` and inject the result into the system prompt.

#### B. MCP Tooling

I will implement two MCP tools to allow the LLM to manage memory:

- `update_user_memory(key, value)`: Allows the AI to save a new fact.
- `read_user_memory()`: Allows the AI to retrieve all stored facts.

## Testing Plan

### 1. Unit Tests

- **Local Storage**: Verify `load()`, `add()`, and `remove()` correctly manipulate `localStorage` keys.
- **Prompt Formatting**: Verify `formatForPrompt()` handles empty lists, single facts, and multiple facts correctly.
- **Sync Logic**: Verify that the sync process correctly merges `localStorage` and Appwrite data (e.g., newest timestamp wins).

### 2. Integration Tests

- **MCP $\rightarrow$ MemoryStore**: Verify that calling the `update_user_memory` tool results in a new fact appearing in `localStorage` and the Appwrite DB.
- **Memory $\rightarrow$ Prompt**: Verify that adding a fact via the tool immediately reflects in the system prompt of the next message.
- **Cross-Device Sync**: Mock two different clients with the same User ID and verify that memory added on one appears on the other after a sync.

### 3. Edge Cases

- **Storage Limits**: Test behavior when `localStorage` is full.
- **Network Failure**: Verify that `add()` still works locally even if the Appwrite API call fails (eventual consistency).
- **Malformed Data**: Verify that corrupted JSON in `localStorage` is handled gracefully (reset to empty).

### 4. Privacy & Security

- **User Isolation**: Verify that User A cannot read or write to User B's memory.
- **Sanitization**: Ensure that memory values are sanitized to prevent prompt injection attacks (e.g., a user setting their name to "Ignore all previous instructions").
