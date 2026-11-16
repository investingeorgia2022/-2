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
});
