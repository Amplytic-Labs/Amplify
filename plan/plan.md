# Claude Capabilities System & Silent Chat Workspace Architecture

> Reference doc for building a Claude alternative on Amplify

---

## Part 1: How Claude's Capabilities Actually Work

Understanding this is the prerequisite before designing your own system.

---

### 1.1 The Tools Layer

Tools are **functions Claude can call** during a response. They are declared at the API level via the `tools` array. Claude decides when to invoke them based on the conversation context.

#### Native Tools Claude Has

| Tool                  | What It Does                                                      | How Invoked                                  |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `bash_tool`           | Execute shell commands in a sandboxed Linux (Ubuntu 24) container | Claude writes code, runs it, reads stdout    |
| `create_file`         | Write a new file to the container filesystem                      | Claude calls it with path + content          |
| `str_replace`         | Edit an existing file (find + replace a unique string)            | Claude calls with old_str / new_str          |
| `view`                | Read a file or directory listing (with line numbers)              | Claude calls with path                       |
| `web_search`          | Search the web, returns top ~10 results                           | Claude calls with a query string             |
| `web_fetch`           | Fetch a full URL's content                                        | Claude calls with exact URL                  |
| `user_location_v0`    | Get the user's current location                                   | Claude calls when location context needed    |
| `user_time_v0`        | Get current time + timezone                                       | Claude calls before scheduling anything      |
| `event_create_v1`     | Create a calendar event                                           | Claude calls with structured event data      |
| `alarm_create_v0`     | Set an alarm                                                      | Claude calls with time + label               |
| `timer_create_v0`     | Start a countdown timer                                           | Claude calls with duration in seconds        |
| `map_display_v0`      | Render markers on a map                                           | Claude calls with lat/lng + labels           |
| `message_compose_v0`  | Draft an email or message                                         | Claude calls with body + kind                |
| `memory_user_edits`   | Read/write persistent memory about the user                       | Claude calls to store/retrieve facts         |
| `fetch_sports_data`   | Get live sports scores, standings, stats                          | Claude calls with league + data_type         |
| `search_mcp_registry` | Search for available MCP connectors                               | Claude calls before suggesting a connector   |
| `suggest_connectors`  | Show UI for user to connect an MCP app                            | Claude calls with UUIDs from registry search |

#### How Tool Invocation Works (Internal Flow)

```
User message
    ↓
Claude generates a response token stream
    ↓
When Claude decides a tool is needed:
    → Emits a function_call block (not shown to user)
    → Execution halts
    → Tool runs, returns result
    → Result injected back into context
    → Claude continues generating
```

Claude does **not** blindly call tools. It reasons about whether a tool call is necessary. This is the "chain-of-thought before tool use" pattern.

---

### 1.2 The Skills Layer

Skills are **markdown instruction files** that tell Claude _how_ to do something specialized. They are not code — they are knowledge/procedure documents loaded into Claude's context when relevant.

#### Skill File Structure

```
skill-name/
├── SKILL.md              ← Required. YAML frontmatter + instructions
├── references/           ← Optional. Large docs loaded on-demand
│   └── specific-topic.md
├── scripts/              ← Optional. Runnable Python/bash helpers
│   └── do_thing.py
└── assets/               ← Optional. Templates, fonts, icons
    └── template.docx
```

#### SKILL.md Anatomy

```markdown
---
name: skill-identifier
description: >
  When to trigger this skill. What it does. This text is always
  in context. Claude reads it to decide whether to load the full skill.
  Be specific and "pushy" — list all trigger phrases and contexts.
compatibility: claude.ai, Claude Code, Cowork
---

# Skill Title

## What to do

Step by step instructions...

## Reference files

- See references/advanced.md for edge cases
- Run scripts/generate.py for output generation
```

#### Progressive Loading (3 Levels)

```
Level 1: Metadata (name + description)
    → Always in Claude's context
    → ~100 words
    → Used to decide IF skill applies

Level 2: SKILL.md body
    → Loaded when skill triggers
    → Ideal < 500 lines
    → Contains the actual procedure

Level 3: Bundled resources (references/, scripts/, assets/)
    → Loaded only when explicitly needed mid-task
    → No size limit
    → Scripts can execute without being loaded into context
```

#### How Skill Triggering Works

Claude sees a list of available skills in its context like this:

```xml
<available_skills>
  <skill>
    <name>docx</name>
    <description>Use this skill whenever... [full description]</description>
    <location>/mnt/skills/public/docx/SKILL.md</location>
  </skill>
  ...
</available_skills>
```

Claude reads the descriptions, matches against the user's request, then calls `view` on the relevant SKILL.md before writing any code or output. **The skill path is just a real filesystem path.** Claude uses `view` (the same tool it uses for everything else) to read it.

#### Real Skills Claude Has

| Skill                    | Triggers When                                     |
| ------------------------ | ------------------------------------------------- |
| `docx`                   | Creating/editing Word documents                   |
| `pptx`                   | Creating/editing PowerPoint presentations         |
| `xlsx`                   | Creating/editing Excel spreadsheets               |
| `pdf`                    | Creating, merging, splitting PDFs                 |
| `pdf-reading`            | Extracting/reading from PDF files                 |
| `file-reading`           | Any uploaded file needs to be read (router skill) |
| `frontend-design`        | Building UI components, web pages, artifacts      |
| `product-self-knowledge` | Questions about Claude/Anthropic products         |
| `skill-creator`          | Creating or improving new skills                  |

---

### 1.3 The Artifacts Layer

Artifacts are **rendered outputs** shown in a panel next to the chat. Not all files are artifacts — an artifact is specifically a file written to `/mnt/user-data/outputs/` with a renderable extension.

#### Renderable Artifact Types

| Extension  | Renders As                            |
| ---------- | ------------------------------------- |
| `.md`      | Formatted markdown document           |
| `.html`    | Live HTML/CSS/JS in sandboxed iframe  |
| `.jsx`     | Live React component with hot preview |
| `.svg`     | Inline vector graphic                 |
| `.mermaid` | Diagram                               |
| `.pdf`     | PDF viewer                            |

#### Artifact Lifecycle

```
1. Claude writes code/content
2. Claude calls create_file → /mnt/user-data/outputs/filename.ext
3. UI detects the new file in /outputs
4. UI renders it in the artifact panel
5. User can view, download, or copy
```

Non-artifact files (working files, temp files) go to `/home/claude/` — user never sees them. Only `/mnt/user-data/outputs/` files get the panel treatment.

#### The Computer Use Abstraction

The entire filesystem is mounted in a specific layout:

```
/mnt/user-data/uploads/    ← User-uploaded files (read-only from Claude's side)
/mnt/user-data/outputs/    ← Claude's deliverables (shown to user)
/mnt/skills/public/        ← Public skill library (read-only)
/mnt/skills/examples/      ← Example skills (read-only)
/home/claude/              ← Claude's scratch workspace (not shown to user)
```

This is the key insight: **visibility is controlled purely by directory**. Files in `/home/claude/` are invisible to the user. Files in `/outputs/` are surfaced. Skills in `/mnt/skills/` are just files Claude reads.

---

### 1.4 The System Prompt Layer

Above all of this is the **system prompt**, which is where:

- Available tools are declared
- Available skills are listed (as `<available_skills>` XML)
- Filesystem mount layout is described
- Behavioral instructions live
- Memory (user facts) is injected
- Current time, user location, and context are injected

The system prompt is the "OS boot sequence" of each conversation.

---

## Part 2: Revised Integrated Architecture

Now that we have analyzed the existing Amplify infrastructure, we are pivoting from a "replacement" strategy to an "integration" strategy. Instead of building a parallel system, we will extend the existing production-grade services.

### 2.1 Core Concept: Integration over Replacement

The goal is to implement Claude-like capabilities (Skills, Memory, Artifacts) by augmenting the existing Amplify pipeline.

**Key Architectural Shifts:**

- **No Virtual FS**: We will not use a `/chat/` directory in WebContainer because it is ephemeral. Skills will be bundled as static assets or fetched via API.
- **MCP-First Tools**: All new capabilities (like reading skills or updating memory) will be implemented as **MCP Tools** using the existing `MCPService`.
- **Prompt Extension**: Instead of a new builder, we will extend the `PromptLibrary` to inject skills and memory into the system prompt.
- **Artifact Augmentation**: We will extend the existing `StreamingMessageParser` and `Artifact` components rather than rebuilding the artifact system.

### 2.2 The Skill System (Bundled & Token-Aware)

Skills are procedural markdown documents. To avoid context overflow, we implement a **Token Budget**.

**Skill Lifecycle:**

1. **Registry**: A JSON index of skills (name, description, path) is loaded at startup.
2. **Discovery**: The `SkillLoader` injects a compact list of available skills into the system prompt.
3. **Loading**: The LLM calls an MCP tool `read_skill(name)` to load the full procedural instructions only when needed.
4. **Budgeting**: The `SkillLoader` tracks token usage and only injects skills that fit within the remaining context window.

### 2.3 Prompt Integration (Extending PromptLibrary)

We will modify `app/lib/common/prompt-library.ts` to support dynamic injections.

**Injection Flow:**
`PromptLibrary.getPrompt()`
-> `Base Persona`
-> `Skill Context` (via SkillLoader)
-> `User Memory` (via MemoryStore)
-> `Environmental Context` (Time, Location)

### 2.4 Persistent Memory System

Since WebContainer is ephemeral, memory must be stored in a persistent layer.

**Storage Strategy:**

- **Local**: `localStorage` for quick, client-side persistence.
- **Cloud**: Appwrite collection (keyed by User ID) for cross-device synchronization.
- **Interface**: A `MemoryStore` class providing `load()`, `add()`, and `remove()` methods.
- **LLM Access**: An MCP tool `update_user_memory` allows the AI to save facts about the user.

### 2.5 Enhanced Artifact System

We will leverage the existing `<amplifyArtifact>` and `<amplifyAction>` infrastructure.

**Extensions:**

- **New Renderers**: Add support for `.md`, `.svg`, and `.mermaid` in the Artifact panel.
- **Versioning**: Implement a version history for artifacts, allowing users to switch between different iterations of a generated file.
- **Export**: Add "Download" and "Copy" functionality to the Artifact UI.

---

## Part 3: Revised Implementation Roadmap

We will implement these changes incrementally to avoid breaking the existing working system.

### Phase 0: Foundation & Security (Week 1)

- [ ] **Infrastructure Audit**: Map all existing prompt and tool flows.
- [ ] **Token Budgeting**: Implement a token counter for the system prompt.
- [ ] **Security Hardening**: Implement path normalization for all file-reading tools to prevent traversal attacks.
- [ ] **Skill Schema**: Define the procedural `SKILL.md` format.

### Phase 1: Core Skills & Prompting (Weeks 2-3)

- [ ] **Extend PromptLibrary**: Add hooks for skill and memory injection.
- [ ] **Implement SkillLoader**: Load skills from bundled assets.
- [ ] **Write Procedural Skills**: Create 3-5 high-quality, step-by-step skills.
- [ ] **MCP Integration**: Add `read_skill` as an MCP tool.

### Phase 2: Persistent Memory (Week 4)

- [ ] **Implement MemoryStore**: Setup `localStorage` / Appwrite persistence.
- [ ] **Memory MCP Tools**: Add `update_user_memory` and `read_user_memory` tools.
- [ ] **Memory UI**: Create a settings page for users to manage their stored facts.

### Phase 3: Artifact Enhancements (Weeks 5-6)

- [ ] **Extend Renderers**: Add Markdown, SVG, and Mermaid support to the Artifact panel.
- [ ] **Implement Versioning**: Track and store versions of generated artifacts.
- [ ] **UI Polish**: Add download/copy buttons to the artifact view.

### Phase 4: Platform Features (Month 3+)

- [ ] **Skill Marketplace**: Implement `.skill` bundle format and installation UI.
- [ ] **Trust Model**: Add verification and rating for community skills.
- [ ] **Per-Project Config**: Allow skill assignment per project.

---

## Appendix: Procedural Skill Template

Skills must be **procedural**, not just guidelines.

```markdown
---
name: skill-name
description: >
  When to trigger this skill. Be specific.
  Include trigger phrases: "Use when user says X, Y, Z".
---

# Skill Title

## Step 1: Analysis

- Do X
- Check for Y

## Step 2: Execution

- Apply Z
- Use pattern A

## Step 3: Verification

- Ensure B is present
- Check for C

## Output Format

Describe the exact structure of the expected output.
```

---

## Appendix: Skill Template

Copy this when writing a new skill:

```markdown
---
name: your-skill-name
description: >
  What this skill does and when to trigger it. Be specific.
  Include trigger phrases: "Use when user says X, Y, Z".
  Include anti-triggers: "Do NOT use for A, B, C".
---

# Skill Title

## Overview

One paragraph summary.

## When to Use

- Trigger condition 1
- Trigger condition 2

## Step-by-Step Process

### Step 1: [Name]

What to do first...

### Step 2: [Name]

What to do next...

## Output Format

Describe what the output should look like.

## Edge Cases

- Edge case 1: how to handle
- Edge case 2: how to handle

## Reference Files

- See references/advanced.md for complex scenarios
- Run scripts/generate.py to produce output files
```

---

_Built as architecture reference for a Amplify-based Claude alternative._
