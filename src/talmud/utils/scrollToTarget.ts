let navigationSequence = 0;

export function findScrollParent(target: HTMLElement): HTMLElement | null {
  let parent = target.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function getTopBarObstruction(boundsTop: number, availableHeight: number): number {
  if (typeof document === 'undefined' || availableHeight <= 0) return 0;
  const panel = document.querySelector('[data-daf-audio-sync-panel="true"]');
  if (!(panel instanceof HTMLElement)) return 0;
  const rect = panel.getBoundingClientRect();
  if (rect.height <= 0 || rect.bottom <= boundsTop) return 0;
  return Math.max(0, Math.min(availableHeight * 0.65, rect.bottom - boundsTop));
}

export function getTargetScrollTop(target: HTMLElement, container: HTMLElement, anchorRatio = 0.42): number {
  const rect = target.getBoundingClientRect();
  const bounds = container.getBoundingClientRect();
  const scale = container.offsetHeight > 0 ? bounds.height / container.offsetHeight : 1;
  const topObstruction = getTopBarObstruction(bounds.top, bounds.height) / (scale || 1);
  const desiredOffset =
    topObstruction > 0
      ? topObstruction + Math.max(0, container.clientHeight - topObstruction) * anchorRatio
      : container.clientHeight * anchorRatio;
  const delta = (rect.top + rect.height / 2 - bounds.top) / (scale || 1) - container.clientTop - desiredOffset;
  return Math.max(0, Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + delta));
}

export function scrollToTarget(target: HTMLElement | null, { settleMs = 360, anchorRatio = 0.42 } = {}): void {
  if (!target || typeof window === 'undefined') return;
  const sequence = ++navigationSequence;
  // The PDF zoom transition must finish before reading screen coordinates.
  window.setTimeout(() => requestAnimationFrame(() => {
    if (sequence !== navigationSequence || !target.isConnected) return;
    const container = findScrollParent(target);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (container) {
      container.scrollTo({ top: getTargetScrollTop(target, container, anchorRatio), behavior });
    } else {
      const rect = target.getBoundingClientRect();
      const topObstruction = getTopBarObstruction(0, window.innerHeight);
      const desiredOffset =
        topObstruction > 0
          ? topObstruction + Math.max(0, window.innerHeight - topObstruction) * anchorRatio
          : window.innerHeight * anchorRatio;
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top + rect.height / 2 - desiredOffset), behavior });
    }
  }), settleMs);
}
