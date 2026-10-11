import { describe, expect, it } from 'vitest';
import { extractOfficialPdf, parseOfficialItems, officialReportClaims, officialReportRevision, type PdfItem } from './officialInjuries';
import { fixtureInput, target } from '../fixtures';

const item = (str: string, x: number, y: number): PdfItem => ({ str, x, y, width: 40, height: 10 });
export function reportFixture() {
  const headers = ['Game Date', 'Game Time', 'Matchup', 'Team', 'Player Name', 'Current Status', 'Reason'].map((label, index) => item(label, index * 100, 750));
  return [[item('Injury Report: 10/07/26 04:00 PM', 0, 790), ...headers,
    item('10/07/2026', 0, 700), item('07:00 (ET)', 100, 700), item('AWY@HME', 200, 700), item('Fixture Home', 300, 700), item('Player 1', 400, 700), item('Out', 500, 700), item('Injury; Ankle', 600, 700),
    item('Fixture Away', 300, 680), item('NOT YET SUBMITTED', 400, 680)]];
}
describe('official injury document parsing', () => {
  it('preserves official report time, exact rows and explicit missing submissions', () => {
    const parsed = parseOfficialItems(reportFixture());
    expect(parsed.reportedAt).toBe('2026-10-07T20:00:00.000Z');
    expect(parsed.rows.map(row => row.status)).toEqual(['OUT', 'NOT_SUBMITTED']);
    const document = officialReportRevision(parsed, 'fixture', 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_fixture.pdf', '2026-10-07T21:00:00Z');
    const input = fixtureInput();
    const result = officialReportClaims(parsed, document, target, [{ teamId: 1, names: ['Fixture Home'] }, { teamId: 2, names: ['Fixture Away'] }], input.identities);
    expect(result.claims).toHaveLength(2);
    expect(result.claims[1].topic).toBe('MISSING_SUBMISSION');
    expect(result.claims[0].evidence.page).toBe(1);
  });
  it('refuses unclear layout, wrong games and unresolved identities instead of inventing availability', () => {
    expect(parseOfficialItems([[item('Injury Report: 10/07/26 04:00 PM', 0, 790)]]).issues.length).toBeGreaterThan(0);
    const parsed = parseOfficialItems(reportFixture());
    const doc = officialReportRevision(parsed, 'fixture', 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_fixture.pdf', '2026-10-07T21:00:00Z');
    expect(officialReportClaims(parsed, doc, { ...target, basketballDate: '2026-10-08' }, [], []).claims).toEqual([]);
    expect(officialReportClaims(parsed, doc, target, [{ teamId: 1, names: ['Fixture Home'] }], []).missing.join(' ')).toContain('Player 1');
  });
  it('runs text-only PDF extraction in a bounded worker without native canvas', async () => {
    const stream = 'BT /F1 12 Tf 30 750 Td (Fixture PDF) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const items = await extractOfficialPdf(new TextEncoder().encode(pdf));
    expect(items.flat().map(item => item.str).join(' ')).toContain('Fixture PDF');
    await expect(extractOfficialPdf(new Uint8Array([1, 2]))).rejects.toThrow('PDF');
  });
});