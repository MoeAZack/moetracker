import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('coherent UI integration guardrails', () => {
  it('keeps the coach brief truthful about unavailable engine data', () => {
    const dashboard = source('src/components/Dashboard.tsx');
    expect(dashboard).toContain('Unknown data stays unknown');
    expect(dashboard).toContain('No authoritative score exists');
    expect(dashboard).toContain('explicit player consent');
    expect(dashboard).not.toContain('Opponent history');
  });

  it('routes a dashboard match into the focused VOD review', () => {
    const app = source('src/App.tsx');
    expect(app).toContain('setReviewMatchId(matchId); setActiveTab(\'vod\')');
    expect(app).toContain('initialMatchId={reviewMatchId}');
  });

  it('labels replay extraction as review-required and non-writing', () => {
    const review = source('src/components/VodReview.tsx');
    expect(review).toContain('review-required and non-writing');
    expect(review).toContain('missing signals are unknown, never zero');
  });

  it('preserves role-aware read-only language for players', () => {
    const dashboard = source('src/components/Dashboard.tsx');
    expect(dashboard).toContain("role === 'player'");
    expect(dashboard).toContain('Player view is read-only');
  });
});
