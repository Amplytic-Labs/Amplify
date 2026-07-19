import React, { useState, useEffect } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import type { ProviderInfo } from '~/types/model';
import Cookies from 'js-cookie';
import { classNames } from '~/utils/classNames';

interface APIKeyPopupProps {
  provider: ProviderInfo;
  apiKey: string;
  setApiKey: (key: string) => void;
  onClose: () => void;
}

export const APIKeyPopup: React.FC<APIKeyPopupProps> = ({ provider, apiKey, setApiKey, onClose }) => {
  const [tempKey, setTempKey] = useState(apiKey);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setTempKey(apiKey);
  }, [apiKey]);

  const handleSave = async () => {
    setIsSaving(true);

    try {
      // Save to parent state
      setApiKey(tempKey);

      // Save to localStorage
      const storedApiKeys = localStorage.getItem('apiKeys');
      let currentKeys: Record<string, string> = {};

      if (storedApiKeys) {
        currentKeys = JSON.parse(storedApiKeys);
      }

      const newKeys = { ...currentKeys, [provider.name]: tempKey };
      localStorage.setItem('apiKeys', JSON.stringify(newKeys));

      /*
       * ALSO write the apiKeys cookie so server-side endpoints (which can only
       * read cookies, not localStorage) can access the key. Without this,
       * /api/chat (stream-text) fails with "Missing API key for Z.ai provider"
       * on the very first turn — which would also block the one-shot
       * <chatname> naming tag from being emitted, leaving the chat unnamed.
       */
      Cookies.set('apiKeys', JSON.stringify(newKeys), { expires: 365, sameSite: 'lax' });

      onClose();
    } catch (error) {
      console.error('Failed to save API key:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="absolute z-30 w-72 mt-2 p-4 rounded-lg border border-amplify-elements-borderColor bg-amplify-elements-background-depth-2 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-amplify-elements-textPrimary">{provider.name} API Key</h3>
        <IconButton
          onClick={onClose}
          title="Close"
          className="p-1 h-6 w-6 text-amplify-elements-textTertiary hover:text-amplify-elements-textPrimary"
        >
          <div className="i-ph:x text-sm" />
        </IconButton>
      </div>

      <p className="text-xs text-amplify-elements-textTertiary mb-3">
        Enter your API key to enable this provider. Your key is stored locally in your browser.
      </p>

      <div className="space-y-3">
        <input
          type="password"
          value={tempKey}
          onChange={(e) => setTempKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-3 py-2 text-sm rounded-md border border-amplify-elements-borderColor 
                    bg-amplify-elements-prompt-background text-amplify-elements-textPrimary 
                    focus:outline-none focus:ring-2 focus:ring-amplify-elements-focus transition-all"
          autoFocus
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="bg-transparent px-3 py-1.5 text-xs font-medium text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !tempKey}
            className={classNames(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
              isSaving || !tempKey
                ? 'bg-amplify-elements-borderColor text-amplify-elements-textTertiary cursor-not-allowed'
                : 'bg-amplify-elements-focus text-amplify-elements-focus-foreground hover:bg-amplify-elements-focus-hover',
            )}
          >
            {isSaving ? 'Saving...' : 'Save Key'}
          </button>
        </div>
      </div>

      {provider.getApiKeyLink && (
        <div className="mt-4 pt-3 border-t border-amplify-elements-borderColor">
          <a
            href={provider.getApiKeyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
          >
            <span>{provider.labelForGetApiKey || 'Get your API key here'}</span>
            <div className="i-ph:arrow-square-out text-xs" />
          </a>
        </div>
      )}
    </div>
  );
};
