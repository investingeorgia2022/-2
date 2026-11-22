// @ts-nocheck
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DafSearchPanel } from '../talmud/components/DafSearchPanel';

const spot = (id: string, word: string, i: number) => ({
  id,
  word,
  section: 'gemara',
  topPct: 10,
  leftPct: 90 - i * 5,
  heightPct: 1,
  widthPct: 4,
});

describe('DafSearchPanel recent search history', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists up to the last 5 searched terms, re-runs on click, and clears cleanly', () => {
    const spots = [
      spot('s0', 'אמר', 0),
      spot('s1', 'רבא', 1),
      spot('s2', 'מאי', 2),
      spot('s3', 'טעמא', 3),
      spot('s4', 'תנו', 4),
      spot('s5', 'רבנן', 5),
      spot('s6', 'שמע', 6),
      spot('s7', 'מינה', 7),
    ];
    const onPick = vi.fn();
    const onHits = vi.fn();

    render(<DafSearchPanel spots={spots} onPick={onPick} onHits={onHits} />);

    act(() => {
      window.dispatchEvent(new CustomEvent('talmud-open-daf-search'));
    });

    const input = screen.getByPlaceholderText('חפש בדף… / მოძებნე დაფზე');

    const queries = ['אמר רבא', 'מאי טעמא', 'תנו רבנן', 'שמע מינה', 'אמר', 'רבא'];
    for (const q of queries) {
      fireEvent.change(input, { target: { value: q } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }

    // Clearing the input reveals the last 5 unique queries, newest first (dropping the oldest 'אמר רבא')
    fireEvent.change(input, { target: { value: '' } });

    expect(screen.getByText('ბოლო 5 ძიება')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'אמר רבא' })).not.toBeInTheDocument();

    const expectedOrder = ['רבא', 'אמר', 'שמע מינה', 'תנו רבנן', 'מאי טעמא'];
    for (const term of expectedOrder) {
      expect(screen.getByRole('button', { name: term })).toBeInTheDocument();
    }

    // Clicking a past term populates the input and re-runs searchDaf
    fireEvent.click(screen.getByRole('button', { name: 'שמע מינה' }));
    expect((input as HTMLInputElement).value).toBe('שמע מינה');
    expect(onHits.mock.calls.at(-1)?.[0]).toHaveLength(1);

    // Clearing input and clicking clear history removes all saved terms
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'ძიების ისტორიის გასუფთავება' }));
    expect(screen.queryByText('ბოლო 5 ძიება')).not.toBeInTheDocument();
  });

  it('mounts at the top edge and dispatches talmud-daf-search-state on open, close, and unmount', () => {
    const events: boolean[] = [];
    const listener = (e: Event) => {
      events.push(Boolean((e as CustomEvent<{ open?: boolean }>).detail?.open));
    };
    window.addEventListener('talmud-daf-search-state', listener);

    const { unmount } = render(
      <DafSearchPanel spots={[spot('s0', 'אמר', 0)]} onPick={vi.fn()} onHits={vi.fn()} />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent('talmud-open-daf-search'));
    });

    const panel = document.querySelector('[data-daf-search-panel="true"]');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('top-0');
    expect(panel?.className).toContain('left-0');
    expect(panel?.className).toContain('right-0');
    expect(events.at(-1)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'დახურვა' }));
    expect(events.at(-1)).toBe(false);

    act(() => {
      window.dispatchEvent(new CustomEvent('talmud-open-daf-search'));
    });
    expect(events.at(-1)).toBe(true);

    unmount();
    expect(events.at(-1)).toBe(false);
    window.removeEventListener('talmud-daf-search-state', listener);
  });

  it('starts compact (~28vh), resizes via vertical drag, collapses on dragging up, and remembers height', () => {
    const spots = [spot('s0', 'אמר', 0), spot('s1', 'רבא', 1)];
    const { unmount } = render(
      <DafSearchPanel spots={spots} onPick={vi.fn()} onHits={vi.fn()} />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent('talmud-open-daf-search'));
    });

    const input = screen.getByPlaceholderText('חפש בדף… / მოძებნე დაფზე');
    fireEvent.change(input, { target: { value: 'אמר' } });

    const list = document.querySelector('[data-daf-search-results-list="true"]') as HTMLElement | null;
    const handle = document.querySelector('[data-daf-search-resize-handle="true"]') as HTMLElement | null;
    expect(list).not.toBeNull();
    expect(handle).not.toBeNull();

    const initialMaxH = parseInt(list!.style.maxHeight || '0', 10);
    expect(initialMaxH).toBeGreaterThanOrEqual(140);
    expect(initialMaxH).toBeLessThanOrEqual(240);

    // Drag down by 140px to expand the search results drawer
    fireEvent(handle!, new MouseEvent('pointerdown', { clientY: 300, button: 0, bubbles: true }));
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientY: 440 }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientY: 440 }));
    });

    const expandedMaxH = parseInt(list!.style.maxHeight || '0', 10);
    expect(expandedMaxH).toBe(initialMaxH + 140);

    // Re-mounting remembers the expanded height
    unmount();
    render(<DafSearchPanel spots={spots} onPick={vi.fn()} onHits={vi.fn()} />);
    act(() => {
      window.dispatchEvent(new CustomEvent('talmud-open-daf-search'));
    });
    fireEvent.change(screen.getByPlaceholderText('חפש בדף… / მოძებნე დაფზე'), { target: { value: 'אמר' } });
    const reopenedList = document.querySelector('[data-daf-search-results-list="true"]') as HTMLElement | null;
    expect(parseInt(reopenedList!.style.maxHeight || '0', 10)).toBe(expandedMaxH);

    // Dragging all the way up collapses the list cleanly to 0px
    const handle2 = document.querySelector('[data-daf-search-resize-handle="true"]') as HTMLElement | null;
    fireEvent(handle2!, new MouseEvent('pointerdown', { clientY: 400, button: 0, bubbles: true }));
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientY: 20 }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientY: 20 }));
    });
    expect(reopenedList!.style.maxHeight).toBe('0px');
  });
});

