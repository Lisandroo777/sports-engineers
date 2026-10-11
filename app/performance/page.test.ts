import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(process.cwd(), 'app/performance/page.tsx'), 'utf8');

describe('Performance page states and responsive layout', () => {
  it('provides an honest empty forward-ledger state and protected access gate', () => {
    expect(page).toContain('No forward recommendations recorded yet.');
    expect(page).toContain('Prediction records are not public.');
    expect(page).toContain('Restricted track record');
  });

  it('uses responsive single-column-to-multicolumn layouts for mobile widths', () => {
    expect(page).toContain('grid-cols-2');
    expect(page).toContain('sm:grid-cols-3');
    expect(page).toContain('lg:grid-cols-2');
    expect(page).toContain('grid gap-1 py-3 sm:grid-cols-');
  });
});
