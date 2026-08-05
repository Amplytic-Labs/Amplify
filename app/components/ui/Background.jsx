import React from 'react';

const Background = ({
  children,
  transparent = false,
  mode = 'dark', // 'dark' | 'light'
}) => {
  // Define gradients for each mode
  const gradients = {
    dark: `
      radial-gradient(
        150% 163% at 50% 91.5%,
        #000 38.406%,
        #2e2491 50.785%,
        #8c86f3 65.864%
      )
    `,
    light: `
      radial-gradient(
        150% 163% at 50% 91.5%,
        #ffffff 38.406%,
        #e6d5f7 50.785%,
        #c4b5fd 65.864%
      )
    `,
  };

  const selectedGradient = gradients[mode] || gradients.dark;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: transparent ? 'auto' : '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: transparent ? 'transparent' : mode === 'light' ? '#f9fafb' : 'transparent', // fallback
      }}
    >
      {!transparent && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: selectedGradient,
            willChange: 'transform',
            zIndex: 1,
          }}
        />
      )}
      <div
        style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', flex: 1, height: '100%' }}
      >
        {children}
      </div>
    </div>
  );
};

export default Background;
