# Plan: Implement Core Skills

## Overview

Skills are the "knowledge base" of the agent. They provide specialized instructions that the LLM follows to achieve high-quality results in specific domains. This plan covers the creation of the first three essential skills.

## Skill 1: Frontend Design (`frontend-design`)

**Goal**: Ensure the AI creates visually stunning, accessible, and production-ready web interfaces.

**Key Instructions to Include**:

- **Design Principles**: Use modern spacing, typography, and color palettes.
- **Component Architecture**: Prefer modular, reusable React components.
- **Styling**: Use Tailwind CSS for efficiency and consistency.
- **Interactivity**: Implement smooth transitions and loading states.
- **Accessibility**: Ensure ARIA labels and keyboard navigation are handled.

## Skill 2: File Reading (`file-reading`)

**Goal**: Provide a standardized way for the AI to handle various uploaded file formats.

**Key Instructions to Include**:

- **Routing**: Identify the file extension and use the appropriate tool (e.g., `pdf_read` for `.pdf`).
- **Chunking**: For large files, read in chunks to avoid context overflow.
- **Summarization**: Always provide a brief summary of the file content before diving into details.
- **Cross-Referencing**: Link information from multiple files when answering complex queries.

## Skill 3: Code Execution (`code-execution`)

**Goal**: Enable the AI to run code, verify logic, and provide actual output to the user.

**Key Instructions to Include**:

- **Environment**: Use the sandboxed bash/python environment.
- **Verification**: Run tests before declaring a feature "complete".
- **Error Handling**: If a script fails, analyze the stderr and iterate on the fix.
- **Output Formatting**: Present code output clearly using markdown code blocks.

## Implementation Process

1. **Create Directory Structure**:
   - `/chat/skills/frontend-design/`
   - `/chat/skills/file-reading/`
   - `/chat/skills/code-execution/`
2. **Write `SKILL.md`**: For each skill, follow the standard template (Frontmatter -> Overview -> Process -> Output).
3. **Update Registry**: Add each skill to `/chat/skills/index.json`.

## Verification Plan

- [ ] Trigger the `frontend-design` skill by asking for a "beautiful landing page" and verify the AI follows the design principles.
- [ ] Upload a PDF and verify the `file-reading` skill is triggered and the content is extracted.
- [ ] Ask the AI to "calculate the first 10 Fibonacci numbers using Python" and verify the `code-execution` skill is used.
