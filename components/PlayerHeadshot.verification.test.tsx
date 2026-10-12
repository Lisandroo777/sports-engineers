import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerHeadshot } from './PlayerHeadshot';

describe('AI photo provider identity verification', () => {
  it.each(['NBA', 'NFL'])('uses only a stable %s provider ID for its photo URL', sport => {
    const html = renderToStaticMarkup(<PlayerHeadshot sport={sport} playerId={12345} playerName="Fixture Player" />);
    expect(html).toContain(`https://a.espncdn.com/i/headshots/${sport.toLowerCase()}/players/full/12345.png`);
    expect(html).toContain('alt="Fixture Player"');
  });
  it('uses the MLB provider ID rather than guessing a name URL', () => {
    const html = renderToStaticMarkup(<PlayerHeadshot sport="MLB" playerId={12345} playerName="Fixture Player" />);
    expect(html).toContain('/people/12345/headshot/67/current');
  });
  it('uses initials without requesting a guessed photo when identity is missing', () => {
    const html = renderToStaticMarkup(<PlayerHeadshot sport="NBA" playerId={null} playerName="Fixture Player" />);
    expect(html).not.toContain('<img');
    expect(html).toContain('FP');
  });
});