import React from 'react';

interface ExamplePrompt {
  text: string;
  icon: string;
  category: 'build' | 'design' | 'learn' | 'automate';
}

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  { text: 'Build a todo app with React and Tailwind', icon: '✓', category: 'build' },
  { text: 'Create a landing page with a hero section', icon: '◈', category: 'design' },
  { text: 'Make a Tic Tac Toe game in HTML, CSS and JS', icon: '◇', category: 'build' },
  { text: 'Build a blog using Astro', icon: '✎', category: 'build' },
  { text: 'Create a dashboard with charts and tables', icon: '▦', category: 'design' },
  { text: 'Build a weather app with API integration', icon: '☀', category: 'automate' },
];

const CATEGORY_STYLES: Record<ExamplePrompt['category'], string> = {
  build: 'hover:border-purple-400/60 dark:hover:border-purple-500/50 hover:text-purple-600 dark:hover:text-purple-400 hover:shadow-purple-500/10',
  design: 'hover:border-fuchsia-400/60 dark:hover:border-fuchsia-500/50 hover:text-fuchsia-600 dark:hover:text-fuchsia-400 hover:shadow-fuchsia-500/10',
  learn: 'hover:border-violet-400/60 dark:hover:border-violet-500/50 hover:text-violet-600 dark:hover:text-violet-400 hover:shadow-violet-500/10',
  automate: 'hover:border-pink-400/60 dark:hover:border-pink-500/50 hover:text-pink-600 dark:hover:text-pink-400 hover:shadow-pink-500/10',
};

const CATEGORY_ICON_STYLES: Record<ExamplePrompt['category'], string> = {
  build: 'text-purple-500 dark:text-purple-400',
  design: 'text-fuchsia-500 dark:text-fuchsia-400',
  learn: 'text-violet-500 dark:text-violet-400',
  automate: 'text-pink-500 dark:text-pink-400',
};

interface ExamplePromptsProps {
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
}

export function ExamplePrompts({ sendMessage }: ExamplePromptsProps = {}) {
  return (
    <div id="examples" className="relative w-full max-w-3xl mx-auto mt-8">
      <div className="flex items-center justify-center gap-2 mb-4">
        <div className="h-px flex-1 max-w-[60px] bg-gradient-to-r from-transparent to-amplify-elements-borderColor" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-amplify-elements-textSecondary/60">
          Try asking
        </span>
        <div className="h-px flex-1 max-w-[60px] bg-gradient-to-l from-transparent to-amplify-elements-borderColor" />
      </div>
      <div
        className="flex flex-wrap justify-center gap-2"
        style={{
          animation: '.25s ease-out 0s 1 _fade-and-move-in_g2ptj_1 forwards',
        }}
      >
        {EXAMPLE_PROMPTS.map((examplePrompt, index: number) => {
          return (
            <button
              key={index}
              onClick={(event) => {
                sendMessage?.(event, examplePrompt.text);
              }}
              className={`group inline-flex items-center gap-1.5 border border-amplify-elements-borderColor rounded-full bg-transparent hover:bg-amplify-elements-background-depth-1 text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary px-3.5 py-1.5 text-xs font-medium transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${CATEGORY_STYLES[examplePrompt.category]}`}
            >
              <span className={`text-[10px] opacity-60 group-hover:opacity-100 transition-opacity ${CATEGORY_ICON_STYLES[examplePrompt.category]}`}>
                {examplePrompt.icon}
              </span>
              {examplePrompt.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
