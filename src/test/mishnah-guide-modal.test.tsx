// @ts-nocheck
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MishnahGuideModal, MishnahMapModal } from '../talmud/components/MishnahGuide';

const sampleData = {
  chapter: 1,
  loading: false,
  aiLoading: false,
  items: [
    {
      index: 1,
      he: 'כל הזבחים שנזבחו שלא לשמן כשרים אלא שלא עלו',
      translationKa: 'ყველა მსხვერპლი, რომელიც შეიწირა არა თავის სახელზე',
      sagesHe: 'חכמים',
      explanationKa: 'განმარტება პირველი მიშნისა.',
    },
    {
      index: 2,
      he: 'יוסי בן חוני אומר הנשחטים לשם פסח ולשם חטאת',
      translationKa: 'იოსე ბენ ხონი ამბობს...',
    },
  ],
  currentIndices: new Set([1]),
};

describe('MishnahMapModal & MishnahGuideModal Crystal Glass redesign', () => {
  it('renders MishnahMapModal with Crystal Glass shell, header, trough, orbs, and interactive cards', () => {
    const onClose = vi.fn();
    const onOpenGuide = vi.fn();

    render(
      <MishnahMapModal
        open
        onClose={onClose}
        onOpenGuide={onOpenGuide}
        data={sampleData}
        tractateNameKa="ზევახიმი"
        dafId="2a"
        mishnahPct={13}
        isDark
      />,
    );

    const dialog = document.querySelector('[data-crystal-mishnah-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.className).toContain('crystal-window-shell');
    expect(dialog?.className).toContain('max-h-[90dvh]');
    expect(document.querySelectorAll('.crystal-window-header').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.crystal-window-trough')).not.toBeNull();
    expect(document.querySelector('.crystal-corner-orb[data-tone="rose"]')).not.toBeNull();
    expect(document.querySelector('.crystal-action-orb[data-tone="sky"]')).not.toBeNull();
    expect(document.querySelector('.mg-window')).toBeNull();

    expect(screen.getByText('დაფის სარჩევი • რუკა')).toBeInTheDocument();
    expect(screen.getByText('მიშნა 13%')).toBeInTheDocument();
    expect(screen.getByText('გემარა 87%')).toBeInTheDocument();
    expect(screen.getByText('მიმდინარე დაფი')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /მიშნის იზოლირებული მეგზურის გახსნა/ }));
    expect(onOpenGuide).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'დახურვა' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders MishnahGuideModal with Crystal tabs and closes cleanly', () => {
    const onClose = vi.fn();

    render(
      <MishnahGuideModal
        open
        onClose={onClose}
        data={sampleData}
        tractateNameKa="ზევახიმი"
        tractateNameHe="זבחים"
        dafId="2a"
        isDark={false}
      />,
    );

    const dialog = document.querySelector('[data-crystal-mishnah-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.className).toContain('crystal-window-shell');
    expect(screen.getByText('მიმდინარე გემარის მიშნა')).toBeInTheDocument();

    const dafTab = screen.getByRole('tab', { name: /დაფის ნაწილი/ });
    fireEvent.click(dafTab);
    expect(dafTab).toHaveAttribute('aria-selected', 'true');

    const closeBtns = screen.getAllByRole('button', { name: 'დახურვა' });
    expect(closeBtns.length).toBe(2);
    fireEvent.click(closeBtns[0]!);
    fireEvent.click(closeBtns[1]!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
