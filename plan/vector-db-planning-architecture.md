# Vector DB + Planning Architecture Implementation Plan

## Amplify (Amplify) — Detailed Implementation Guide

**Version:** 1.0  
**Date:** 2026-06-13  
**Scope:** Vector DB, Planning Architecture, Verification System, Chat Categorization

---

## 1. Executive Summary

This document details the implementation of five interconnected systems for Amplify:

1. **Vector DB (Orama)** — Replaces localStorage substring matching with BM25 full-text search for user profiles and project context. Dramatically reduces token consumption by sending only relevant context to the LLM instead of full data dumps.

2. **Planning Architecture** — Breaks complex tasks into sequential plan points, each executed as an independent sub-chat with isolated context windows. The AI follows a structured plan instead of operating on an ever-growing conversation.

3. **Verification System** — Enforces "Every button does something" and "Every screen is connected" rules via lint, type-check, and flow verification after each plan point completes.

4. **Chat Categorization** — Auto-categorizes chats into "Normal" (no workspace) and "Project" (workspace was invoked). Projects group related chats together.

5. **Auto-Start Services** — Ensures embedded services (skill directories, vector DB, MCP) initialize automatically when the app starts.

---

## 2. Vector DB Selection: Orama

### Why Orama

| Feature | Orama | Alternative (LanceDB) | Alternative (Chroma) |
|---------|-------|----------------------|---------------------|
| Browser-native | Yes (IndexedDB) | No (needs WASM) | No (needs server) |
| Full-text search | BM25 + stemming | Vector only | Hybrid |
| Bundle size | ~2KB | ~200KB | N/A (server) |
| Persistence | JSON serialization | Arrow format | SQLite |
| Edge runtime | Yes | Partial | No |
| Zero dependencies | Yes | No | No |

Orama was chosen because it:
- Works natively in the browser (IndexedDB persistence via `saveOramaToIDB`)
- Works on the server (Node.js)
- Provides BM25-ranked full-text search with stemming and stop-word removal
- Has a tiny footprint (~2KB gzipped)
- Supports `where` clause filtering by category/type
- Serializes to/from JSON for IndexedDB storage

### Architecture Decision: Client-Side Vector Stores

The vector stores operate **client-side** in the browser, persisted to IndexedDB. This is consistent with the existing architecture where:
- Memory is in `localStorage` (client-side)
- Chat history is in IndexedDB (client-side)
- The server receives pre-formatted context strings via the API request body

**Flow:**
```
User types message
    → Client queries UserProfileVectorStore (IndexedDB/Orama) → gets relevant user facts
    → Client queries ProjectContextVectorStore (if project chat) → gets relevant project context
    → Client sends: { messages, userContext, projectContext, ... } to /api/chat
    → Server injects userContext and projectContext into <user_context> and <project_context> XML tags
    → AI receives relevant context WITHOUT full data dump
```

---

## 3. New Files Created

### 3.1 Vector Store Module (`app/lib/vector-store/`)

| File | Purpose | Lines |
|------|---------|-------|
| `types.ts` | TypeScript interfaces for all vector store data types | ~100 |
| `persistence.ts` | IndexedDB save/load/delete for Orama databases | ~100 |
| `user-profile-store.ts` | User profile vector store (preferences, tech stack, coding style) | ~250 |
| `project-context-store.ts` | Per-project context vector store (requirements, errors, decisions, patterns) | ~300 |
| `index.ts` | Barrel export | ~15 |

**Key Design Decisions:**
- **Deduplication**: `UserProfileVectorStore.add()` performs BM25 search with 0.8 threshold. If a similar entry exists, it updates the timestamp and confidence instead of creating a duplicate.
- **Token Budget**: `formatContextForPrompt(query, maxTokens)` estimates tokens at 4 chars/token and stops adding entries when the budget is exhausted.
- **Category Priority**: Project context results are sorted by type priority: requirement > constraint > decision > error > fix > pattern > architecture > flow > file_context.
- **Per-Project Isolation**: `ProjectContextVectorStore` maintains a `Map<string, OramaDatabase>` where each project gets its own Orama instance. All are persisted to IndexedDB with key `vector_store_project_{projectId}`.

### 3.2 Planning Architecture (`app/lib/planning/`)

| File | Purpose | Lines |
|------|---------|-------|
| `types.ts` | Plan, PlanPoint, SubChat, VerificationResult types | ~200 |
| `plan-store.ts` | CRUD operations for plans, persisted to localStorage | ~250 |
| `sub-chat-engine.ts` | Executes plan points as independent sub-chats | ~350 |
| `index.ts` | Barrel export | ~15 |

**Key Design Decisions:**
- **Sequential Dependencies**: By default, each plan point depends on the previous one (`dependencies: index > 0 ? [previousPointId] : []`). This ensures linear execution but can be customized.
- **Verification as Default**: Every plan point runs `['lint', 'type_check', 'flow_verification']` by default, configurable per-point.
- **Context Extraction**: After each sub-chat completes, `extractContextFromSubChat()` stores summaries, modified files, and tool usage patterns in the `ProjectContextVectorStore`. This means future sub-chats can find this context via vector search.
- **Error Recovery**: If verification fails, the error results are sent back to the sub-chat for fixing. If fixing also fails, the point is marked as `failed` but execution continues with remaining points (unless they depend on the failed one).
- **Cancellation**: Uses `AbortController` for cancellation support.

### 3.3 Verification System (`app/lib/verification/`)

| File | Purpose | Lines |
|------|---------|-------|
| `types.ts` | VerificationResult, VerificationIssue types | ~30 |
| `runner.ts` | Orchestrates all verification checks | ~60 |
| `lint-checker.ts` | ESLint + basic pattern-based lint checks | ~150 |
| `type-checker.ts` | TypeScript type checking | ~100 |
| `flow-verifier.ts` | "Every button does something" + "Every screen is connected" | ~300 |
| `index.ts` | Barrel export | ~10 |

**"Every Button Does Something" Rules:**
1. Empty arrow function handlers: `onClick={() => {}}` → ERROR
2. Console-only handlers: `onClick={() => console.log(...)}` → ERROR
3. Placeholder links: `href="#"` → WARNING
4. Buttons without onClick/type/form → WARNING
5. Navigation to empty path → ERROR
6. Orphaned handler functions (defined but never connected to UI) → INFO

**"Every Screen Is Connected" Rules:**
1. Detects route definitions for: Remix (file-based), Next.js App Router, Next.js Pages Router, React Router (JSX)
2. Checks if newly created components are imported in any route file
3. Checks indirect connections (component A imports component B which is in a route)
4. Uses heuristics to determine if a file is a "screen" vs a shared component (has page structure, navigation, or heading)

### 3.4 Project Store (`app/lib/persistence/project-store/`)

| File | Purpose | Lines |
|------|---------|-------|
| `index.ts` | Chat/Project categorization, project CRUD | ~200 |

**Auto-Categorization Logic:**
1. Every chat starts as `category: 'chat'`
2. When the first workspace artifact is created (in `useChatHistory.storeMessageHistory()`), the chat is promoted to `category: 'project'`
3. A `Project` entry is created with the artifact title as the project name
4. The `chatId` is mapped to the `projectId` for quick lookup
5. Subsequent chats in the same project are linked via `linkChatToProject()`

### 3.5 Auto-Start Script (`scripts/auto-start-services.mjs`)

| File | Purpose | Lines |
|------|---------|-------|
| `auto-start-services.mjs` | Ensures skill directories exist, checks Orama dependency, reports status | ~80 |

Called automatically from `pre-start.cjs` before the dev server starts. Creates:
- `app/lib/skills/` (core skills)
- `user_skills/` (user-installed skills)
- `design/skills/` (bundled design skills)
- `design/design-systems/` (design system references)

### 3.6 Vector Context Hook (`app/lib/hooks/useVectorContext.ts`)

| File | Purpose | Lines |
|------|---------|-------|
| `useVectorContext.ts` | React hook for querying vector stores + utility functions for auto-extraction | ~130 |

---

## 4. Modified Files

### 4.1 Bug Fix: `list_skills` Tool (`app/lib/.server/llm/stream-text.ts`)

**Problem:** The `list_skills` and `get_skill` tools in `stream-text.ts` read directly from `design/skills/` using `fs.existsSync` and `fs.readdirSync`. Since this directory may not exist, the tool returns errors like `"skills directory not found"`. The MCP service has a proper `SkillLoader` that loads from all configured directories with error handling, but `stream-text.ts` doesn't use it.

**Fix:** Changed both tools to dynamically import `SkillLoader.getInstance()` and use `loader.getSkills()` / `loader.getSkillContent()`. This means:
- Skills are loaded from all 3 directories (core, design, user)
- Missing directories don't cause errors (SkillLoader creates them)
- The MCP and hardcoded tools now use the same source of truth

### 4.2 System Prompt Integration (`app/lib/common/prompts/new-prompt.ts`)

**Added:** Two new XML sections in the system prompt:
```xml
<user_context>
  [preference] User prefers TypeScript over JavaScript
  [tech_stack] User commonly works with React and Next.js
</user_context>

<project_context>
  [REQUIREMENT] Login screen must have email + password fields
  [ERROR] TypeError: Cannot read property 'map' of undefined in src/components/UserList.tsx
  [FIX] Added optional chaining and null check before .map() call
  [DECISION] Using Zustand for state management (chosen over Redux for simplicity)
</project_context>
```

### 4.3 Prompt Library (`app/lib/common/prompt-library.ts`)

**Added:** `userContext?: string` and `projectContext?: string` to `PromptOptions` interface.

### 4.4 LLM Pipeline (`app/lib/.server/llm/stream-text.ts`)

**Added:** `userContext` and `projectContext` parameters to `streamText()` function, passed through to `PromptLibrary.getPropmtFromLibrary()`.

### 4.5 API Route (`app/routes/api.chat.ts`)

**Added:** `userContext` and `projectContext` fields to the request body type and destructuring. Both are passed to both `streamText()` calls (initial and continuation).

### 4.6 Chat Component (`app/components/chat/Chat.client.tsx`)

**Added:**
- Import for `useVectorContext` and `projectStore`
- State variables `vectorUserContext` and `vectorProjectContext`
- `useEffect` that queries vector stores when message count changes:
  - Initializes `UserProfileVectorStore`
  - Gets last user message as query
  - Searches user profile for relevant context (500 token budget)
  - Checks if chat is a project chat
  - If project, searches project context (1000 token budget)
  - Updates state variables (passed to `useChat({ body: {...} })`)
- `userContext` and `projectContext` added to `useChat` body

### 4.7 Chat History (`app/lib/persistence/useChatHistory.ts`)

**Added:** Auto-promotion logic: when `firstArtifact` is detected and `projectInitiated` was previously false, dynamically imports `projectStore` and calls `promoteChatToProject()`.

### 4.8 MCP Service (`app/lib/services/mcpService.ts`)

**Added 4 new AI-callable tools:**
1. `search_user_context` — Search user profile vector store for relevant facts
2. `store_user_fact` — Store a new user preference/fact in the vector store
3. `search_project_context` — Search project context vector store
4. `store_project_context` — Store project requirement, decision, error, pattern, etc.

### 4.9 Package Configuration

- `package.json`: Added `"@orama/orama": "^3.1.0"` to dependencies
- `pre-start.cjs`: Added auto-start services script execution before dev server starts

---

## 5. Data Flow Diagrams

### 5.1 Normal Chat Flow (No Project)

```
User types message
    ↓
useVectorContext effect triggers
    ↓
UserProfileVectorStore.search(lastMessage, budget: 500)
    ↓
No project detected → projectContext = ""
    ↓
useChat body: { messages, userContext, projectContext: undefined, ... }
    ↓
POST /api/chat
    ↓
streamText() builds system prompt with:
    <user_memory>...</user_memory>        (legacy, still works)
    <user_context>...</user_context>     (NEW: vector-searched, relevant only)
    ↓
LLM receives personalized context
```

### 5.2 Project Chat Flow

```
User types message in project chat
    ↓
useVectorContext effect triggers
    ↓
UserProfileVectorStore.search(lastMessage, budget: 500) → userContext
ProjectContextVectorStore.search(projectId, lastMessage, budget: 1000) → projectContext
    ↓
useChat body: { messages, userContext, projectContext, ... }
    ↓
POST /api/chat
    ↓
streamText() builds system prompt with:
    <user_memory>...</user_memory>           (legacy)
    <user_context>...</user_context>        (NEW)
    <project_context>                       (NEW)
      [REQUIREMENT] Login must support OAuth
      [DECISION] Using NextAuth for auth
      [ERROR] Previous: Cannot find module 'next-auth'
      [FIX] Installed next-auth@5
      [PATTERN] All API routes follow /api/v1/ prefix
    </project_context>
    ↓
LLM receives full project context without full conversation dump
```

### 5.3 Plan Execution Flow

```
User: "Implement a login screen with email/password"
    ↓
AI creates a Plan:
    Plan: "Login Screen Implementation"
    ├─ Point 0: Create Login component with email/password form
    │   expectedFiles: [src/components/Login.tsx]
    │   verification: [lint, type_check, flow_verification]
    ├─ Point 1: Create auth utility functions
    │   expectedFiles: [src/lib/auth.ts]
    │   verification: [lint, type_check]
    ├─ Point 2: Create auth context provider
    │   expectedFiles: [src/contexts/AuthContext.tsx]
    │   verification: [lint, type_check, flow_verification]
    └─ Point 3: Integrate login into app routes
        expectedFiles: [src/app/login/page.tsx, src/app/layout.tsx]
        verification: [lint, type_check, flow_verification, build_check]

    ↓
Execute Plan (Sub-Chat Engine):
    ↓
    Point 0: Sub-Chat
    ├── System prompt includes: project context from vector DB, previous points summary
    ├── AI implements Login.tsx
    ├── Verification runs:
    │   ✅ Lint: passed
    │   ✅ Type check: passed
    │   ✅ Flow: "Every button does something" → passed (form onSubmit calls handleSubmit)
    ├── Context extracted: summary, modified files, tool usage → stored in ProjectContextVectorStore
    └── Marked as completed

    ↓
    Point 1: Sub-Chat
    ├── System prompt includes: project context (now includes Point 0's summary via vector DB)
    ├── AI implements auth.ts
    ├── Verification: passed
    ├── Context extracted
    └── Marked as completed

    ↓
    ... (Points 2, 3 similar)

    ↓
All points completed → AI returns to main chat with summary
```

---

## 6. Token Consumption Analysis

### Before (Current System)

| Component | Tokens per request | Notes |
|-----------|-------------------|-------|
| System prompt | ~2000 | Fixed |
| User memory (full dump) | ~200-500 | All memories sent every time |
| Chat history (full) | ~5000-50000 | Grows unbounded |
| Context files | ~1000-5000 | Selected by AI |
| **Total per request** | **~8000-57000** | |

### After (Vector DB System)

| Component | Tokens per request | Notes |
|-----------|-------------------|-------|
| System prompt | ~2000 | Fixed + new context sections |
| User context (vector-searched) | ~100-500 | Only relevant facts, 500 token budget |
| Project context (vector-searched) | ~200-1000 | Only relevant context, 1000 token budget |
| Chat history | Same as before | Unchanged (context optimization handles this) |
| Context files | Same as before | Unchanged |
| **Total per request** | **~2300-5500** | For context injection part |

**Savings: ~70-90% reduction in context-related token consumption.**

### Plan Execution (Sub-Chats)

| Component | Tokens per sub-chat | Notes |
|-----------|-------------------|-------|
| Sub-chat system prompt | ~1500 | Includes project context from vector DB |
| User instruction (point description) | ~200-500 | Just the point, not the whole conversation |
| Vector-searched project context | ~200-1000 | Relevant to this specific point |
| **Total per sub-chat** | **~1900-3000** | vs ~8000-57000 for full conversation |

---

## 7. AI Tools Added

### 7.1 Vector Store Tools (MCP Service)

| Tool | Description | When AI Uses It |
|------|-------------|-----------------|
| `search_user_context` | Search user profile for preferences, tech stack, coding style | When AI wants to personalize response |
| `store_user_fact` | Store a discovered user preference | When AI notices a pattern in user's requests |
| `search_project_context` | Search project for requirements, errors, decisions, patterns | When AI needs project-specific knowledge |
| `store_project_context` | Store project context (requirement, error, fix, decision, pattern) | After making a decision, encountering an error, etc. |

### 7.2 Fixed Tools

| Tool | Issue | Fix |
|------|-------|-----|
| `list_skills` | Read from filesystem directly, returned error if `design/skills/` didn't exist | Now uses `SkillLoader.getInstance().getSkills()` |
| `get_skill` | Same issue as `list_skills` | Now uses `SkillLoader.getInstance().getSkillContent()` |

---

## 8. Integration with Existing Systems

### 8.1 Backward Compatibility

- The existing `MemoryStore` (localStorage, substring search) continues to work
- The `<user_memory>` XML tag is still populated from `MemoryStore`
- The new `<user_context>` tag is populated from `UserProfileVectorStore`
- Both coexist — the AI sees both sections in the system prompt
- Over time, the vector store will become the primary source as more data is stored there

### 8.2 Chat History Persistence

- No changes to the IndexedDB schema for `chats` and `snapshots` stores
- The vector store uses its own separate IndexedDB database (`amplify_vector_stores`)
- Project categorization uses localStorage (`amplify_projects`)
- Plan data uses localStorage (`amplify_plans`)

### 8.3 WebContainer Integration

- Verification system uses `runShellCommand` from WebContainer for lint/type-check
- The `SubChatExecutionEngine` needs to be wired to the actual WebContainer instance
- This wiring happens in the chat component where the workbench is available

---

## 9. Future Work / Phase 2

1. **Planning UI** — Visual plan viewer showing plan points, their status, and sub-chat logs
2. **Projects List Sidebar** — A sidebar panel showing all projects with their related chats
3. **Auto-Context Extraction** — After each AI response, automatically extract user preferences, project decisions, and errors into the vector stores
4. **Embedding Search** — Upgrade Orama from BM25 to vector embeddings (requires an embedding model)
5. **Cross-Session Project Context** — Export/import project context between sessions
6. **Plan Templates** — Predefined plan structures for common tasks (CRUD app, auth flow, etc.)
7. **Sub-Chat Streaming** — Stream sub-chat progress to the UI in real-time
8. **Flow Graph Visualization** — Visual graph of screen connections and navigation flows

---

## 10. File Change Summary

### New Files (17 files)

```
app/lib/vector-store/types.ts
app/lib/vector-store/persistence.ts
app/lib/vector-store/user-profile-store.ts
app/lib/vector-store/project-context-store.ts
app/lib/vector-store/index.ts
app/lib/planning/types.ts
app/lib/planning/plan-store.ts
app/lib/planning/sub-chat-engine.ts
app/lib/planning/index.ts
app/lib/verification/types.ts
app/lib/verification/runner.ts
app/lib/verification/lint-checker.ts
app/lib/verification/type-checker.ts
app/lib/verification/flow-verifier.ts
app/lib/verification/index.ts
app/lib/persistence/project-store/index.ts
app/lib/hooks/useVectorContext.ts
scripts/auto-start-services.mjs
```

### Modified Files (8 files)

```
app/lib/.server/llm/stream-text.ts        — Fixed list_skills, added userContext/projectContext params
app/lib/common/prompt-library.ts          — Added userContext/projectContext to PromptOptions
app/lib/common/prompts/new-prompt.ts      — Added <user_context> and <project_context> to system prompt
app/routes/api.chat.ts                     — Added userContext/projectContext to request handling
app/components/chat/Chat.client.tsx        — Integrated vector context querying and passing
app/lib/persistence/useChatHistory.ts     — Added auto-promotion of chat to project
app/lib/services/mcpService.ts            — Added 4 vector store tools
package.json                               — Added @orama/orama dependency
pre-start.cjs                              — Added auto-start services call
```

### Created Directories (4 dirs)

```
app/lib/skills/             — Core skills (auto-created by auto-start script)
user_skills/                — User-installed skills
design/skills/              — Bundled design skills
design/design-systems/      — Design system references
```