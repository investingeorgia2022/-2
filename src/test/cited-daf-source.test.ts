import { describe, expect, it } from 'vitest';
import {
  hasAuthenticVilnaScan,
  isSupportedVilnaBavliScan,
} from '@/talmud/components/VilnaPdfInteractiveViewer';
import { bestSnippetMatch } from '@/talmud/components/CitedDafTextView';
import { shasPdfUrl } from '@/routes/api/talmud/vilna-pdf';

describe('cited daf source window', () => {
  it('does not treat Megillah 20b as having a printed scan (no substitute page)', () => {
    expect(hasAuthenticVilnaScan('Megillah', '20b')).toBe(false);
  });

  it('has no bundled scans after the daf reset', () => {
    expect(hasAuthenticVilnaScan('Berakhot', '2a')).toBe(false);
  });

  it('highlights the passage matching the cited phrase', () => {
    const s = (id: string, hebrewText: string) => ({ id, hebrewText }) as never;
    const list = [s('a', 'אין קורין את המגילה'), s('b', 'כל הלילה כשר לקצירת העומר ולהקטר חלבים')];
    expect(bestSnippetMatch(list, 'כל הלילה כשר לקצירת העומר')).toBe(1);
  });

  it('resolves hyphenated, spaced, and aliased Bavli tractates and daf formats without returning null (400)', () => {
    expect(shasPdfUrl('bava-batra', '2a')).toBe('https://www.shas.org/daf-pdf/api/?masechta=bava-basra&daf=2&amud=a');
    expect(shasPdfUrl('Rosh Hashanah', '16:')).toBe('https://www.shas.org/daf-pdf/api/?masechta=rosh-hashanah&daf=16&amud=b');
    expect(shasPdfUrl('taanis', '10.')).toBe('https://www.shas.org/daf-pdf/api/?masechta=taanis&daf=10&amud=a');
    expect(shasPdfUrl('Peah', '2a')).toBeNull();
  });

  it('distinguishes Bavli tractates from Mishnah-only tractates before issuing vilna-pdf requests', () => {
    expect(isSupportedVilnaBavliScan('Taanit', '2a')).toBe(true);
    expect(isSupportedVilnaBavliScan('bava-batra', '12b')).toBe(true);
    expect(isSupportedVilnaBavliScan('Peah', '2a')).toBe(false);
    expect(isSupportedVilnaBavliScan('Avot', '2a')).toBe(false);
    expect(isSupportedVilnaBavliScan('Taanit', '1:2')).toBe(false);
  });
});
