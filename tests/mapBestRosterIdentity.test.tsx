import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MapBestStats from '../src/components/MapBestStats';

describe('map discipline roster identities', () => {
  it('does not resurrect legacy setting names after the canonical roster is cleared', () => {
    const data: any = {
      settings: {
        theme: 'midnight', maps: ['Haven'], players: ['Shalaby', 'Shniider'], inactivePlayers: ['Former'],
        stats: {}, weights: {},
      },
      rosterPlayers: [], matches: [], playerStats: [], rounds: [], strats: [], stratRuns: [],
    };

    const html = renderToStaticMarkup(<MapBestStats data={data} theme={{ border: 'border', cardBg: 'card' }} onUpsert={async () => null} onRemove={async () => null} />);

    expect(html).not.toContain('Shalaby');
    expect(html).not.toContain('Shniider');
    expect(html).not.toContain('Former');
  });
});
