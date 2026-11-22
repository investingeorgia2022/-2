// @ts-nocheck
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CascadingTalmudMishnahSelectorModal } from '../talmud/components/CascadingTalmudMishnahSelectorModal';

describe('CascadingTalmudMishnahSelectorModal crystal design & controls', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
  });

  it('renders Crystal Glass shell/header/trough/orbs in Day and Night modes and removes hardcoded dark-brown styling', () => {
    const { rerender } = render(
      <CascadingTalmudMishnahSelectorModal
        isOpen
        onClose={vi.fn()}
        initialSederId="zeraim"
        initialTractateId="Berakhot"
        initialDafId="2a"
        isDark={false}
      />,
    );

    const sheet = document.querySelector('[data-crystal-selector="true"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.className).toContain('crystal-window-shell');
    expect(sheet?.className).toContain('h-[92dvh]');
    expect(sheet?.getAttribute('data-crystal-dark')).toBe('false');
    expect(document.querySelectorAll('.crystal-window-header').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll('.crystal-window-trough').length).toBeGreaterThanOrEqual(3);
    expect(document.querySelector('.crystal-corner-orb[data-tone="rose"]')).not.toBeNull();
    expect(document.querySelector('.crystal-action-orb[data-tone="sky"]')).not.toBeNull();

    const gridContainer = document.querySelector('[data-cascading-grid-container="true"]');
    expect(gridContainer?.className).toContain('flex-1');
    expect(gridContainer?.className).not.toContain('max-h-[46dvh]');
    const grid = gridContainer?.firstElementChild;
    expect(grid?.className).toContain('min-h-0');
    expect(grid?.className).toContain('grid-rows-[minmax(0,1fr)]');

    const scrollColumns = document.querySelectorAll('[data-cascading-column="true"]');
    expect(scrollColumns).toHaveLength(4);
    scrollColumns.forEach((col) => {
      expect(col.className).toContain('min-h-0');
      expect(col.className).toContain('overflow-y-auto');
      expect(col.className).toContain('touch-pan-y');
    });

    rerender(
      <CascadingTalmudMishnahSelectorModal
        isOpen
        onClose={vi.fn()}
        initialSederId="zeraim"
        initialTractateId="Berakhot"
        initialDafId="2a"
        isDark
      />,
    );
    expect(document.querySelector('[data-crystal-selector="true"]')?.getAttribute('data-crystal-dark')).toBe('true');
  });

  it('supports Quick-Jump steppers, Amud switcher, mode toggle, reset, and confirming selection', () => {
    const onSelectDaf = vi.fn();
    const onSelectMishnah = vi.fn();
    const onClose = vi.fn();

    render(
      <CascadingTalmudMishnahSelectorModal
        isOpen
        onClose={onClose}
        initialSederId="zeraim"
        initialTractateId="Berakhot"
        initialDafId="2a"
        onSelectDaf={onSelectDaf}
        onSelectMishnah={onSelectMishnah}
        isDark={false}
      />,
    );

    // Stepper increases folio from 2 to 3, Amud switches to b
    fireEvent.click(screen.getByRole('button', { name: 'შემდეგი დაფი' }));
    const numInput = screen.getByLabelText('დაფის ნომერი') as HTMLInputElement;
    expect(numInput.value).toBe('3');

    const amudButtons = screen.getAllByRole('button', { name: '2-ב' });
    fireEvent.click(amudButtons[0]!);

    fireEvent.click(screen.getByRole('button', { name: 'დაკეტვა და გადასვლა' }));
    expect(onSelectDaf).toHaveBeenCalledWith('Berakhot', '3b');
    expect(onClose).toHaveBeenCalledTimes(1);

    // Switching to Mishnah mode selects Chapter 2 / Mishnah 3 and triggers onSelectMishnah
    fireEvent.click(screen.getByRole('button', { name: 'მიშნა' }));
    const columns = document.querySelectorAll('[data-cascading-column="true"]');
    const chapterCol = columns[2]!;
    const mishnahCol = columns[3]!;
    fireEvent.click(Array.from(chapterCol.querySelectorAll('button')).find((b) => b.textContent?.trim() === '2')!);
    fireEvent.click(Array.from(mishnahCol.querySelectorAll('button')).find((b) => b.textContent?.trim() === '3')!);
    fireEvent.click(screen.getByRole('button', { name: 'დაკეტვა და გადასვლა' }));
    expect(onSelectMishnah).toHaveBeenCalledWith('Berakhot', 2, 3);

    // Reset button restores default Daf 2
    fireEvent.click(screen.getByRole('button', { name: 'დაფი' }));
    fireEvent.click(screen.getByRole('button', { name: 'თავიდან' }));
    expect((screen.getByLabelText('დაფის ნომერი') as HTMLInputElement).value).toBe('2');
  });

  it('jumps directly when clicking a recent folio card and clears history cleanly', () => {
    const onSelectDaf = vi.fn();
    const onClearHistory = vi.fn();
    const onClose = vi.fn();
    const recents = [
      { tractateId: 'Taanit', tractateNameKa: 'თაყანითი', tractateNameHe: 'תענית', dafId: '4b' },
    ];

    render(
      <CascadingTalmudMishnahSelectorModal
        isOpen
        onClose={onClose}
        recentlyViewedDapim={recents}
        onSelectDaf={onSelectDaf}
        onClearHistory={onClearHistory}
        isDark={false}
      />,
    );

    fireEvent.click(screen.getByTitle('თაყანითი (תענית) 4b — დააჭირეთ გადასასვლელად'));
    expect(onSelectDaf).toHaveBeenCalledWith('Taanit', '4b');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'გასუფთავება' }));
    expect(onClearHistory).toHaveBeenCalledTimes(1);
  });
});
