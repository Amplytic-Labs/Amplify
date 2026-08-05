import React from 'react';
import { Dialog, DialogTitle, DialogDescription, DialogRoot } from '~/components/ui/Dialog';
import { useStore } from '@nanostores/react';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';
import { QRCode } from 'react-qrcode-logo';
import useViewport from '~/lib/hooks';

interface ExpoQrModalProps {
  open: boolean;
  onClose: () => void;
}

export const ExpoQrModal: React.FC<ExpoQrModalProps> = ({ open, onClose }) => {
  const expoUrl = useStore(expoUrlAtom);
  const isMobile = useViewport(1024);

  const getExpoGoUrl = (url: string | null) => {
    if (!url) {
      return null;
    }

    if (url.startsWith('exp://')) {
      return url;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url.replace(/^https?:\/\//, 'exp://');
    }

    return url;
  };

  /**
   * Build the deep-link URL that opens the project directly in the Expo Go app.
   * Format: exp://exp.host/--/to?exp=<encoded-exp-url>&host=<encoded-host>
   * On iOS the universal link format is used: https://expo.go/--/to?...
   */
  const getExpoGoDeepLink = (url: string | null) => {
    if (!url) {
      return null;
    }

    const expUrl = getExpoGoUrl(url);

    if (!expUrl) {
      return null;
    }

    /*
     * For iOS devices, use the universal link format that opens Expo Go
     * For Android, the exp:// scheme works directly
     */
    const encodedExpUrl = encodeURIComponent(expUrl);

    return `https://expo.go/--/to?exp=${encodedExpUrl}`;
  };

  const handleOpenInExpoGo = () => {
    const deepLink = getExpoGoDeepLink(expoUrl);

    if (deepLink) {
      window.open(deepLink, '_blank');
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog
        className="text-center !flex-col !mx-auto !text-center !max-w-md"
        showCloseButton={true}
        onClose={onClose}
      >
        <div className="border !border-amplify-elements-borderColor flex flex-col gap-5 justify-center items-center p-6 bg-amplify-elements-background-depth-2 rounded-md">
          <div className="i-amplify:expo-brand h-10 w-full invert dark:invert-none"></div>
          <DialogTitle className="text-amplify-elements-textTertiary text-lg font-semibold leading-6">
            Preview on your own mobile device
          </DialogTitle>
          <DialogDescription className="bg-amplify-elements-background-depth-3 max-w-sm rounded-md p-1 border border-amplify-elements-borderColor">
            Scan this QR code with the Expo Go app on your mobile device to open your project.
          </DialogDescription>
          <div className="my-6 flex flex-col items-center">
            {expoUrl ? (
              <QRCode
                logoImage="/Amplify.png"
                removeQrCodeBehindLogo={true}
                logoPadding={3}
                logoHeight={50}
                logoWidth={50}
                logoPaddingStyle="square"
                style={{
                  borderRadius: 16,
                  padding: 2,
                  backgroundColor: '#8a5fff',
                }}
                value={getExpoGoUrl(expoUrl) || ''}
                size={200}
              />
            ) : (
              <div className="text-gray-500 text-center">No Expo URL detected.</div>
            )}
          </div>

          {/* "Open in Expo Go" button — shown on mobile where the user likely has Expo Go installed */}
          {isMobile && expoUrl && (
            <button
              onClick={handleOpenInExpoGo}
              className="flex items-center justify-center gap-2 px-4 py-2.5 w-full max-w-[280px] rounded-lg bg-[#8a5fff] text-white font-semibold text-sm hover:bg-[#7a4fef] transition-colors"
            >
              <div className="i-amplify:expo-brand h-5 w-5 invert" />
              Open in Expo Go
            </button>
          )}
        </div>
      </Dialog>
    </DialogRoot>
  );
};
