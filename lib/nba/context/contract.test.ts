import { describe, expect, it } from 'vitest';
import { buildNBAResearchContext } from './index';
import { fixtureEnvironment } from './fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('projection-agent handoff contract', () => {
  it('serializes a versioned evidence-only snapshot with resolvable references', () => {
    const env = fixtureEnvironment();
    const context = buildNBAResearchContext(env.request, env.snapshot);
    expect(context.schemaVersion).toBe('1');
    expect(JSON.parse(JSON.stringify(context))).toEqual(context);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.evidence[0])).toBe(true);
    for (const key of ['projection', 'probability', 'ev', 'score', 'rank', 'tier', 'price']) expect(context).not.toHaveProperty(key);
    const ids = new Set(context.evidence.map(entry => entry.id));
    expect(ids.size).toBe(context.evidence.length);
    for (const view of Object.values(context.marketViews)) for (const id of view.evidenceIds) expect(ids.has(id)).toBe(true);
    for (const view of Object.values(context.marketViews)) {
      expect(new Set(view.evidenceIds).size).toBe(view.evidenceIds.length);
      for (const [group, evidenceIds] of Object.entries(view.groupedEvidence)) for (const id of evidenceIds) expect(context.evidence.find(entry => entry.id === id)?.correlationGroup).toBe(group);
    }
    for (const entry of context.evidence) {
      for (const id of entry.dependencyIds) expect(ids.has(id)).toBe(true);
      if (entry.kind === 'UNAVAILABLE') expect(entry.value).toBeNull();
      if (entry.kind === 'INFERENCE') expect(entry.reliability).not.toBe('HIGH');
    }
  });
  it('keeps production imports inside the standalone directory', () => {
    const directory = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(directory).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    for (const file of files) {
      const contents = readFileSync(`${directory}/${file}`, 'utf8');
      const imports = [...contents.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
      expect(imports.every(path => path.startsWith('./') && !path.includes('../'))).toBe(true);
    }
  });
});