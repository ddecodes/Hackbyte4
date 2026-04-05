import * as React from 'react';

// Accessing mascot URIs passed from the extension via initialData
const getMascotUri = (status: string) => {
  try {
    const uris = (window as any).initialData?.mascotUris;
    if (uris && uris[status]) {
      return uris[status];
    }
  } catch (e) {
    console.error('Error getting mascot URI:', e);
  }
  return '';
};

interface MascotProps {
  status: 'happy' | 'serious' | 'angry';
}

export const Mascot: React.FC<MascotProps> = ({ status }) => {
  const uri = getMascotUri(status);

  return (
    <div className={`ai-mascot ${status}`} style={{
      position: 'absolute',
      top: '10px',
      right: '10px',
      width: '64px',
      height: '64px',
      zIndex: 200,
      pointerEvents: 'none',
      transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <style>
        {`
          .ai-mascot img {
            width: 100%;
            height: 100%;
            scale: 1.5;
            object-fit: contain;
          }
          @keyframes floating {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
          }
          .ai-mascot {
            animation: floating 3s ease-in-out infinite;
          }
          .ai-mascot.angry {
            animation: shaking 0.2s infinite;
          }
          @keyframes shaking {
            0% { transform: translate(1px, 1px) rotate(0deg); }
            10% { transform: translate(-1px, -2px) rotate(-1deg); }
            20% { transform: translate(-3px, 0px) rotate(1deg); }
            30% { transform: translate(3px, 2px) rotate(0deg); }
            40% { transform: translate(1px, -1px) rotate(1deg); }
            50% { transform: translate(-1px, 2px) rotate(-1deg); }
          }
        `}
      </style>
      {uri ? (
        <img src={uri} alt={`Mascot ${status}`} />
      ) : (
        <div style={{ fontSize: '24px' }}>🤖</div>
      )}
    </div>
  );
};
