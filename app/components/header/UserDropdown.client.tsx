import React from 'react';
import { MotionDropdown, MotionDropdownItem, MotionDropdownSeparator } from '~/components/ui/MotionDropdown';
import { toggleTheme } from '~/lib/stores/theme';
import { useStore } from '@nanostores/react';
import { themeStore } from '~/lib/stores/theme';

export function UserDropdown() {
  const theme = useStore(themeStore);

  return (
    <MotionDropdown
      trigger={
        <div className="p-2 rounded-full hover:bg-bolt-elements-background-depth-1 cursor-pointer text-bolt-elements-textPrimary transition-colors">
          <div className="i-ph:user-circle text-2xl" />
        </div>
      }
    >
      <div className="flex flex-col gap-1">
        <MotionDropdownItem onSelect={() => console.log('Open Settings')} className="gap-2">
          <div className="i-ph:gear text-lg" />
          <span>Settings</span>
        </MotionDropdownItem>
        <MotionDropdownSeparator />
        <MotionDropdownItem onSelect={toggleTheme} className="gap-2">
          <div className={classNames('text-lg', theme === 'dark' ? 'i-ph:sun' : 'i-ph:moon')} />
          <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </MotionDropdownItem>
      </div>
    </MotionDropdown>
  );
}

function classNames(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
