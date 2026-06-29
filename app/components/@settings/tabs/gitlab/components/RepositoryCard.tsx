import React from 'react';
import type { GitLabProjectInfo } from '~/types/GitLab';

interface RepositoryCardProps {
  repo: GitLabProjectInfo;
  onClone?: (repo: GitLabProjectInfo) => void;
}

export function RepositoryCard({ repo, onClone }: RepositoryCardProps) {
  return (
    <a
      key={repo.name}
      href={repo.http_url_to_repo}
      target="_blank"
      rel="noopener noreferrer"
      className="group block p-4 rounded-lg bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor hover:border-amplify-elements-borderColorActive transition-all duration-200"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="i-ph:git-repository w-4 h-4 text-amplify-elements-icon-info" />
            <h5 className="text-sm font-medium text-amplify-elements-textPrimary group-hover:text-amplify-elements-item-contentAccent transition-colors">
              {repo.name}
            </h5>
          </div>
          <div className="flex items-center gap-3 text-xs text-amplify-elements-textSecondary">
            <span className="flex items-center gap-1" title="Stars">
              <div className="i-ph:star w-3.5 h-3.5 text-amplify-elements-icon-warning" />
              {repo.star_count.toLocaleString()}
            </span>
            <span className="flex items-center gap-1" title="Forks">
              <div className="i-ph:git-fork w-3.5 h-3.5 text-amplify-elements-icon-info" />
              {repo.forks_count.toLocaleString()}
            </span>
          </div>
        </div>

        {repo.description && (
          <p className="text-xs text-amplify-elements-textSecondary line-clamp-2">{repo.description}</p>
        )}

        <div className="flex items-center gap-3 text-xs text-amplify-elements-textSecondary">
          <span className="flex items-center gap-1" title="Default Branch">
            <div className="i-ph:git-branch w-3.5 h-3.5" />
            {repo.default_branch}
          </span>
          <span className="flex items-center gap-1" title="Last Updated">
            <div className="i-ph:clock w-3.5 h-3.5" />
            {new Date(repo.updated_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {onClone && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClone(repo);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-amplify-elements-background-depth-2 hover:bg-amplify-elements-background-depth-3 text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition-colors"
                title="Clone repository"
              >
                <div className="i-ph:git-branch w-3.5 h-3.5" />
                Clone
              </button>
            )}
            <span className="flex items-center gap-1 group-hover:text-amplify-elements-item-contentAccent transition-colors">
              <div className="i-ph:arrow-square-out w-3.5 h-3.5" />
              View
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}
