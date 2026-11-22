import { describe, it, expect } from 'vitest';
import { getIndependentMarkerBoxes, getGilyonNote, getExactMarginEntry } from '../talmud/utils/pdfMarkerNavigation';
import { parseBiblicalCitation, findQuotedVerse } from '../talmud/utils/biblicalCitation';
describe('independent adjacent PDF markers', () => {
  it.each([['3','(ה'],['ו','ו(']])('keeps %s and %s separately tappable', (a,b) => {
    const boxes = getIndependentMarkerBoxes([{id:a,isSmallMarker:true,leftPct:40,topPct:20,widthPct:2.4,heightPct:2.2,inkLeftPct:40.3,inkWidthPct:0.5},{id:b,isSmallMarker:true,leftPct:41,topPct:20,widthPct:2.4,heightPct:2.2,inkLeftPct:41.3,inkWidthPct:0.7}]);
    const [first,second] = boxes;
    if (!first || !second) throw new Error('Both marker boxes must exist');
    expect(first.leftPct+first.widthPct).toBeLessThanOrEqual(second.leftPct);
    expect(first.widthPct).toBeGreaterThan(0.5); expect(second.widthPct).toBeGreaterThan(0.7);
  });

  it('clips small Torah Or marker 7 away from Gemara word וכתיב directly below it on Taanit 4a', () => {
    const spots = [
      { id: 'w-yisrael', rowId: 'r1', isSmallMarker: false, leftPct: 40.5, topPct: 42.6, widthPct: 5.5, heightPct: 1.4 },
      {
        id: 'm-7', rowId: 'r1', isSmallMarker: true,
        leftPct: 39.22, topPct: 42.77, widthPct: 2.4, heightPct: 2.2,
        inkLeftPct: 39.57, inkTopPct: 43.02, inkWidthPct: 0.44, inkHeightPct: 0.72,
      },
      { id: 'w-hatzori', rowId: 'r1', isSmallMarker: false, leftPct: 34.0, topPct: 42.6, widthPct: 4.8, heightPct: 1.4 },
      { id: 'w-vechativ', rowId: 'r2', isSmallMarker: false, leftPct: 38.73, topPct: 43.87, widthPct: 2.57, heightPct: 1.41 },
    ];
    const boxes = getIndependentMarkerBoxes(spots);
    const marker7 = boxes.find((b) => b.id === 'm-7')!;
    const vechativ = boxes.find((b) => b.id === 'w-vechativ')!;
    const yisrael = boxes.find((b) => b.id === 'w-yisrael')!;
    const hatzori = boxes.find((b) => b.id === 'w-hatzori')!;

    // Marker 7 must stay strictly above וכתיב so tapping וכתיב never hits 7
    expect(marker7.topPct + marker7.heightPct).toBeLessThanOrEqual(vechativ.topPct);
    // Horizontal bounds must not encroach into adjacent same-row Gemara words
    expect(marker7.leftPct).toBeGreaterThanOrEqual(hatzori.leftPct + hatzori.widthPct);
    expect(marker7.leftPct + marker7.widthPct).toBeLessThanOrEqual(yisrael.leftPct);
    // Own printed glyph remains inside the hitbox
    expect(marker7.leftPct).toBeLessThanOrEqual(39.57);
    expect(marker7.leftPct + marker7.widthPct).toBeGreaterThanOrEqual(40.01);
    expect(marker7.topPct).toBeLessThanOrEqual(43.02);
    expect(marker7.topPct + marker7.heightPct).toBeGreaterThanOrEqual(43.74);
  });
});
describe('Gilyon source-specific entry', () => {
  it('routes the circle after חצות to the Mishnah note, not Tosafot or the heading', () => {
    const spots = ['גליון הש','במתני','כדי להרחיק','פסחים','בתוס','כדי להמתין'].map((word,i) => ({ word, section:'margin',marginCommType:'gilyon-hashas',leftPct:88,topPct:20+i }));
    expect(getGilyonNote(spots,'mishnah','right').map(s=>s.word)).toEqual(['במתני','כדי להרחיק','פסחים']);
  });
});
describe('exact destination highlighting', () => {
  it('includes continuation text of the matching Bach entry and excludes the heading and next entry', () => {
    const spots = [
      { word:'הגהות',section:'margin',marginCommType:'bach',leftPct:88,topPct:20 },
      { word:'(ה)',section:'margin',marginCommType:'bach',marginEntryKey:'ה',leftPct:88,topPct:21 },
      { word:'תיקון',section:'margin',marginCommType:'bach',marginEntryKey:'ה',leftPct:88,topPct:22 },
      { word:'אחר',section:'margin',marginCommType:'bach',marginEntryKey:'ו',leftPct:88,topPct:23 },
      { word:'מקביל',section:'margin',marginCommType:'masoret',marginEntryKey:'ה',leftPct:88,topPct:24 },
    ];
    expect(getExactMarginEntry(spots,'bach','ה','right').map(s=>s.word)).toEqual(['(ה)','תיקון']);
    expect(getExactMarginEntry(spots,'bach','ז','right')).toEqual([]);
  });
});
describe('biblical citations instead of commentary indices', () => {
  it('reads the mirrored chapter-only Exodus citation from the screenshot', () => {
    expect(parseBiblicalCitation('המזבח דכתיב לא ילין לבקר )שמות לד(')).toMatchObject({book:'Exodus',chapter:34,verse:undefined});
  });
  it('resolves the quoted verse within its printed chapter', () => {
    const verses = Array.from({length:26},()=>'אחר'); verses[24]='לֹא תִשְׁחַט עַל חָמֵץ דַּם זִבְחִי וְלֹא יָלִין לַבֹּקֶר זֶבַח חַג הַפָּסַח';
    expect(findQuotedVerse(verses,'המזבח דכתיב לא ילין לבקר')).toBe(25);
  });
  it('preserves explicit verse numbers', () => { expect(parseBiblicalCitation('(שמות יד כד)')).toMatchObject({chapter:14,verse:24}); });
  it('does not substitute a verse when quotation evidence is absent', () => { expect(findQuotedVerse(['פסוק אחד','פסוק שני'],'מילה אחרת')).toBeUndefined(); });
});describe('Gilyon note without a matching section heading', () => {
  it('falls back to the Gilyon notes instead of doing nothing', () => {
    const spots = ['גליון הש','בגמ','דברי','הערה'].map((word,i) => ({ word, section:'margin',marginCommType:'gilyon-hashas',leftPct:88,topPct:20+i }));
    expect(getGilyonNote(spots,'mishnah','right').map(s=>s.word)).toEqual(['בגמ','דברי','הערה']);
  });
});
