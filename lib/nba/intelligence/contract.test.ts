import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNBAIntelligence } from './index';
import { fixtureInput } from './fixtures';

describe('isolated intelligence handoff', () => {
  it('serializes immutable versioned evidence with valid references and no model fields', () => {
    const input = fixtureInput(); const copy = JSON.stringify(input); const snapshot = buildNBAIntelligence(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.schemaVersion).toBe('1'); expect(Object.isFrozen(snapshot.evidence)).toBe(true);
    const ids = new Set(snapshot.evidence.map(entry => entry.id));
    for (const view of Object.values(snapshot.marketViews)) {
      expect(view.evidenceIds.length).toBe(new Set(view.evidenceIds).size);
      for (const id of view.evidenceIds) expect(ids.has(id)).toBe(true);
    }
    for (const key of ['projection', 'probability', 'ev', 'rank', 'score', 'tier']) expect(snapshot).not.toHaveProperty(key);
  });
  it('imports the existing NBA context contract only as a read-only type and has no model/shared/pricing imports', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = [...readdirSync(root).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')).map(file => `${root}/${file}`), ...readdirSync(`${root}/adapters`).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')).map(file => `${root}/adapters/${file}`)];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const match of contents.matchAll(/import\s+(type\s+)?[^;]+?from\s+['"]([^'"]+)['"]/g)) {
        expect(/projection|probability|\/odds|\/ai|\/mlb|\/nfl|finder/.test(match[2])).toBe(false);
        if (match[2].includes('/context/')) expect(match[1]).toBe('type ');
      }
    }
  });
});