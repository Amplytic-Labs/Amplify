import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { SkillManifestSchema, type SkillManifest } from '~/types/skill-marketplace';
import { getProjectSkills } from '~/lib/stores/projectSkills';

export interface Skill {
  id: string;
  label: string;
  description: string;
  content: string;
  manifest?: SkillManifest;
}

export class SkillLoader {
  private static _instance: SkillLoader;
  private _skills: Map<string, Skill> = new Map();
  private readonly _skillsDir = path.join(process.cwd(), 'app/lib/skills');
  private readonly _userSkillsDir = path.join(process.cwd(), 'user_skills');

  static getInstance(): SkillLoader {
    if (!SkillLoader._instance) {
      SkillLoader._instance = new SkillLoader();
    }
    return SkillLoader._instance;
  }

  async loadSkills() {
    try {
      // Load core skills
      await this._loadFromDirectory(this._skillsDir, false);
      // Load user skills
      await this._loadFromDirectory(this._userSkillsDir, true);

      console.log(`Loaded ${this._skills.size} total skills`);
    } catch (error) {
      console.error('Failed to load skills:', error);
    }
  }

  private async _loadFromDirectory(dir: string, isUserDir: boolean) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(dir, entry.name);
          const manifestPath = path.join(skillPath, 'manifest.json');

          try {
            const manifestContent = await fs.readFile(manifestPath, 'utf-8');
            const manifest = SkillManifestSchema.parse(JSON.parse(manifestContent));

            // Find the main skill file (SKILL.md)
            const skillMdPath = path.join(skillPath, 'SKILL.md');
            const content = await fs.readFile(skillMdPath, 'utf-8');

            this._skills.set(manifest.name, {
              id: manifest.name,
              label: manifest.name,
              description: manifest.description,
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
    const skill = this._skills.get(skillId);
    return skill ? skill.content : null;
  }

  async installSkill(bundlePath: string) {
    try {
      console.log(`Installing skill from ${bundlePath}...`);

      const zip = new AdmZip(bundlePath);
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
      await this.loadSkills(); // Reload registry
      return manifest;
    } catch (error) {
      console.error(`Installation failed for ${bundlePath}:`, error);
      throw error;
    }
  }

  async uninstallSkill(skillId: string) {
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
