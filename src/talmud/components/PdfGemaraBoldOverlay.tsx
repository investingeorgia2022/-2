import React, { useEffect, useMemo, useRef, useState } from 'react';
import { maskPrintedInk } from '../utils/pdfInkMask';
import { mergeSpotsIntoRowBoxes, type MergedRowBox, type SpotBoxLike } from '../utils/vilnaPdfReadingTools';

interface PdfGemaraBoldOverlayProps {
  baseCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  spots: readonly SpotBoxLike[];
  active: boolean;
}

/**
 * Thickens printed dark ink strictly on main Gemara/Mishnah body rows using compact
 * row-sized transparent canvases (preserving Rashi, Tosafot, margins, and paper).
 */
export const PdfGemaraBoldOverlay: React.FC<PdfGemaraBoldOverlayProps> = ({
  baseCanvasRef,
  spots,
  active,
}) => {
  const [tile, setTile] = useState<{
    base?: HTMLCanvasElement | null;
    canvas?: HTMLCanvasElement;
    rect?: { l: number; t: number; w: number; h: number };
  } | null>(null);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.base === baseCanvasRef.current) {
        setTile(detail.canvas ? detail : null);
      }
    };
    window.addEventListener('talmud-sharp-tile-painted', update);
    return () => window.removeEventListener('talmud-sharp-tile-painted', update);
  }, [baseCanvasRef]);

  const rowBoxes = useMemo(() => {
    if (!active) return [];
    const gemaraSpots = spots.filter(
      (s) => (s.section === 'gemara' || s.section === 'mishnah') && !s.isSmallMarker
    );
    return mergeSpotsIntoRowBoxes(gemaraSpots);
  }, [spots, active]);

  if (!active || rowBoxes.length === 0) return null;

  return (
    <div
      data-gemara-bold-overlay="true"
      className="absolute inset-0 pointer-events-none z-15"
      aria-hidden="true"
    >
      {rowBoxes.map((box) => (
        <BoldRowCanvas
          key={`${box.rowId}-${box.leftPct.toFixed(2)}`}
          box={box}
          baseCanvasRef={baseCanvasRef}
          tile={tile}
        />
      ))}
    </div>
  );
};

const BoldRowCanvas: React.FC<{
  box: MergedRowBox;
  baseCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  tile: {
    canvas?: HTMLCanvasElement;
    rect?: { l: number; t: number; w: number; h: number };
  } | null;
}> = ({ box, baseCanvasRef, tile }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const base = baseCanvasRef.current;
    if (!canvas || !base?.width || !base?.height) return;

    const r = tile?.rect;
    const inside =
      Boolean(tile?.canvas) &&
      Boolean(r) &&
      box.leftPct >= r!.l * 100 &&
      box.topPct >= r!.t * 100 &&
      box.leftPct + box.widthPct <= (r!.l + r!.w) * 100 &&
      box.topPct + box.heightPct <= (r!.t + r!.h) * 100;

    const source = inside && tile?.canvas ? tile.canvas : base;
    if (!source.width || !source.height) return;

    const sx = (inside && r ? (box.leftPct / 100 - r.l) / r.w : box.leftPct / 100) * source.width;
    const sy = (inside && r ? (box.topPct / 100 - r.t) / r.h : box.topPct / 100) * source.height;
    const sw = ((box.widthPct / 100) * source.width) / (inside && r ? r.w : 1);
    const sh = ((box.heightPct / 100) * source.height) / (inside && r ? r.h : 1);
    if (sw < 1 || sh < 1) return;

    const w = Math.max(1, Math.ceil(sw));
    const h = Math.max(1, Math.ceil(sh));
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    if (!offCtx) return;

    offCtx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    const img = offCtx.getImageData(0, 0, w, h);
    maskPrintedInk(img.data);
    offCtx.putImageData(img, 0, 0);

    // Subtle sub-pixel ink dilation makes main Gemara strokes visibly bolder while keeping glyph edges crisp
    const shiftX = Math.max(0.55, Math.min(1.4, w / 280));
    const shiftY = Math.max(0.35, Math.min(0.9, h / 32));
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(off, shiftX, 0);
    ctx.drawImage(off, -shiftX * 0.5, 0);
    ctx.drawImage(off, 0, shiftY);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = 1;

    off.width = 0;
    off.height = 0;
  }, [baseCanvasRef, tile, box]);

  return (
    <canvas
      ref={ref}
      className="absolute pointer-events-none"
      style={{
        left: `${box.leftPct}%`,
        top: `${box.topPct}%`,
        width: `${box.widthPct}%`,
        height: `${box.heightPct}%`,
      }}
    />
  );
};
