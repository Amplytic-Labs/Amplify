# Claude Capabilities System & Silent Chat Workspace Architecture

> Reference doc for building a Claude alternative on bolt.diy

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

## Part 2: Your Silent Chat Workspace Design

Now that you understand the full system, here's how to replicate it in your bolt.diy fork.

---

### 2.1 Core Concept

```
bolt.diy has a "Project Workspace" (visible to user)
You want a "Chat Workspace" (invisible, per-conversation)

The chat workspace:
- Mounts on every new conversation
- Lives in /chat/ virtual directory
- Contains tools + skills
- Is never shown in the file explorer UI
- Is destroyed/reset between conversations
```

---

### 2.2 Directory Layout

```
/workspace/          ← bolt.diy's existing project workspace (unchanged, user sees this)
/chat/               ← Your new silent workspace (user never sees this)
├── skills/
│   ├── index.json           ← Skill registry (name, description, path)
│   ├── code-execution/
│   │   └── SKILL.md
│   ├── file-reading/
│   │   └── SKILL.md
│   ├── frontend-design/
│   │   └── SKILL.md
│   └── [your custom skills]/
├── tools/
│   └── definitions.json     ← Tool schemas (JSON Schema format for API)
├── memory/
│   └── user.json            ← Persistent user facts across sessions
├── context/
│   └── session.json         ← Per-session metadata (start time, model, etc.)
└── outputs/
    └── artifacts/           ← Generated artifacts (shown in artifact panel)
```

---

### 2.3 Initialization Flow

```
User starts new chat
    ↓
chatWorkspace.init(conversationId)
    ↓
1. Copy /chat/ template to /chat/sessions/{conversationId}/
2. Load skills/index.json → build <available_skills> XML block
3. Load tools/definitions.json → build tools[] array for API
4. Load memory/user.json → inject into system prompt
5. Compose system prompt (skills + tools + memory + instructions)
6. Send first API call with composed system prompt
    ↓
AI responds, calls tools, reads skills via virtual FS
```

---

### 2.4 Implementing the Silent Workspace in bolt.diy

#### Step 1: Hide /chat/ from the file explorer [ ] (Not Complete)

In bolt.diy's `FileTree` component, filter out `/chat/` from the displayed tree:

```typescript
// In your FileTree component
const HIDDEN_PATHS = ['/chat', '/chat/'];

function shouldShowFile(path: string): boolean {
  return !HIDDEN_PATHS.some((hidden) => path.startsWith(hidden));
}
```

Also hide it from the terminal (optional — patch the shell prompt to not cd into it).

#### Step 2: Build the skill injector [ ] (Not Complete)

```typescript
// chat/skills/SkillLoader.ts

interface SkillMeta {
  name: string;
  description: string;
  path: string;
}

class SkillLoader {
  private registry: SkillMeta[] = [];

  async init() {
    // Load the skill index
    const index = await fs.readFile('/chat/skills/index.json', 'utf-8');
    this.registry = JSON.parse(index);
  }

  // Generates the <available_skills> block for the system prompt
  buildSystemPromptBlock(): string {
    const items = this.registry
      .map(
        (skill) => `
  <skill>
    <name>${skill.name}</name>
    <description>${skill.description}</description>
    <location>${skill.path}</location>
  </skill>`,
      )
      .join('\n');

    return `<available_skills>\n${items}\n</available_skills>`;
  }

  // Called when AI requests to read a skill file
  async readSkill(path: string): Promise<string> {
    // Validate path is within /chat/skills/ (security)
    if (!path.startsWith('/chat/skills/')) {
      throw new Error('Skill path out of bounds');
    }
    return await fs.readFile(path, 'utf-8');
  }
}
```

#### Step 3: The skill read mechanism [ ] (Not Complete)

When the AI wants to read a skill, it should call your `read_file` tool with the skill path. You intercept this and serve from the virtual FS:

```typescript
// In your tool execution handler
async function executeToolCall(toolName: string, args: Record<string, any>) {
  switch (toolName) {
    case 'read_file': {
      const { path } = args;
      // Route /chat/skills/* to skill loader
      if (path.startsWith('/chat/skills/')) {
        return await skillLoader.readSkill(path);
      }
      // Route /workspace/* to bolt.diy's WebContainer FS
      return await webContainer.fs.readFile(path, 'utf-8');
    }
    // ... other tools
  }
}
```

#### Step 4: Compose the system prompt [ ] (Not Complete)

```typescript
// chat/SystemPromptBuilder.ts

async function buildSystemPrompt(conversationId: string): Promise<string> {
  const skills = await skillLoader.buildSystemPromptBlock();
  const memory = await memoryStore.load(); // user facts
  const time = new Date().toISOString();

  return `
You are an AI assistant with access to a coding workspace and a set of skills.

## Your Skills
${skills}

## Instructions for Skills
Before writing any code or creating any file, check if a relevant skill exists
in <available_skills>. If it does, call read_file on its <location> path first.
Follow the skill's instructions precisely.

## Memory
${memory ? `Facts about this user:\n${memory}` : 'No user memory yet.'}

## Current Time
${time}

## Workspace
You have access to a project workspace at /workspace/.
The user's files are there. Do not create files in /chat/ — that is your
internal directory and is not shown to the user.

## Available Tools
[tool list injected here by your API call builder]
`.trim();
}
```

#### Step 5: The artifact output path [ ] (Not Complete)

Map your artifact outputs to a path the UI watches:

```typescript
// When AI creates a file in /chat/outputs/artifacts/
// → your UI picks it up and renders in the artifact panel

const ARTIFACT_OUTPUT_PATH = '/chat/outputs/artifacts/';
const RENDERABLE_EXTENSIONS = ['.html', '.jsx', '.md', '.svg', '.mermaid', '.pdf'];

async function onFileCreated(path: string) {
  if (path.startsWith(ARTIFACT_OUTPUT_PATH)) {
    const ext = path.split('.').pop();
    if (RENDERABLE_EXTENSIONS.includes(`.${ext}`)) {
      artifactPanel.render(path);
    }
  }
}
```

---

### 2.5 Skills Index Format

```json
// /chat/skills/index.json
[
  {
    "name": "frontend-design",
    "description": "Create distinctive, production-grade frontend interfaces. Use when the user asks to build web components, pages, applications, or wants to style/beautify any web UI. Trigger for: websites, landing pages, dashboards, React components, HTML/CSS layouts.",
    "path": "/chat/skills/frontend-design/SKILL.md"
  },
  {
    "name": "code-execution",
    "description": "Use when the user asks to run code, execute a script, or needs output from a program. Handles Python, JavaScript, bash. Trigger for: 'run this', 'execute', 'what does this output', any runnable code snippet.",
    "path": "/chat/skills/code-execution/SKILL.md"
  },
  {
    "name": "file-reading",
    "description": "Use when a file has been uploaded and needs to be read. Routes by file type: PDF, DOCX, XLSX, CSV, images, archives. Trigger whenever a file path is mentioned that Claude hasn't read yet.",
    "path": "/chat/skills/file-reading/SKILL.md"
  }
]
```

---

### 2.6 Memory System [ ] (Not Complete)

```typescript
// chat/memory/MemoryStore.ts

interface UserFact {
  key: string;
  value: string;
  addedAt: string;
}

class MemoryStore {
  private path = '/chat/memory/user.json';

  async load(): Promise<UserFact[]> {
    try {
      const raw = await fs.readFile(this.path, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async add(key: string, value: string) {
    const facts = await this.load();
    facts.push({ key, value, addedAt: new Date().toISOString() });
    await fs.writeFile(this.path, JSON.stringify(facts, null, 2));
  }

  async remove(key: string) {
    const facts = await this.load();
    const filtered = facts.filter((f) => f.key !== key);
    await fs.writeFile(this.path, JSON.stringify(filtered, null, 2));
  }

  formatForPrompt(facts: UserFact[]): string {
    return facts.map((f) => `- ${f.key}: ${f.value}`).join('\n');
  }
}
```

Memory is stored outside the conversation — it persists to your Appwrite backend keyed by user ID.

---

## Part 3: Better Paths & Alternative Approaches

---

### Option A: Your Current Approach (Virtual FS in WebContainer)

**What you described** — `/chat/` directory inside bolt.diy's WebContainer.

✅ Pros:

- Skills are real files the AI can actually read via tool calls
- Exactly mirrors how Claude.ai works
- Skills can include runnable scripts
- Zero special casing needed — it's just filesystem reads

❌ Cons:

- WebContainer resets between page refreshes (need to re-init)
- Skills have to be bundled into the app or fetched at startup
- More complex to persist memory

**Verdict**: Best option if you want true fidelity to the Claude.ai model.

---

### Option B: System Prompt Template Injection (Simpler)

Instead of a virtual FS, just embed skill content directly in the system prompt as text.

```typescript
const systemPrompt = `
${baseInstructions}

## Available Skills
### frontend-design
${await fetch('/skills/frontend-design.md').then((r) => r.text())}

### file-reading
${await fetch('/skills/file-reading.md').then((r) => r.text())}
`;
```

✅ Pros:

- Extremely simple to implement
- No filesystem needed
- Guaranteed the AI "sees" the skills

❌ Cons:

- All skills always in context = large prompt = more tokens = slower + more expensive
- Can't do progressive loading (Level 3 resources)
- Skills can't include runnable scripts

**Verdict**: Good for a prototype or if you have ≤5 small skills.

---

### Option C: RAG-Based Skill Retrieval (Advanced)

Store skills in a vector DB. On each message, retrieve the top-k relevant skills and inject only those.

```
User message → embed → vector search → top 2-3 skills → inject into prompt
```

✅ Pros:

- Scales to hundreds of skills
- Always injects the most relevant skills
- Keeps prompt size controlled

❌ Cons:

- Requires vector DB (Qdrant, pgvector, etc.)
- Retrieval can miss skills with unusual phrasing
- More infrastructure

**Verdict**: Worth considering once you have 20+ skills.

---

### Option D: MCP Server for Skills (Most Extensible)

Expose your skill library as an MCP server. The AI calls `list_skills()` and `read_skill(name)` as tool calls.

```typescript
// MCP server
server.addTool('list_skills', async () => {
  return skillIndex.map((s) => ({ name: s.name, description: s.description }));
});

server.addTool('read_skill', async ({ name }) => {
  return await fs.readFile(`/skills/${name}/SKILL.md`, 'utf-8');
});
```

✅ Pros:

- Cleanest architecture
- Skills discoverable at runtime
- Works with any MCP-compatible client
- Extensible to tools as well

❌ Cons:

- More infrastructure (MCP server process)
- Slight latency on skill reads
- Requires the model to proactively call `list_skills`

**Verdict**: Best long-term architecture if you're building a platform others will extend.

---

## Part 4: Recommended Implementation Path

Given you're on bolt.diy + Appwrite + React Native experience, here's the suggested build order:

```
Phase 1 (Week 1): Get it working
├── Implement Option B (direct system prompt injection)
├── Write 3-5 core skills (frontend-design, file-reading, code-execution)
└── Verify the AI actually uses them

Phase 2 (Week 2-3): Make it proper
├── Migrate to Option A (virtual /chat/ FS in WebContainer)
├── Build SkillLoader + SystemPromptBuilder
├── Add the skill index JSON
└── Hide /chat/ from the file explorer UI

Phase 3 (Month 2): Add intelligence
├── Add memory system (Appwrite collection, keyed by user ID)
├── Add artifact output watcher
├── Write more skills (CampusSwap-specific, project templates, etc.)
└── Consider Option D (MCP) if skill count grows

Phase 4 (Month 3+): Platform features
├── Allow users to install custom skills (.skill bundle format)
├── Skill marketplace UI
└── Per-project skill configurations
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

_Built as architecture reference for a bolt.diy-based Claude alternative._
