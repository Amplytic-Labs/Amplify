import React, { useState, useEffect } from 'react';
import { Card } from '~/components/ui/Card';
import { Button } from '~/components/ui/Button';
import { Badge } from '~/components/ui/Badge';
import { SearchInput } from '~/components/ui/SearchInput';
import { ScrollArea } from '~/components/ui/ScrollArea';
import { SkillLoader } from '~/lib/services/skillLoader';
import type { SkillManifest } from '~/types/skill-marketplace';

interface MarketplaceSkill extends SkillManifest {
  installed: boolean;
}

// Mock data for available skills in the marketplace
const MOCK_MARKETPLACE_SKILLS: MarketplaceSkill[] = [
  {
    name: 'react-expert',
    version: '1.2.0',
    author: 'Community',
    description: 'Advanced React patterns, hooks optimization and performance tuning.',
    category: 'coding',
    minAppVersion: '1.0.0',
    dependencies: [],
    permissions: ['filesystem'],
    installed: false,
    verified: true,
    rating: 4.8,
    installCount: 1250,
  },
  {
    name: 'tailwind-master',
    version: '1.0.5',
    author: 'UI-Labs',
    description: 'Expertise in Tailwind CSS, including complex animations and custom configurations.',
    category: 'design',
    minAppVersion: '1.0.0',
    dependencies: [],
    permissions: [],
    installed: false,
    verified: true,
    rating: 4.5,
    installCount: 840,
  },
  {
    name: 'data-viz-pro',
    version: '2.1.0',
    author: 'DataViz',
    description: 'Specialized in D3.js, Chart.js and complex data visualization strategies.',
    category: 'data',
    minAppVersion: '1.0.0',
    dependencies: [],
    permissions: ['network'],
    installed: false,
    verified: false,
    rating: 3.9,
    installCount: 320,
  },
];

export function SkillMarketplace() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);

  useEffect(() => {
    // In a real app, we'd fetch installed skills from SkillLoader
    // For now, we'll just use a mock list or try to load them
    const loader = SkillLoader.getInstance();
    const skills = loader.getSkills();
    setInstalledSkills(skills.map((s) => s.id));
  }, []);

  const filteredSkills = MOCK_MARKETPLACE_SKILLS.filter((skill) => {
    const matchesSearch =
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === 'all' || skill.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const handleInstall = async (skill: MarketplaceSkill) => {
    try {
      // In a real scenario, we would download the .skill bundle from a URL
      // For this demo, we'll simulate the installation process
      console.log(`Simulating download and installation of ${skill.name}...`);

      // We'll call the actual installSkill if we had a local path,
      // but since this is a UI demo, we'll just update the state.
      // In a real implementation, this would be an API call to a backend that triggers SkillLoader.installSkill

      setInstalledSkills((prev) => [...prev, skill.name]);
      alert(`Skill ${skill.name} installed successfully!`);
    } catch (error) {
      console.error('Installation failed:', error);
      alert('Failed to install skill.');
    }
  };

  return (
    <div className="flex flex-col h-full p-6 gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Skill Marketplace</h1>
          <p className="text-muted-foreground">Extend your agent's capabilities with community skills.</p>
        </div>
        <div className="flex gap-2">
          {['all', 'coding', 'design', 'data', 'writing'].map((cat) => (
            <Button
              key={cat}
              variant={filterCategory === cat ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterCategory(cat)}
              className="capitalize"
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      <SearchInput
        placeholder="Search for skills..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSkills.map((skill) => (
            <Card key={skill.name} className="p-4 flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <h3 className="font-semibold text-lg">{skill.name}</h3>
                <Badge variant="outline">{skill.version}</Badge>
              </div>
              <p className="text-sm text-muted-foreground flex-1">{skill.description}</p>
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">By {skill.author}</span>
                  {skill.verified && (
                    <Badge variant="default" className="text-[10px] px-1 h-4">
                      Verified
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    ★ {skill.rating} ({skill.installCount})
                  </span>
                </div>
                <Button size="sm" disabled={installedSkills.includes(skill.name)} onClick={() => handleInstall(skill)}>
                  {installedSkills.includes(skill.name) ? 'Installed' : 'Install'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
