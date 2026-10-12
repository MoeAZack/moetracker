import { describe, expect, it, vi } from 'vitest';
import { henrikSyncPlayer } from '../lib/services';

describe('legacy ranked integration fail-closed service', () => {
  it('performs zero fetches and zero writes when provider/consent/account gates are unavailable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const db = { settings: { riotIds: { Alpha: { name: 'Alpha', tag: 'ONE' } } }, soloq: [] };
    await expect(henrikSyncPlayer(db, 'Alpha')).rejects.toMatchObject({ status: 503, code: 'ranked-sync-gate-unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.soloq).toEqual([]);
    fetchSpy.mockRestore();
  });
});
