export const LoadingOverlay = ({
  message = 'Loading...',
  progress,
  progressText,
}: {
  message?: string;
  progress?: number;
  progressText?: string;
}) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/80 z-50 backdrop-blur-sm">
      <div className="relative flex flex-col items-center gap-4 p-8 rounded-lg bg-amplify-elements-background-depth-2 shadow-lg">
        <div
          className={'i-svg-spinners:90-ring-with-bg text-amplify-elements-loader-progress'}
          style={{ fontSize: '2rem' }}
        ></div>
        <p className="text-lg text-amplify-elements-textTertiary">{message}</p>
        {progress !== undefined && (
          <div className="w-64 flex flex-col gap-2">
            <div className="w-full h-2 bg-amplify-elements-background-depth-1 rounded-full overflow-hidden">
              <div
                className="h-full bg-amplify-elements-loader-progress transition-all duration-300 ease-out rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            {progressText && <p className="text-sm text-amplify-elements-textTertiary text-center">{progressText}</p>}
          </div>
        )}
      </div>
    </div>
  );
};
