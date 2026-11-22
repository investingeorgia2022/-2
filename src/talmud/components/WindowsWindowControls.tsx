// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface WindowsWindowControlsProps {
  isMinimized?: boolean;
  onToggleMinimize?: (e: React.MouseEvent) => void;
  isMaximized?: boolean;
  onToggleMaximize?: (e: React.MouseEvent) => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: (e: React.MouseEvent) => void;
  showFullScreenButton?: boolean;
  onClose?: (e: React.MouseEvent) => void;
  isDark?: boolean;
  size?: 'xs' | 'sm' | 'md';
  minimizeTitle?: string;
  maximizeTitle?: string;
  fullScreenTitle?: string;
  restoreTitle?: string;
  closeTitle?: string;
  className?: string;
}

/**
 * Classic Windows-style Window Control Buttons:
 * 1) Minimize / Expand (`—` / `▼`)
 * 2) Maximize / Restore Window (`□` / `❐`)
 * 3) Fullscreen Expand (`⛶`)
 * 4) Close (`✕`, optional)
 */
export const WindowsWindowControls: React.FC<WindowsWindowControlsProps> = ({
  isMinimized = false,
  onToggleMinimize,
  isMaximized = false,
  onToggleMaximize,
  isFullScreen,
  onToggleFullScreen,
  showFullScreenButton = true,
  onClose,
  isDark = false,
  size = 'sm',
  minimizeTitle = 'ჩაკეცვა / გაშლა (Minimize / Expand)',
  maximizeTitle = 'ფანჯრის გაშლა (Maximize)',
  fullScreenTitle = 'მთელ ეკრანზე გაშლა (Full Screen)',
  restoreTitle = 'თავდაპირველ ზომაზე დაბრუნება (Restore)',
  closeTitle = 'დახურვა',
  className = '',
}) => {
  const orbSizeClass =
    size === 'xs'
      ? 'w-5.5 h-5.5 text-[8.5px]'
      : size === 'md'
        ? 'w-7 h-7 text-[10px]'
        : 'w-6 h-6 text-[9px]';

  const iconSize = size === 'xs' ? 8.5 : size === 'md' ? 10.5 : 9.5;
  const effectiveFullScreenHandler = onToggleFullScreen || onToggleMaximize;
  const effectiveIsFullScreen = isFullScreen !== undefined ? isFullScreen : isMaximized;

  return (
    <div
      dir="ltr"
      data-daf-word="true"
      onClick={(e) => e.stopPropagation()}
      className={`crystal-selection-trough inline-flex items-center gap-1 select-none shrink-0 ml-auto transition-all duration-150 ${className}`}
    >
      {onToggleMinimize && (
        <button
          type="button"
          data-daf-word="true"
          data-raw-btn="true"
          data-tone={isMinimized ? 'amber' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMinimize(e);
          }}
          title={isMinimized ? 'ფანჯრის გაშლა (Expand)' : minimizeTitle}
          className={`${orbSizeClass} crystal-corner-orb cursor-pointer`}
        >
          {isMinimized ? (
            /* Expand icon when minimized */
            <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 4.5L6 8L9.5 4.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line
                x1="2.5"
                y1="9.5"
                x2="9.5"
                y2="9.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            /* Classic Windows Minimize Line (—) */
            <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none">
              <line
                x1="2.5"
                y1="6.5"
                x2="9.5"
                y2="6.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      )}

      {onToggleMaximize && (
        <button
          type="button"
          data-daf-word="true"
          data-raw-btn="true"
          data-tone={isMaximized ? 'sky' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMaximize(e);
          }}
          title={isMaximized ? restoreTitle : maximizeTitle}
          className={`${orbSizeClass} crystal-corner-orb cursor-pointer`}
        >
          {isMaximized ? (
            /* Classic Windows Restore Down Overlapping Squares (❐) */
            <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none">
              <path
                d="M4.5 3.8V2.4H9.6V7.5H8.2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <rect
                x="2.4"
                y="4.4"
                width="5.4"
                height="5.2"
                stroke="currentColor"
                strokeWidth="1.3"
                rx="0.8"
              />
            </svg>
          ) : (
            /* Classic Windows 11 Rounded Maximize Square (□) */
            <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none">
              <rect
                x="2.4"
                y="2.4"
                width="7.2"
                height="7.2"
                stroke="currentColor"
                strokeWidth="1.3"
                rx="1"
              />
            </svg>
          )}
        </button>
      )}

      {showFullScreenButton && effectiveFullScreenHandler && (
        <button
          type="button"
          data-daf-word="true"
          data-raw-btn="true"
          data-tone={effectiveIsFullScreen ? 'emerald' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            effectiveFullScreenHandler(e);
          }}
          title={effectiveIsFullScreen ? restoreTitle : fullScreenTitle}
          className={`${orbSizeClass} crystal-corner-orb cursor-pointer`}
        >
          {effectiveIsFullScreen ? (
            /* Fullscreen Exit Corners */
            <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none">
              <path
                d="M4.5 2V4.5H2M7.5 2V4.5H10M2 7.5H4.5V10M10 7.5H7.5V10"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            /* Fullscreen Expand 4 Corners (⛶) */
            <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none">
              <path
                d="M2 4.2V2H4.2M7.8 2H10V4.2M10 7.8V10H7.8M4.2 10H2V7.8"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      )}

      {onClose && (
        <button
          type="button"
          data-daf-word="true"
          data-raw-btn="true"
          data-tone="rose"
          onClick={(e) => {
            e.stopPropagation();
            onClose(e);
          }}
          title={closeTitle}
          className={`${orbSizeClass} crystal-corner-orb cursor-pointer`}
        >
          <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none">
            <path
              d="M3 3L9 9M9 3L3 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export interface WindowsMinimizedStripProps {
  titleKa: string;
  titleHe?: string;
  badgeText?: string;
  isDark?: boolean;
  onExpand: () => void;
  onMaximize?: () => void;
  isMaximized?: boolean;
  className?: string;
}

/**
 * Compact Windows-style Restorable Title Bar shown whenever a Daf or Panel is minimized (`isMinimized === true`).
 * Clicking anywhere on the bar or clicking the Windows controls expands/maximizes the panel immediately.
 */
export const WindowsMinimizedStrip: React.FC<WindowsMinimizedStripProps> = ({
  titleKa,
  titleHe,
  badgeText,
  isDark = false,
  onExpand,
  onMaximize,
  isMaximized = false,
  className = '',
}) => {
  return (
    <div
      onClick={onExpand}
      className={`crystal-window-shell w-full px-3 py-2 rounded-2xl flex items-center justify-between gap-2 cursor-pointer select-none transition-all ${className}`}
      title="დააწკაპუნეთ ჩაკეცილი ფანჯრის გასაშლელად"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 border border-amber-500/45 text-amber-600 dark:text-amber-300 shrink-0">
          ჩაკეცილია
        </span>
        {titleHe && (
          <span
            dir="rtl"
            className="font-serif text-xs sm:text-sm font-black text-amber-700 dark:text-amber-300 shrink-0"
          >
            {titleHe}
          </span>
        )}
        <span className="text-xs font-extrabold truncate">{titleKa}</span>
        {badgeText && (
          <span className="text-[10.5px] font-bold opacity-75 hidden sm:inline shrink-0">
            • {badgeText}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10.5px] font-extrabold text-amber-600 dark:text-amber-300 hidden sm:inline">
          გაშლა ▾
        </span>
        <WindowsWindowControls
          isMinimized={true}
          onToggleMinimize={() => onExpand()}
          isMaximized={isMaximized}
          onToggleMaximize={
            onMaximize
              ? () => {
                  onExpand();
                  onMaximize();
                }
              : () => onExpand()
          }
          isDark={isDark}
          size="xs"
        />
      </div>
    </div>
  );
};

export interface CrystalDiamondJumpButtonProps {
  labelKa: string;
  labelHe?: string;
  citeHe?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onClose?: () => void;
  anchorRect?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  } | null;
  isDark?: boolean;
  portalFixed?: boolean;
}

/**
 * Faceted Translucent Diamond Visual Button in the app's signature warm gold/parchment/mahogany palette.
 * When `portalFixed` is true (or `anchorRect` is provided), renders via `createPortal` to `document.body`
 * and counter-scales against `visualViewport.scale` so it is 100% independent of Daf zoom and screen zoom!
 */
export const CrystalDiamondJumpButton: React.FC<CrystalDiamondJumpButtonProps> = ({
  labelKa,
  labelHe,
  citeHe,
  onClick,
  onClose,
  anchorRect,
  isDark = false,
  portalFixed = true,
}) => {
  const effectiveLabelHe = labelHe || citeHe;
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    setDismissed(false);
  }, [labelKa, labelHe, anchorRect?.top, anchorRect?.left]);

  const [vvState, setVvState] = useState<{
    scale: number;
    vw: number;
    vh: number;
  }>(() => ({
    scale: typeof window !== 'undefined' ? window.visualViewport?.scale || 1 : 1,
    vw: typeof window !== 'undefined' ? window.innerWidth : 1024,
    vh: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));

  useEffect(() => {
    if (typeof window === 'undefined' || !portalFixed) return;
    const syncViewport = () => {
      setVvState({
        scale: window.visualViewport?.scale || 1,
        vw: window.innerWidth,
        vh: window.innerHeight,
      });
    };
    window.addEventListener('resize', syncViewport, { passive: true });
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    return () => {
      window.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('scroll', syncViewport);
    };
  }, [portalFixed]);

  if (dismissed) return null;

  const invScale = vvState.scale > 1.02 ? Number((1 / vvState.scale).toFixed(3)) : 1;

  const buttonContent = (
    <div
      dir="ltr"
      data-daf-word="true"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 select-none"
    >
      <button
        type="button"
        data-daf-word="true"
        onClick={(e) => {
          e.stopPropagation();
          setDismissed(true);
          onClick(e);
          if (onClose) onClose();
        }}
        title={`წყაროს დაფის გახსნა Note ფანჯარაში: ${labelKa}${labelHe ? ` (${labelHe})` : ''}`}
        style={{
          background: isDark
            ? 'linear-gradient(135deg, rgba(48, 31, 19, 0.84) 0%, rgba(92, 58, 33, 0.78) 50%, rgba(32, 20, 12, 0.88) 100%)'
            : 'linear-gradient(135deg, rgba(253, 249, 241, 0.86) 0%, rgba(235, 219, 191, 0.80) 52%, rgba(212, 178, 132, 0.76) 100%)',
          boxShadow: isDark
            ? '0 8px 26px rgba(0, 0, 0, 0.55), inset 0 1px 2px rgba(255, 243, 214, 0.38), 0 0 0 1px rgba(196, 154, 108, 0.72)'
            : '0 8px 24px rgba(59, 35, 19, 0.26), inset 0 1px 2px rgba(255, 255, 255, 0.85), 0 0 0 1px rgba(139, 90, 43, 0.62)',
        }}
        className={`group relative px-3 py-1.5 rounded-xl backdrop-blur-md flex items-center gap-2 cursor-pointer transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] ${
          isDark ? 'text-[#FAF5EB]' : 'text-[#2B1B10]'
        }`}
      >
        {/* Translucent Crystalline Specular Top Sheen */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1.5 top-0.5 h-[42%] rounded-t-lg bg-gradient-to-b from-white/40 to-transparent opacity-80"
        />

        {/* Faceted Translucent Diamond Gem Emblem */}
        <span className="relative w-5 h-5 flex items-center justify-center shrink-0">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            className="drop-shadow-[0_1px_3px_rgba(139,90,43,0.45)]"
          >
            {/* Outer Diamond Cut */}
            <polygon
              points="12,1.5 22.5,12 12,22.5 1.5,12"
              fill="url(#diamondCrystalGrad)"
              stroke={isDark ? '#F5DFBB' : '#6B4226'}
              strokeWidth="1.35"
            />
            {/* Inner Crown & Pavilion Facets */}
            <polygon
              points="12,4.5 18.5,12 12,19.5 5.5,12"
              fill="rgba(255,255,255,0.28)"
              stroke={isDark ? 'rgba(250,245,235,0.6)' : 'rgba(107,66,38,0.45)'}
              strokeWidth="0.85"
            />
            <line
              x1="12"
              y1="1.5"
              x2="12"
              y2="22.5"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="0.75"
            />
            <line
              x1="1.5"
              y1="12"
              x2="22.5"
              y2="12"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="0.75"
            />
            <defs>
              <linearGradient id="diamondCrystalGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="rgba(255, 250, 240, 0.90)" />
                <stop offset="45%" stopColor="rgba(212, 163, 115, 0.65)" />
                <stop offset="100%" stopColor="rgba(139, 90, 43, 0.80)" />
              </linearGradient>
            </defs>
          </svg>
        </span>

        {/* Normal-Sized Crisp Label in App Design Palette */}
        <span className="relative flex items-center gap-1.5 text-xs font-extrabold whitespace-nowrap tracking-tight">
          <span className={isDark ? 'text-amber-300' : 'text-[#6B4226]'}>წყარო:</span>
          <span>{labelKa}</span>
          {labelHe && (
            <span
              dir="rtl"
              className={`font-serif text-xs font-black px-1.5 py-0.2 rounded ${
                isDark
                  ? 'bg-[#1A110B]/60 text-[#F5DFBB]'
                  : 'bg-[#6B4226]/12 text-[#3B2313]'
              }`}
            >
              {labelHe}
            </span>
          )}
        </span>
      </button>

      {onClose && (
        <button
          type="button"
          data-daf-word="true"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="დახურვა"
          className={`w-6 h-6 rounded-lg border backdrop-blur-md flex items-center justify-center text-[10px] font-black cursor-pointer shadow-sm ${
            isDark
              ? 'bg-[#241810]/85 border-[#C49A6C]/50 text-[#FAF5EB] hover:bg-rose-600'
              : 'bg-[#FAF3E3]/90 border-[#8B5A2B]/50 text-[#2C1A10] hover:bg-rose-600 hover:text-white'
          }`}
        >
          ✕
        </button>
      )}
    </div>
  );

  if (!portalFixed || !anchorRect || typeof document === 'undefined') {
    return buttonContent;
  }

  // Position fixed on screen right above or below the tapped citation word, 100% independent of Daf zoom
  const estWidth = 240;
  const estHeight = 38;
  const centerX = anchorRect.left + anchorRect.width / 2;
  const clampedLeft = Math.max(
    8,
    Math.min(vvState.vw - estWidth - 8, Math.round(centerX - estWidth / 2))
  );
  const placeAbove = anchorRect.top > 56;
  const clampedTop = placeAbove
    ? Math.max(8, Math.round(anchorRect.top - estHeight - 6))
    : Math.min(vvState.vh - estHeight - 8, Math.round(anchorRect.bottom + 6));

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: `${clampedLeft}px`,
        top: `${clampedTop}px`,
        zIndex: 285,
        transform: invScale !== 1 ? `scale(${invScale})` : undefined,
        transformOrigin: 'top left',
      }}
      className="pointer-events-auto"
    >
      {buttonContent}
    </div>,
    document.body
  );
};
