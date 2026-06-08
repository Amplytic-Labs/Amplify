# Plan: Implement Core Skills (Procedural)

## Overview

Skills are the "knowledge base" of the agent. To be effective, they must be **procedural** (step-by-step) rather than just high-level guidelines. This plan covers the creation of the first three essential skills.

## Skill 1: Frontend Design (`frontend-design`)

**Goal**: Create production-grade, accessible, and visually stunning web interfaces.

**Procedural Steps to Implement in SKILL.md**:

1. **Analysis**: Identify component type, target audience, and design requirements.
2. **Design System**: Establish a color palette, typography scale, and spacing system (4px base).
3. **Architecture**: Break UI into atomic components and define prop interfaces.
4. **Implementation**: Use Tailwind CSS, implement responsive breakpoints (mobile-first), and add ARIA labels.
5. **Polish**: Add micro-interactions (hover/focus) and verify WCAG AA contrast ratios.

## Skill 2: File Reading (`file-reading`)

**Goal**: Standardize the extraction and analysis of uploaded files.

**Procedural Steps to Implement in SKILL.md**:

1. **Identification**: Detect file extension and route to the correct MCP tool (e.g., `pdf_read`).
2. **Extraction**: Read content in chunks for large files to avoid context overflow.
3. **Summarization**: Generate a high-level summary of the file before detailed analysis.
4. **Synthesis**: Cross-reference information across multiple uploaded files.

## Skill 3: Code Execution (`code-execution`)

**Goal**: Verify logic and provide actual program output.

**Procedural Steps to Implement in SKILL.md**:

1. **Environment Setup**: Initialize the sandboxed bash/python environment.
2. **Implementation**: Write the code and execute it.
3. **Verification**: Run a set of test cases to verify the output.
4. **Iteration**: Analyze stderr on failure and iterate until the tests pass.
5. **Presentation**: Format the final output clearly in markdown code blocks.

## Implementation Process

1. **Define Schema**: Ensure all skills follow the YAML frontmatter $\rightarrow$ Procedural Steps $\rightarrow$ Output Format structure.
2. **Create Files**: Write the `SKILL.md` files as static assets.
3. **Update Registry**: Add skills to the `SkillLoader` registry.

## Testing Plan

### 1. Behavioral Evaluation (The "Golden Set")

Since skills are instructions for an LLM, we will use a "Golden Set" of prompts to evaluate quality:

- **Frontend Design**: Prompt the AI to build a "Modern SaaS Dashboard". Verify the output follows the 5-step process (Analysis $\rightarrow$ Design System $\rightarrow$ Architecture $\rightarrow$ Implementation $\rightarrow$ Polish).
- **File Reading**: Upload a complex PDF. Verify the AI first summarizes the document before answering specific questions.
- **Code Execution**: Request a complex algorithm. Verify the AI writes the code, runs a test script, and only returns the result after the test passes.

### 2. Negative Testing

- **Anti-Triggering**: Prompt the AI with a task that is _almost_ a skill trigger but not quite. Verify the AI does NOT load the skill.
- **Instruction Conflict**: Provide a user instruction that contradicts a skill step. Verify the AI prioritizes the user's explicit request while still following the general skill procedure.

### 3. Token Efficiency

- **Metadata Check**: Verify that the skill descriptions in the registry are concise enough to allow 10+ skills to be listed without consuming more than 1000 tokens.
- **Loading Latency**: Measure the time from `read_skill` call to the LLM receiving the content.

### 4. Iterative Refinement

- **Feedback Loop**: Log cases where the AI fails to follow a skill step.
- **Refinement**: Update the `SKILL.md` procedural steps to be more explicit or provide examples of "Good" vs "Bad" output.
