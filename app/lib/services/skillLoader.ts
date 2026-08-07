/**
 * SkillLoader — Cloudflare Workers–compatible.
 *
 * The original implementation used `node:fs/promises`, `node:path`, `process.cwd()`,
 * and `adm-zip`, none of which are available in the Cloudflare Workers V8 isolate.
 *
 * This version:
 *   - Lazily imports Node.js–only modules inside try/catch so the file can be
 *     parsed without throwing at import time on Workers.
 *   - Falls back to no-op / empty results when the filesystem is unavailable.
 *   - Still works fully in Node.js (local dev / Electron).
 */

import { SkillManifestSchema, type SkillManifest } from '~/types/skill-marketplace';
import { getProjectSkills } from '~/lib/stores/projectSkills';

/*
 * Lazy-loaded Node.js–only modules. These resolve to real modules on Node.js
 * and to undefined / empty objects on Cloudflare Workers (where Vite externalizes them).
 */
let fs: typeof import('node:fs/promises') | undefined;
let path: typeof import('node:path') | undefined;
let admZip: typeof import('adm-zip') | undefined;

async function ensureNodeModules() {
  if (fs) {
    return true;
  } // already loaded

  try {
    const fsMod = await import('node:fs/promises');
    fs = fsMod;

    const pathMod = await import('node:path');
    path = pathMod;

    const zipMod = await import('adm-zip');
    admZip = zipMod.default;

    return true;
  } catch {
    // Running in Cloudflare Workers — filesystem not available
    return false;
  }
}

/** Check if we're running in an environment with filesystem access */
function isNodeEnv(): boolean {
  return typeof process !== 'undefined' && !!process.cwd;
}

export interface Skill {
  id: string;
  label: string;
  description: string;
  content: string;
  manifest?: SkillManifest;
}

export interface DesignSystemEntry {
  id: string;
  label: string;
  category: string;
  summary: string;
  filePath: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns a record of key-value pairs found between the --- delimiters.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);

  if (!match) {
    return {};
  }

  const result: Record<string, string> = {};
  const lines = match[1].split('\n');
  let currentKey = '';
  let currentValue = '';

  for (const line of lines) {
    // Check for key: value
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);

    if (kvMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Save previous key
      if (currentKey) {
        result[currentKey] = currentValue.trim();
      }

      currentKey = kvMatch[1];
      currentValue = kvMatch[2];

      // Handle multi-line values starting with >
      if (currentValue.trim() === '>') {
        currentValue = '';
      }
    } else if (currentKey && (line.startsWith('  ') || line.startsWith('\t'))) {
      // Continuation of multi-line value
      currentValue += ' ' + line.trim();
    }
  }

  // Save last key
  if (currentKey) {
    result[currentKey] = currentValue.trim();
  }

  return result;
}

export class SkillLoader {
  private static _instance: SkillLoader;
  private _skills: Map<string, Skill> = new Map();
  private _skillsDir = '';
  private _userSkillsDir = '';
  private _designSkillsDir = '';
  private _designSystemsDir = '';
  private _designSystems: Map<string, DesignSystemEntry> = new Map();
  private _initialized = false;

  static getInstance(): SkillLoader {
    if (!SkillLoader._instance) {
      SkillLoader._instance = new SkillLoader();
    }

    return SkillLoader._instance;
  }

  /**
   * Initialise directory paths using Node.js APIs.
   * Returns false if running in Workers (no filesystem).
   */
  private async _ensureInitialized(): Promise<boolean> {
    if (this._initialized) {
      return isNodeEnv() && !!fs;
    }

    const nodeAvailable = await ensureNodeModules();

    if (nodeAvailable && path && isNodeEnv()) {
      const cwd = process.cwd();
      this._skillsDir = path.join(cwd, 'app/lib/skills');
      this._userSkillsDir = path.join(cwd, 'user_skills');
      this._designSkillsDir = path.join(cwd, 'design/skills');
      this._designSystemsDir = path.join(cwd, 'design/design-systems');
    }

    this._initialized = true;

    return nodeAvailable;
  }

  async loadSkills() {
    const available = await this._ensureInitialized();

    if (!available || !fs) {
      // No filesystem — skip (Cloudflare Workers)
      return;
    }

    try {
      // Load core skills
      await this._loadFromDirectory(this._skillsDir, false);

      // Load design/bundled skills (with YAML frontmatter support)
      await this._loadFromDirectory(this._designSkillsDir, false, true);

      // Load user skills
      await this._loadFromDirectory(this._userSkillsDir, true);

      // Load design systems index
      await this._loadDesignSystems();

      console.log(`Loaded ${this._skills.size} total skills, ${this._designSystems.size} design systems`);
    } catch (error) {
      console.error('Failed to load skills:', error);
    }
  }

  private async _loadFromDirectory(dir: string, isUserDir: boolean, _useFrontmatter = false) {
    if (!fs || !path) {
      return;
    }

    try {
      await fs.mkdir(dir, { recursive: true });

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(dir, entry.name);
          const manifestPath = path.join(skillPath, 'manifest.json');

          try {
            // Find the main skill file (SKILL.md)
            const skillMdPath = path.join(skillPath, 'SKILL.md');
            const content = await fs.readFile(skillMdPath, 'utf-8');

            // Try manifest.json first, then fall back to YAML frontmatter
            let skillName = entry.name;
            let skillDescription = '';
            let manifest: SkillManifest | undefined;

            try {
              const manifestContent = await fs.readFile(manifestPath, 'utf-8');
              manifest = SkillManifestSchema.parse(JSON.parse(manifestContent));
              skillName = manifest.name;
              skillDescription = manifest.description;
            } catch {
              // No manifest.json — parse YAML frontmatter from SKILL.md
              const frontmatter = parseFrontmatter(content);

              if (frontmatter.name) {
                skillName = frontmatter.name;
              }

              if (frontmatter.description) {
                skillDescription = frontmatter.description;
              }
            }

            // Skip if no description found and no manifest
            if (!skillDescription && !manifest) {
              const firstContentLine = content
                .split('\n')
                .find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
              skillDescription = firstContentLine?.trim() || `${entry.name} skill`;
            }

            this._skills.set(skillName.toLowerCase(), {
              id: skillName.toLowerCase(),
              label: skillName,
              description: skillDescription,
              content,
              manifest,
            });
          } catch (e) {
            console.error(`Failed to load skill at ${skillPath}:`, e);
          }
        } else if (!isUserDir && entry.name.endsWith('.md')) {
          // Legacy support for core skills as single .md files
          const content = await fs.readFile(path.join(dir, entry.name), 'utf-8');
          const id = path.basename(entry.name, '.md');
          const lines = content.split('\n');
          const label = lines[0].replace('# ', '').trim();
          const description = lines.find((l) => l.trim() && !l.startsWith('#'))?.trim() || 'No description available';

          this._skills.set(id, {
            id,
            label,
            description,
            content,
          });
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
    }
  }

  private async _loadDesignSystems() {
    if (!fs || !path) {
      return;
    }

    try {
      await fs.mkdir(this._designSystemsDir, { recursive: true });

      const entries = await fs.readdir(this._designSystemsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const designPath = path.join(this._designSystemsDir, entry.name, 'DESIGN.md');

        try {
          const content = await fs.readFile(designPath, 'utf-8');
          const lines = content.split('\n');

          // Parse title: "# Design System Inspired by X" -> "X"
          const titleLine = lines.find((l) => l.startsWith('# '));
          const label = titleLine
            ? titleLine.replace('# Design System Inspired by ', '').replace('# ', '').trim()
            : entry.name;

          // Parse category: "> Category: X"
          const categoryLine = lines.find((l) => l.startsWith('> Category:'));
          const category = categoryLine ? categoryLine.replace('> Category:', '').trim() : 'General';

          // Parse summary: line after category
          const categoryIdx = lines.findIndex((l) => l.startsWith('> Category:'));
          const summary =
            categoryIdx >= 0 && lines[categoryIdx + 1]?.startsWith('>')
              ? lines[categoryIdx + 1].replace('>', '').trim()
              : '';

          this._designSystems.set(entry.name, {
            id: entry.name,
            label,
            category,
            summary,
            filePath: designPath,
          });
        } catch {
          // DESIGN.md not found, skip
        }
      }
    } catch (error) {
      console.error('Error loading design systems:', error);
    }
  }

  getSkills(tokenBudget?: number, projectId?: string) {
    let skills = Array.from(this._skills.values());

    if (projectId) {
      const projectSkills = getProjectSkills(projectId);

      if (projectSkills.length > 0) {
        skills = skills.filter((s) => projectSkills.includes(s.id));
      }
    }

    if (tokenBudget === undefined) {
      return skills.map(({ id, label, description }) => ({ id, label, description }));
    }

    // Simple token budget filtering (approx 4 chars per token)
    let currentChars = 0;
    const filteredSkills: { id: string; label: string; description: string }[] = [];

    for (const skill of skills) {
      const skillInfoSize = (skill.id + skill.label + skill.description).length;

      if (currentChars + skillInfoSize <= tokenBudget * 4) {
        filteredSkills.push({ id: skill.id, label: skill.label, description: skill.description });
        currentChars += skillInfoSize;
      } else {
        break;
      }
    }

    return filteredSkills;
  }

  async getSkillContent(skillId: string): Promise<string | null> {
    const id = skillId.toLowerCase();
    const skill = this._skills.get(id);

    return skill ? skill.content : null;
  }

  getRelevantSkills(tokenBudget?: number): string {
    const skills = this.getSkills(tokenBudget);

    if (skills.length === 0) {
      return 'No specialized skills currently loaded.';
    }

    return skills.map((s) => `<skill name="${s.id}" description="${s.description}"/>`).join('\n');
  }

  getDesignSystems(): DesignSystemEntry[] {
    return Array.from(this._designSystems.values()).map(({ id, label, category, summary }) => ({
      id,
      label,
      category,
      summary,
      filePath: '',
    }));
  }

  async getDesignSystemContent(id: string): Promise<string | null> {
    const entry = this._designSystems.get(id);

    if (!entry || !fs) {
      return null;
    }

    try {
      return await fs.readFile(entry.filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async installSkill(bundlePath: string) {
    if (!fs || !path || !admZip) {
      throw new Error('Skill installation is not available in Cloudflare Workers environment');
    }

    try {
      console.log(`Installing skill from ${bundlePath}...`);

      const zip = new admZip(bundlePath);
      const zipEntries = zip.getEntries();

      // 1. Validate manifest first
      const manifestEntry = zipEntries.find((e) => e.entryName === 'manifest.json');

      if (!manifestEntry) {
        throw new Error('Invalid .skill bundle: manifest.json missing');
      }

      const manifestContent = manifestEntry.getData().toString('utf8');
      const manifest = SkillManifestSchema.parse(JSON.parse(manifestContent));

      // 2. Check for SKILL.md
      const skillMdEntry = zipEntries.find((e) => e.entryName === 'SKILL.md');

      if (!skillMdEntry) {
        throw new Error('Invalid .skill bundle: SKILL.md missing');
      }

      // 3. Extract to user_skills directory
      const skillDir = path.join(this._userSkillsDir, manifest.name);
      await fs.mkdir(skillDir, { recursive: true });

      zip.extractAllTo(skillDir, true);

      console.log(`Successfully installed skill: ${manifest.name}`);
      await this.loadSkills();

      // Reload registry
      return manifest;
    } catch (error) {
      console.error(`Installation failed for ${bundlePath}:`, error);
      throw error;
    }
  }

  async uninstallSkill(skillId: string) {
    if (!fs || !path) {
      throw new Error('Skill uninstallation is not available in Cloudflare Workers environment');
    }

    const skillPath = path.join(this._userSkillsDir, skillId);

    try {
      await fs.rm(skillPath, { recursive: true, force: true });
      this._skills.delete(skillId);
      console.log(`Uninstalled skill ${skillId}`);
    } catch (error) {
      console.error(`Failed to uninstall skill ${skillId}:`, error);
      throw error;
    }
  }
}
