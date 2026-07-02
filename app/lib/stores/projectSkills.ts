import { map } from 'nanostores';

export interface ProjectSkillConfig {
  projectId: string;
  enabledSkills: string[];
}

export const projectSkillsStore = map<Record<string, string[]>>({});

export function setProjectSkills(projectId: string, skills: string[]) {
  projectSkillsStore.setKey(projectId, skills);
}

export function getProjectSkills(projectId: string): string[] {
  const store = projectSkillsStore.get();
  return store[projectId] || [];
}

export function toggleProjectSkill(projectId: string, skillId: string) {
  const current = getProjectSkills(projectId);
  const next = current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId];
  setProjectSkills(projectId, next);
}
