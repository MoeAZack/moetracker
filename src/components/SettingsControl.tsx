import React, { useState, useEffect, useMemo } from 'react';
import { TrackerData, Settings } from '../types';
import { Settings as SettingsIcon, Save, Info, Key, Sliders, Plus, Trash2, Eye, EyeOff, UserCheck, UserMinus, ShieldAlert, Database, Download, Upload, Code, Copy, Check, FileCode, HardDrive } from 'lucide-react';
import { apiFetch } from '../utils/api';

interface ComponentProps {
  data: TrackerData;
  theme: any;
  onSaveSettings: (settings: Settings) => Promise<any>;
}

export default function SettingsControl({ data, theme, onSaveSettings }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'pool' | 'weights' | 'backup-import' | 'access-control'>('general');

  // --- ACCESS CONTROL AND KEY MANAGEMENT ---
  const [keysList, setKeysList] = useState<any[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyRole, setNewKeyRole] = useState<'coach' | 'player'>('player');
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const fetchKeys = async () => {
    setKeysLoading(true);
    setKeysError(null);
    try {
      const res = await apiFetch('/api/keys');
      if (!res.ok) throw new Error('Could not retrieve keys.');
      const json = await res.json();
      setKeysList(json);
    } catch (err: any) {
      setKeysError(err.message || 'Error loading keys.');
    } finally {
      setKeysLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyLabel.trim()) {
      alert('Please enter a player/coach name or custom label.');
      return;
    }
    try {
      const res = await apiFetch('/api/keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newKeyLabel,
          role: newKeyRole
        })
      });
      if (!res.ok) throw new Error('Failed to generate key.');
      setNewKeyLabel('');
      await fetchKeys();
    } catch (err: any) {
      alert(err.message || 'Key creation failed.');
    }
  };

  const handleRevokeKey = async (id: string, label: string) => {
    if (!window.confirm(`Are you absolutely sure you want to revoke access for "${label}"? They will be immediately disconnected and kicked out of the panel!`)) {
      return;
    }
    try {
      const res = await apiFetch('/api/keys/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!res.ok) throw new Error('Failed to revoke key.');
      await fetchKeys();
    } catch (err: any) {
      alert(err.message || 'Revocation failed.');
    }
  };

  const handleCopyKeyToClipboard = (id: string, keyVal: string) => {
    navigator.clipboard.writeText(keyVal);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  useEffect(() => {
    if (activeSubTab === 'access-control') {
      fetchKeys();
    }
  }, [activeSubTab]);

  // --- IMPORT & BACKUP STATES ---
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [gsCopied, setGsCopied] = useState(false);
  const [htmlCopied, setHtmlCopied] = useState(false);
  const [appsScriptView, setAppsScriptView] = useState<'gs' | 'html'>('gs');

  // --- SETTINGS FORM STATE ---
  const [teamName, setTeamName] = useState(data.settings.teamName || 'Vandals Esports');
  const [themeMode, setThemeMode] = useState(data.settings.theme || 'slate');

  // Interactive Lists States (Active vs Inactive)
  const [activePlayers, setActivePlayers] = useState<string[]>(data.settings.players || []);
  const [inactivePlayers, setInactivePlayers] = useState<string[]>(data.settings.inactivePlayers || []);

  const [activeMaps, setActiveMaps] = useState<string[]>(data.settings.maps || []);
  const [inactiveMaps, setInactiveMaps] = useState<string[]>(data.settings.inactiveMaps || []);

  const [activeAgents, setActiveAgents] = useState<string[]>(data.settings.agents || []);
  const [inactiveAgents, setInactiveAgents] = useState<string[]>(data.settings.inactiveAgents || []);

  // Form helpers for adding items
  const [newPlayer, setNewPlayer] = useState('');
  const [newMap, setNewMap] = useState('');
  const [newAgent, setNewAgent] = useState('');

  // Weights state
  const [wMapWin, setWMapWin] = useState(data.settings.weights?.mapWin ?? 25);
  const [wAttWin, setWAttWin] = useState(data.settings.weights?.attWin ?? 12.5);
  const [wDefWin, setWDefWin] = useState(data.settings.weights?.defWin ?? 12.5);
  const [wPistol, setWPistol] = useState(data.settings.weights?.pistol ?? 20);
  const [wEco, setWEco] = useState(data.settings.weights?.eco ?? 10);
  const [wBonus, setWBonus] = useState(data.settings.weights?.bonus ?? 10);
  const [wKd, setWKd] = useState(data.settings.weights?.kd ?? 10);

  // Confidence / Stats configurations
  const [shrinkK, setShrinkK] = useState(data.settings.stats?.shrinkK ?? 10);
  const [lowSample, setLowSample] = useState(data.settings.stats?.lowSample ?? 15);
  const [decayEnabled, setDecayEnabled] = useState(data.settings.stats?.decayEnabled ?? false);
  const [halfLifeDays, setHalfLifeDays] = useState(data.settings.stats?.halfLifeDays ?? 120);
  const [rollingWindow, setRollingWindow] = useState(data.settings.stats?.rollingWindow ?? 10);

  // Advanced configurations
  const [discordWebhook, setDiscordWebhook] = useState(data.settings.discordWebhook || '');
  const [aiModel, setAiModel] = useState(data.settings.ai?.model || 'gemini-2.5-flash');
  const [vlrBaseUrl, setVlrBaseUrl] = useState(data.settings.vlr?.baseUrl || '');
  const [vlrTeamId, setVlrTeamId] = useState(data.settings.vlr?.teamId || '');
  const [vlrTeamName, setVlrTeamName] = useState(data.settings.vlr?.teamName || '');
  const [henrikApiKey, setHenrikApiKey] = useState(data.settings.henrikApiKey || '');
  const [gridApiKey, setGridApiKey] = useState(data.settings.gridApiKey || '');
  const [confirmOnSave, setConfirmOnSave] = useState(data.settings.confirmOnSave ?? true);
  const [confirmOnDelete, setConfirmOnDelete] = useState(data.settings.confirmOnDelete ?? true);

  // Raw inputs advanced toggle fallback
  const [showRawTextarea, setShowRawTextarea] = useState(false);
  const [rawPlayersText, setRawPlayersText] = useState((data.settings.players || []).join(', '));
  const [rawMapsText, setRawMapsText] = useState((data.settings.maps || []).join(', '));
  const [rawAgentsText, setRawAgentsText] = useState((data.settings.agents || []).join(', '));

  // Feedback states
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // --- MUTATION HELPERS FOR LISTS ---
  const handleAddPlayer = () => {
    const val = newPlayer.trim();
    if (!val) return;
    if (activePlayers.includes(val) || inactivePlayers.includes(val)) {
      alert('This player is already in your active or benched roster!');
      return;
    }
    setActivePlayers([...activePlayers, val]);
    setNewPlayer('');
  };

  const handleTogglePlayer = (pName: string, isCurrentlyActive: boolean) => {
    if (isCurrentlyActive) {
      setActivePlayers(activePlayers.filter(x => x !== pName));
      if (!inactivePlayers.includes(pName)) {
        setInactivePlayers([...inactivePlayers, pName]);
      }
    } else {
      setInactivePlayers(inactivePlayers.filter(x => x !== pName));
      if (!activePlayers.includes(pName)) {
        setActivePlayers([...activePlayers, pName]);
      }
    }
  };

  const handleDeletePlayer = (pName: string, isFromActive: boolean) => {
    if (confirmOnDelete && !window.confirm(`Are you sure you want to completely remove player "${pName}"? Historics for this player won't delete, but they will clear from selectors.`)) return;
    if (isFromActive) {
      setActivePlayers(activePlayers.filter(x => x !== pName));
    } else {
      setInactivePlayers(inactivePlayers.filter(x => x !== pName));
    }
  };

  const handleAddMap = () => {
    const val = newMap.trim();
    if (!val) return;
    if (activeMaps.includes(val) || inactiveMaps.includes(val)) {
      alert('This map is already in the map pools list!');
      return;
    }
    setActiveMaps([...activeMaps, val]);
    setNewMap('');
  };

  const handleToggleMap = (mName: string, isCurrentlyActive: boolean) => {
    if (isCurrentlyActive) {
      setActiveMaps(activeMaps.filter(x => x !== mName));
      if (!inactiveMaps.includes(mName)) {
        setInactiveMaps([...inactiveMaps, mName]);
      }
    } else {
      setInactiveMaps(inactiveMaps.filter(x => x !== mName));
      if (!activeMaps.includes(mName)) {
        setActiveMaps([...activeMaps, mName]);
      }
    }
  };

  const handleDeleteMap = (mName: string, isFromActive: boolean) => {
    if (confirmOnDelete && !window.confirm(`Permanently delete map "${mName}"?`)) return;
    if (isFromActive) {
      setActiveMaps(activeMaps.filter(x => x !== mName));
    } else {
      setInactiveMaps(inactiveMaps.filter(x => x !== mName));
    }
  };

  const handleAddAgent = () => {
    const val = newAgent.trim();
    if (!val) return;
    if (activeAgents.includes(val) || inactiveAgents.includes(val)) {
      alert('This Agent is already in the list!');
      return;
    }
    setActiveAgents([...activeAgents, val]);
    setNewAgent('');
  };

  const handleToggleAgent = (aName: string, isCurrentlyActive: boolean) => {
    if (isCurrentlyActive) {
      setActiveAgents(activeAgents.filter(x => x !== aName));
      if (!inactiveAgents.includes(aName)) {
        setInactiveAgents([...inactiveAgents, aName]);
      }
    } else {
      setInactiveAgents(inactiveAgents.filter(x => x !== aName));
      if (!activeAgents.includes(aName)) {
        setActiveAgents([...activeAgents, aName]);
      }
    }
  };

  const handleDeleteAgent = (aName: string, isFromActive: boolean) => {
    if (confirmOnDelete && !window.confirm(`Permanently remove agent "${aName}"?`)) return;
    if (isFromActive) {
      setActiveAgents(activeAgents.filter(x => x !== aName));
    } else {
      setInactiveAgents(inactiveAgents.filter(x => x !== aName));
    }
  };

  // --- SAVE ---
  const handleSaveAllSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);

    let finalPlayers = activePlayers;
    let finalInactivePlayers = inactivePlayers;
    let finalMaps = activeMaps;
    let finalInactiveMaps = inactiveMaps;
    let finalAgents = activeAgents;
    let finalInactiveAgents = inactiveAgents;

    if (showRawTextarea) {
      // Use advanced fallback raw inputs
      finalPlayers = rawPlayersText.split(',').map(s => s.trim()).filter(Boolean);
      finalMaps = rawMapsText.split(',').map(s => s.trim()).filter(Boolean);
      finalAgents = rawAgentsText.split(',').map(s => s.trim()).filter(Boolean);
    }

    const updatedSettings: Settings = {
      ...data.settings,
      teamName,
      theme: themeMode,
      players: finalPlayers,
      inactivePlayers: finalInactivePlayers,
      maps: finalMaps,
      inactiveMaps: finalInactiveMaps,
      agents: finalAgents,
      inactiveAgents: finalInactiveAgents,
      weights: {
        mapWin: Number(wMapWin),
        attWin: Number(wAttWin),
        defWin: Number(wDefWin),
        pistol: Number(wPistol),
        eco: Number(wEco),
        bonus: Number(wBonus),
        kd: Number(wKd)
      },
      stats: {
        shrinkK: Number(shrinkK),
        lowSample: Number(lowSample),
        decayEnabled,
        halfLifeDays: Number(halfLifeDays),
        rollingWindow: Number(rollingWindow)
      },
      discordWebhook,
      henrikApiKey,
      gridApiKey,
      confirmOnSave,
      confirmOnDelete,
      vlr: {
        baseUrl: vlrBaseUrl,
        teamId: vlrTeamId,
        teamName: vlrTeamName
      },
      ai: {
        model: aiModel
      }
    };

    try {
      await onSaveSettings(updatedSettings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <SettingsIcon className={`w-5 h-5 ${theme.text}`} />
          <h3 className="font-black text-sm tracking-wide uppercase">Workspace Team Configurations</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sub navigation column */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-white/5 border-white/10'} h-fit lg:col-span-1 space-y-1 text-xs`}>
          {[
            { id: 'general', label: 'General & API Integrations', icon: Info },
            { id: 'pool', label: 'Rosters & Map Pools', icon: Sliders },
            { id: 'weights', label: 'Calculator Weights & Stats', icon: Key },
            { id: 'access-control', label: 'Access Control & Keys', icon: UserCheck },
            { id: 'backup-import', label: 'Backup & Database Sync', icon: Database }
          ].map(sb => {
            const Icon = sb.icon;
            return (
              <button
                key={sb.id}
                type="button"
                onClick={() => setActiveSubTab(sb.id as any)}
                className={`w-full text-left p-2.5 rounded font-mono font-bold transition-all flex items-center gap-2 ${
                  activeSubTab === sb.id
                    ? 'bg-[#ff4655]/10 border-l-4 border-[#ff4655] text-[#ff4655]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                {sb.label}
              </button>
            );
          })}
        </div>

        {/* Right form submission panel */}
        <div className="lg:col-span-3">
          <form onSubmit={handleSaveAllSettings} className={`p-6 rounded-2xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-6`}>
            
            {/* SUB TAB: GENERAL */}
            {activeSubTab === 'general' && (
              <div className="space-y-4">
                <h4 className="text-xs uppercase font-black tracking-widest text-[#ff4655] font-mono border-b border-white/5 pb-1">
                  General Team Customizations
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Team / Workspace Name</label>
                    <input
                      type="text"
                      required
                      value={teamName}
                      onChange={e => setTeamName(e.target.value)}
                      className="w-full p-2.5 bg-black/20 text-white rounded border border-white/10 text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Visual UI Palette</label>
                    <select
                      value={themeMode}
                      onChange={e => setThemeMode(e.target.value)}
                      className="w-full p-2.5 bg-black/20 text-white rounded border border-white/10 text-xs font-bold"
                    >
                      <option value="slate">Slate Valorant Theme</option>
                      <option value="cosmic">Cosmic Nebula Dark</option>
                      <option value="daylight">Daylight Sleek (Light Mode)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5">
                  <h5 className="text-[10px] uppercase font-black text-gray-400 font-mono flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-[#ff4655]" /> External API & Webhook Endpoints
                  </h5>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-black text-gray-500 font-mono block">HenrikDev Valorant API Key</label>
                    <input
                      type="password"
                      placeholder="HDEV-XXXXXXXX"
                      value={henrikApiKey}
                      onChange={e => setHenrikApiKey(e.target.value)}
                      className="w-full p-2.5 bg-black/25 text-white border border-white/10 rounded text-xs font-mono"
                    />
                    <p className="text-[9px] text-gray-500 leading-relaxed font-mono">
                      Provides real-time Solo Queue MMR standings & placement rank updates for all players in your team roster. Leave blank to use local mocks.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-black text-[#ff4655] font-mono block">Official GRID.gg API Key</label>
                    <input
                      type="password"
                      placeholder="GRID-XXXXXXXX"
                      value={gridApiKey}
                      onChange={e => setGridApiKey(e.target.value)}
                      className="w-full p-2.5 bg-black/25 text-white border border-rose-500/30 focus:border-rose-500 rounded text-xs font-mono"
                    />
                    <p className="text-[9px] text-gray-400 leading-relaxed font-mono">
                      Unlocks official Riot Games live esports telemetry feed, round splits, structural series mappings, and pro tier statistics.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-black text-gray-500 font-mono block">Discord Webhook Notification URL</label>
                    <input
                      type="text"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={discordWebhook}
                      onChange={e => setDiscordWebhook(e.target.value)}
                      className="w-full p-2.5 bg-black/25 text-white border border-white/10 rounded text-xs font-mono"
                    />
                    <p className="text-[9px] text-gray-500 leading-relaxed font-mono">
                      Broadcasts beautiful scrim results summaries, round splits, MVP details, and practice schedules alerts directly to your Discord Channels.
                    </p>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-white/5 font-mono text-xs text-left">
                  <h5 className="text-[10px] uppercase font-black text-gray-400 font-mono flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-[#ff4655]" /> AI Co-pilot & VLR.gg Scraping Config
                  </h5>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-gray-500 block">AI Reasoning Model</label>
                      <select
                        value={aiModel}
                        onChange={e => setAiModel(e.target.value)}
                        className="w-full p-2.5 bg-black/25 text-white border border-white/10 rounded text-xs font-bold"
                      >
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash (Ultra-fast, recommended)</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro (High fidelity reasoning)</option>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash (Standard legacy)</option>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep analytical legacy)</option>
                      </select>
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        Select which Google Gemini reasoning engine powers the OCR scoreboard parser, strategy creator, and post-match tactical logs.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-gray-500 block">VLR.gg Team Name</label>
                      <input
                        type="text"
                        placeholder="e.g. RAAD"
                        value={vlrTeamName}
                        onChange={e => setVlrTeamName(e.target.value)}
                        className="w-full p-2.5 bg-black/25 text-white border border-white/10 rounded text-xs"
                      />
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        The exact team name on VLR.GG to match during VLR match statistics imports.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-gray-500 block">VLR.gg Team ID</label>
                      <input
                        type="text"
                        placeholder="e.g. 12044"
                        value={vlrTeamId}
                        onChange={e => setVlrTeamId(e.target.value)}
                        className="w-full p-2.5 bg-black/25 text-white border border-white/10 rounded text-xs"
                      />
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        The internal ID on VLR.gg for scraping roster and match stats.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-gray-500 block">VLR.gg Scraper API Base URL</label>
                      <input
                        type="text"
                        placeholder="https://vlrggapi.vercel.app"
                        value={vlrBaseUrl}
                        onChange={e => setVlrBaseUrl(e.target.value)}
                        className="w-full p-2.5 bg-black/25 text-white border border-white/10 rounded text-xs font-mono"
                      />
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        URL of the VLR.gg scraper proxy. Defaults to the official parser mirror.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-4 border-t border-white/5">
                  <h5 className="text-[10px] uppercase font-black text-gray-400 font-mono">Safety Confirmations & Global Toggles</h5>
                  <div className="flex flex-col sm:flex-row gap-4 font-mono text-xs text-gray-400">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmOnSave}
                        onChange={e => setConfirmOnSave(e.target.checked)}
                        className="rounded"
                      />
                      Confirm before Saving/Recording items
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmOnDelete}
                        onChange={e => setConfirmOnDelete(e.target.checked)}
                        className="rounded"
                      />
                      Confirm before Deleting logs/vetos
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: POOL */}
            {activeSubTab === 'pool' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-xs uppercase font-black tracking-widest text-[#ff4655] font-mono border-b border-white/5 pb-1 flex justify-between items-center">
                    <span>Interactive Roster, Map Pools & Agents List</span>
                    <button
                      type="button"
                      onClick={() => setShowRawTextarea(!showRawTextarea)}
                      className="text-[9px] text-gray-500 hover:text-white uppercase px-2 py-0.5 border border-white/10 rounded font-bold"
                    >
                      {showRawTextarea ? "Show Interactive Lists" : "Show Advanced Raw Text"}
                    </button>
                  </h4>
                  <p className="text-[9.5px] text-gray-400 font-mono mt-1">
                    Toggle active or inactive status for any item. Inactive items won't display in match inputs, preventing dropdown clutter, while safely preserving older history.
                  </p>
                </div>

                {showRawTextarea ? (
                  <div className="space-y-4">
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      <p className="text-[9.5px] text-rose-400 font-mono leading-relaxed">
                        WARNING: Raw editing replaces the entire lists and bypasses inactive-toggle memory. We recommend using the visual builders instead.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-black text-gray-400 font-mono block">Roster Player tags (Comma-separated)</label>
                        <textarea
                          rows={2}
                          value={rawPlayersText}
                          onChange={e => setRawPlayersText(e.target.value)}
                          className="w-full p-2 bg-black/20 text-white rounded border border-white/10 text-xs font-mono"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-black text-gray-400 font-mono block">Active Maps (Comma-separated)</label>
                        <textarea
                          rows={2}
                          value={rawMapsText}
                          onChange={e => setRawMapsText(e.target.value)}
                          className="w-full p-2 bg-black/20 text-white rounded border border-white/10 text-xs font-mono"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-black text-gray-400 font-mono block">Selectable Agents list (Comma-separated)</label>
                        <textarea
                          rows={3}
                          value={rawAgentsText}
                          onChange={e => setRawAgentsText(e.target.value)}
                          className="w-full p-2 bg-black/20 text-white rounded border border-white/10 text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* SECTION 1: PLAYERS ROSTER */}
                    <div className="space-y-3 bg-black/10 p-4 rounded-xl border border-white/5">
                      <h5 className="text-[11px] font-bold font-mono uppercase text-[#ff4655] tracking-wider">
                        1. ROSTER PLAYER MEMBERS ({activePlayers.length} Active, {inactivePlayers.length} Benched)
                      </h5>
                      
                      {/* Grid lists */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Active list */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] uppercase font-black text-emerald-400 font-mono block">Active Starters</label>
                          <div className="bg-black/20 rounded-lg p-2 border border-white/5 space-y-1 max-h-[160px] overflow-y-auto">
                            {activePlayers.length === 0 ? (
                              <p className="text-[10px] text-gray-500 font-mono p-2 text-center">No active players configured.</p>
                            ) : (
                              activePlayers.map(p => (
                                <div key={p} className="flex justify-between items-center text-xs p-1.5 rounded hover:bg-white/5 font-mono">
                                  <span className="font-bold text-white flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    {p}
                                  </span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleTogglePlayer(p, true)}
                                      className="text-[9px] font-bold text-gray-400 hover:text-amber-400 uppercase bg-black/20 px-1.5 py-0.5 rounded border border-white/5"
                                      title="Toggle to Bench / Inactive"
                                    >
                                      Bench
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeletePlayer(p, true)}
                                      className="text-gray-500 hover:text-rose-500"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Inactive list */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] uppercase font-black text-gray-400 font-mono block">Benched / Inactive Roster</label>
                          <div className="bg-black/20 rounded-lg p-2 border border-white/5 space-y-1 max-h-[160px] overflow-y-auto">
                            {inactivePlayers.length === 0 ? (
                              <p className="text-[10px] text-gray-600 font-mono p-2 text-center">No benched players.</p>
                            ) : (
                              inactivePlayers.map(p => (
                                <div key={p} className="flex justify-between items-center text-xs p-1.5 rounded hover:bg-white/5 font-mono">
                                  <span className="font-bold text-gray-400 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                                    {p}
                                  </span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleTogglePlayer(p, false)}
                                      className="text-[9px] font-bold text-emerald-400 hover:text-emerald-300 uppercase bg-black/20 px-1.5 py-0.5 rounded border border-white/5"
                                      title="Restore to Active"
                                    >
                                      Activate
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeletePlayer(p, false)}
                                      className="text-gray-500 hover:text-rose-500"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Inline add builder */}
                      <div className="flex gap-2 pt-2">
                        <input
                          type="text"
                          placeholder="Insert new player tag (e.g. Shalaby)"
                          value={newPlayer}
                          onChange={e => setNewPlayer(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddPlayer(); } }}
                          className="flex-1 p-2 bg-black/25 text-white border border-white/10 rounded text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleAddPlayer}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs font-mono rounded-lg flex items-center gap-1.5"
                        >
                          <Plus className="w-4 h-4" /> ADD PLAYER
                        </button>
                      </div>
                    </div>


                    {/* SECTION 2: MAP POOLS ROTATION */}
                    <div className="space-y-3 bg-black/10 p-4 rounded-xl border border-white/5">
                      <h5 className="text-[11px] font-bold font-mono uppercase text-[#ff4655] tracking-wider">
                        2. MAPS POOLS ROTATION ({activeMaps.length} Active, {inactiveMaps.length} Rotated Out)
                      </h5>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Active Maps */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] uppercase font-black text-cyan-400 font-mono block">In Competitive Rotation</label>
                          <div className="bg-black/20 rounded-lg p-2 border border-white/5 space-y-1 max-h-[160px] overflow-y-auto">
                            {activeMaps.length === 0 ? (
                              <p className="text-[10px] text-gray-500 font-mono p-2 text-center">No active maps configured.</p>
                            ) : (
                              activeMaps.map(m => (
                                <div key={m} className="flex justify-between items-center text-xs p-1.5 rounded hover:bg-white/5 font-mono">
                                  <span className="font-bold text-white flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                                    {m}
                                  </span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleMap(m, true)}
                                      className="text-[9px] font-bold text-gray-400 hover:text-amber-400 uppercase bg-black/20 px-1.5 py-0.5 rounded border border-white/5"
                                      title="Toggle out of active pool"
                                    >
                                      Disable
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteMap(m, true)}
                                      className="text-gray-500 hover:text-rose-500"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Inactive Maps */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] uppercase font-black text-gray-400 font-mono block">Rotated Out / Disabled</label>
                          <div className="bg-black/20 rounded-lg p-2 border border-white/5 space-y-1 max-h-[160px] overflow-y-auto">
                            {inactiveMaps.length === 0 ? (
                              <p className="text-[10px] text-gray-600 font-mono p-2 text-center">No inactive maps.</p>
                            ) : (
                              inactiveMaps.map(m => (
                                <div key={m} className="flex justify-between items-center text-xs p-1.5 rounded hover:bg-white/5 font-mono">
                                  <span className="font-bold text-gray-400 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                                    {m}
                                  </span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleMap(m, false)}
                                      className="text-[9px] font-bold text-cyan-400 hover:text-cyan-300 uppercase bg-black/20 px-1.5 py-0.5 rounded border border-white/5"
                                      title="Add to active pool"
                                    >
                                      Enable
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteMap(m, false)}
                                      className="text-gray-500 hover:text-rose-500"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <input
                          type="text"
                          placeholder="Insert new Map name (e.g. Abyss)"
                          value={newMap}
                          onChange={e => setNewMap(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMap(); } }}
                          className="flex-1 p-2 bg-black/25 text-white border border-white/10 rounded text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleAddMap}
                          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white font-black text-xs font-mono rounded-lg flex items-center gap-1.5"
                        >
                          <Plus className="w-4 h-4" /> ADD MAP
                        </button>
                      </div>
                    </div>


                    {/* SECTION 3: AGENTS ROTATION */}
                    <div className="space-y-3 bg-black/10 p-4 rounded-xl border border-white/5">
                      <h5 className="text-[11px] font-bold font-mono uppercase text-[#ff4655] tracking-wider">
                        3. AGENT POOLS ({activeAgents.length} Active, {inactiveAgents.length} Inactive)
                      </h5>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Active Agents */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] uppercase font-black text-amber-500 font-mono block">Active / Common</label>
                          <div className="bg-black/20 rounded-lg p-2 border border-white/5 space-y-1 max-h-[160px] overflow-y-auto">
                            {activeAgents.length === 0 ? (
                              <p className="text-[10px] text-gray-500 font-mono p-2 text-center">No active agents configured.</p>
                            ) : (
                              activeAgents.map(a => (
                                <div key={a} className="flex justify-between items-center text-xs p-1.5 rounded hover:bg-white/5 font-mono">
                                  <span className="font-bold text-white flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                    {a}
                                  </span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleAgent(a, true)}
                                      className="text-[9px] font-bold text-gray-400 hover:text-amber-400 uppercase bg-black/20 px-1.5 py-0.5 rounded border border-white/5"
                                      title="Toggle to inactive/rare agent"
                                    >
                                      Disable
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteAgent(a, true)}
                                      className="text-gray-500 hover:text-rose-500"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Inactive Agents */}
                        <div className="space-y-1.5">
                          <label className="text-[9px] uppercase font-black text-gray-400 font-mono block">Rare / Disabled Agents</label>
                          <div className="bg-black/20 rounded-lg p-2 border border-white/5 space-y-1 max-h-[160px] overflow-y-auto">
                            {inactiveAgents.length === 0 ? (
                              <p className="text-[10px] text-gray-600 font-mono p-2 text-center">No inactive agents.</p>
                            ) : (
                              inactiveAgents.map(a => (
                                <div key={a} className="flex justify-between items-center text-xs p-1.5 rounded hover:bg-white/5 font-mono">
                                  <span className="font-bold text-gray-400 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                                    {a}
                                  </span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleAgent(a, false)}
                                      className="text-[9px] font-bold text-amber-400 hover:text-amber-300 uppercase bg-black/20 px-1.5 py-0.5 rounded border border-white/5"
                                      title="Enable agent"
                                    >
                                      Enable
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteAgent(a, false)}
                                      className="text-gray-500 hover:text-rose-500"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <input
                          type="text"
                          placeholder="Insert Agent name (e.g. Vyse)"
                          value={newAgent}
                          onChange={e => setNewAgent(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddAgent(); } }}
                          className="flex-1 p-2 bg-black/25 text-white border border-white/10 rounded text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleAddAgent}
                          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs font-mono rounded-lg flex items-center gap-1.5"
                        >
                          <Plus className="w-4 h-4" /> ADD AGENT
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SUB TAB: WEIGHTS */}
            {activeSubTab === 'weights' && (
              <div className="space-y-4">
                <h4 className="text-xs uppercase font-black tracking-widest text-[#ff4655] font-mono border-b border-white/5 pb-1">
                  Map Best Rating Coefficient Weights
                </h4>
                <p className="text-[10px] text-gray-400 font-mono leading-relaxed">
                  These weights adjust how much each metric influences the map rating algorithm. High-performance teams weight map wins and pistol rounds heavily to reflect tournament outcomes.
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-gray-500">Map Win Weight</label>
                    <input
                      type="number"
                      step={0.5}
                      value={wMapWin}
                      onChange={e => setWMapWin(Number(e.target.value))}
                      className="w-full p-2 bg-black/20 text-white border border-white/10 rounded"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-gray-500">ATT Win weight</label>
                    <input
                      type="number"
                      step={0.5}
                      value={wAttWin}
                      onChange={e => setWAttWin(Number(e.target.value))}
                      className="w-full p-2 bg-black/20 text-white border border-white/10 rounded"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-gray-500">DEF Win weight</label>
                    <input
                      type="number"
                      step={0.5}
                      value={wDefWin}
                      onChange={e => setWDefWin(Number(e.target.value))}
                      className="w-full p-2 bg-black/20 text-white border border-white/10 rounded"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-gray-500">Pistols weight</label>
                    <input
                      type="number"
                      step={0.5}
                      value={wPistol}
                      onChange={e => setWPistol(Number(e.target.value))}
                      className="w-full p-2 bg-black/20 text-white border border-white/10 rounded"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-gray-500">Ecos weight</label>
                    <input
                      type="number"
                      step={0.5}
                      value={wEco}
                      onChange={e => setWEco(Number(e.target.value))}
                      className="w-full p-2 bg-black/20 text-white border border-white/10 rounded"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-gray-500">Bonus weight</label>
                    <input
                      type="number"
                      step={0.5}
                      value={wBonus}
                      onChange={e => setWBonus(Number(e.target.value))}
                      className="w-full p-2 bg-black/20 text-white border border-white/10 rounded"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-gray-500">K/D weight</label>
                    <input
                      type="number"
                      step={0.5}
                      value={wKd}
                      onChange={e => setWKd(Number(e.target.value))}
                      className="w-full p-2 bg-black/20 text-white border border-white/10 rounded"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/5 font-mono text-xs">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-black text-gray-500 block">Shrinkage Factor (K Coefficient)</label>
                    <input
                      type="number"
                      value={shrinkK}
                      onChange={e => setShrinkK(Number(e.target.value))}
                      className="w-full p-2.5 bg-black/20 text-white border border-white/10 rounded"
                    />
                    <p className="text-[9px] text-gray-500 leading-relaxed mt-0.5">Determines how aggressively map scores on low-sample pools are regressed towards 50% average to prevent statistical variance distortion.</p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-black text-gray-500 block">Low Sample Boundary threshold</label>
                    <input
                      type="number"
                      value={lowSample}
                      onChange={e => setLowSample(Number(e.target.value))}
                      className="w-full p-2.5 bg-black/20 text-white border border-white/10 rounded"
                    />
                    <p className="text-[9px] text-gray-500 leading-relaxed mt-0.5">Defines the play-count ceiling below which map pools are highlighted as critically small sample sizes.</p>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-4 space-y-4 font-mono text-xs text-left">
                  <h5 className="text-[11px] font-black uppercase text-[#ff4655]">Form Decay & Recency Controls</h5>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer text-white font-bold">
                        <input
                          type="checkbox"
                          checked={decayEnabled}
                          onChange={e => setDecayEnabled(e.target.checked)}
                          className="rounded"
                        />
                        Enable Recency-Based Time Decay
                      </label>
                      <p className="text-[9px] text-gray-400 leading-relaxed">If enabled, older matches contribute less to current stats. Newer scrims/matches carry more predictive weight.</p>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-black text-gray-500 block">Half-Life of Match Weight (Days)</label>
                      <input
                        type="number"
                        disabled={!decayEnabled}
                        value={halfLifeDays}
                        onChange={e => setHalfLifeDays(Number(e.target.value))}
                        className={`w-full p-2.5 bg-black/20 text-white border border-white/10 rounded ${!decayEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                      />
                      <p className="text-[9px] text-gray-500 leading-relaxed mt-0.5">The period after which a match's impact is reduced by 50%. (Default: 120 days)</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-black text-gray-500 block">Rolling Window Limit (Matches)</label>
                    <input
                      type="number"
                      value={rollingWindow}
                      onChange={e => setRollingWindow(Number(e.target.value))}
                      className="w-full p-2.5 bg-black/20 text-white border border-white/10 rounded"
                    />
                    <p className="text-[9px] text-gray-500 leading-relaxed mt-0.5">Determines the maximum number of recent matches to analyze in calculations (e.g. last 10 maps). Set to 0 to disable rolling window constraint.</p>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: BACKUP & DATABASE SYNC */}
            {activeSubTab === 'backup-import' && (
              <div className="space-y-6 text-left">
                <div className="border-b border-white/10 pb-2">
                  <h4 className="text-xs uppercase font-black tracking-widest text-[#ff4655] font-mono">
                    Database Backup & Migration Suite
                  </h4>
                  <p className="text-[11px] text-gray-400 mt-1">Export, back up, or restore your entire team’s database locally using a structured JSON file.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                  {/* Backup Card */}
                  <div className={`p-5 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/5 border-white/10'} space-y-4`}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-[#ff4655]/10 text-[#ff4655]">
                        <Download className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold font-mono">Export Local Database</h5>
                        <p className="text-[10px] text-gray-400">Download a full JSON dump of your scrim logs, rosters, and stats.</p>
                      </div>
                    </div>
                    
                    <button
                      type="button"
                      onClick={() => {
                        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
                        const downloadAnchor = document.createElement('a');
                        downloadAnchor.setAttribute("href", dataStr);
                        downloadAnchor.setAttribute("download", `scrim_tracker_backup_${new Date().toISOString().slice(0, 10)}.json`);
                        document.body.appendChild(downloadAnchor);
                        downloadAnchor.click();
                        downloadAnchor.remove();
                      }}
                      className="w-full py-2.5 bg-[#ff4655] hover:bg-[#ff4655]/90 text-white font-mono font-bold text-xs rounded transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      Download JSON Backup
                    </button>
                  </div>

                  {/* Restore Card */}
                  <div className={`p-5 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/5 border-white/10'} space-y-4`}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold font-mono text-amber-500">Restore / Import Payload</h5>
                        <p className="text-[10px] text-gray-400">Overwrite the database by uploading a valid JSON backup file.</p>
                      </div>
                    </div>

                    <div className="relative">
                      <input
                        type="file"
                        accept=".json"
                        disabled={importing}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;

                          setImportError(null);
                          setImportSuccess(false);
                          setImporting(true);

                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            try {
                              const parsed = JSON.parse(event.target?.result as string);
                              
                              const resp = await apiFetch('/api/import', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(parsed)
                              });
                              
                              if (!resp.ok) {
                                const errData = await resp.json();
                                throw new Error(errData.error || 'Import failed.');
                              }
                              
                              setImportSuccess(true);
                              setTimeout(() => {
                                window.location.reload();
                              }, 1500);
                            } catch (err: any) {
                              setImportError(err.message || 'Failed to parse JSON file.');
                            } finally {
                              setImporting(false);
                            }
                          };
                          reader.readAsText(file);
                        }}
                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10 disabled:cursor-not-allowed"
                      />
                      <div className="w-full py-2.5 border border-dashed border-amber-500/30 rounded flex items-center justify-center gap-2 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10 transition text-xs font-mono font-bold">
                        <Upload className="w-4 h-4" />
                        {importing ? 'IMPORTING...' : 'Upload JSON File'}
                      </div>
                    </div>

                    {importSuccess && (
                      <p className="text-[10px] text-emerald-400 font-mono font-bold animate-pulse">
                        ✓ Import successful! Re-syncing and reloading the workspace...
                      </p>
                    )}
                    {importError && (
                      <p className="text-[10px] text-rose-500 font-mono font-bold flex items-center gap-1">
                        ⚠️ Error: {importError}
                      </p>
                    )}
                  </div>
                </div>

                {/* Danger Zone */}
                <div className={`p-5 rounded-xl border ${isLight ? 'bg-rose-50 border-rose-100 text-slate-800' : 'bg-rose-950/20 border-rose-500/20 text-white'} space-y-4`}>
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-rose-500/10 text-rose-500">
                      <Trash2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold font-mono text-rose-500 uppercase">Danger Zone — Reset Database Metrics</h5>
                      <p className="text-[10px] text-gray-400 mt-1">Permanently erase all matches, player stats, round histories, vetos, schedule items, team goals, and strategy logs. Your customized roster players, maps, and theme settings will be preserved.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("CRITICAL WARNING: Are you absolutely sure you want to wipe all statistics and logs? This will delete all matches, player stats, rounds, schedule, goals, strategies, and solo queue records. This action cannot be undone.")) {
                        return;
                      }
                      
                      try {
                        const resp = await apiFetch('/api/reset-metrics', {
                          method: 'POST'
                        });
                        
                        if (!resp.ok) {
                          throw new Error('Reset request failed on server.');
                        }
                        
                        alert('Database metrics successfully reset to fresh status.');
                        window.location.reload();
                      } catch (err: any) {
                        alert(err.message || 'Wipe operation failed.');
                      }
                    }}
                    className="w-full md:w-auto px-6 py-2.5 bg-[#ff4655] hover:bg-[#ff4655]/90 text-white font-mono font-bold text-xs rounded transition flex items-center justify-center gap-2 cursor-pointer border border-[#ff4655]/30 hover:border-white/10"
                  >
                    <Trash2 className="w-4 h-4" />
                    Reset All App Metrics (Fresh Restart)
                  </button>
                </div>
              </div>
            )}

            {/* SUB TAB: GOOGLE APPS SCRIPT - DEACTIVATED AND REMOVED FROM NAV */}
            {false && (
              <div className="space-y-6 text-left">
                <div className="border-b border-white/10 pb-2">
                  <h4 className="text-xs uppercase font-black tracking-widest text-[#ff4655] font-mono">
                    Google Apps Script Synchronization Suite
                  </h4>
                  <p className="text-[11px] text-gray-400 mt-1">Connect your Google Sheets spreadsheet directly to this live portal to dynamically pull stats, match schedules, and roster lists.</p>
                </div>

                <div className="space-y-4">
                  {/* Script Code Selector tabs */}
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <button
                      type="button"
                      onClick={() => setAppsScriptView('gs')}
                      className={`px-3 py-1.5 font-mono text-xs font-bold rounded-t transition-all ${
                        appsScriptView === 'gs'
                          ? 'border-b-2 border-[#ff4655] text-white bg-white/5'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      📄 code.gs (Script Backend)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAppsScriptView('html')}
                      className={`px-3 py-1.5 font-mono text-xs font-bold rounded-t transition-all ${
                        appsScriptView === 'html'
                          ? 'border-b-2 border-[#ff4655] text-white bg-white/5'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      🌐 index.html (Sidebar View)
                    </button>
                  </div>

                  {appsScriptView === 'gs' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400 uppercase font-mono font-black">Copy Google Apps Script Backend Code</span>
                        <button
                          type="button"
                          onClick={() => {
                            const codeGsText = `/**
 * VALORANT Scrim Portal - Google Sheets Integration
 * Place this code in Extensions > Apps Script in Google Sheets.
 */

const API_URL = "${window.location.origin}";

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('VALORANT Analytics Sync')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎯 Scrim Tracker Sync')
    .addItem('Open Sync Sidebar', 'showSidebar')
    .addSeparator()
    .addItem('Quick Pull All Data', 'pullAllData')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('index')
    .setTitle('VALORANT Analytics Sync')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function getAppStatus() {
  try {
    const response = UrlFetchApp.fetch(API_URL + "/api/health");
    if (response.getResponseCode() === 200) {
      return { connected: true, msg: "Connected to Scrim Portal successfully!" };
    }
    return { connected: false, msg: "HTTP Error: " + response.getResponseCode() };
  } catch (e) {
    return { connected: false, msg: "Connection failed: " + e.toString() };
  }
}

function pullAllData() {
  const response = UrlFetchApp.fetch(API_URL + "/api/data");
  const data = JSON.parse(response.getContentText());
  
  syncTable("Matches", data.matches || [], ["id", "date", "type", "opponent", "map", "attW", "attL", "defW", "defL", "vod", "notes", "source", "vlrMatchId"]);
  syncTable("PlayerStats", data.playerStats || [], ["id", "matchId", "player", "agent", "kAtt", "kDef", "dAtt", "dDef", "aAtt", "aDef", "kills", "deaths", "assists", "acs", "adr", "hs", "fk", "fd", "rating"]);
  syncTable("Schedule", data.schedule || [], ["id", "date", "calendarKey", "primary", "secondary", "notes", "attendance", "gcalEventId"]);
  syncTable("Goals", data.goals || [], ["id", "date", "goal", "notes", "status", "owner"]);
  syncTable("SoloQ", data.soloq || [], ["id", "date", "player", "wins", "losses", "rank", "rr", "source"]);
  syncTable("Rounds", data.rounds || [], ["id", "matchId", "roundNo", "side", "buy", "enemyBuy", "result", "winBy", "plant", "site", "notes", "isThrow", "thrownBy", "throwReason"]);
  syncTable("Vetos", data.vetos || [], ["id", "matchId", "date", "opponent", "seq", "actor", "action", "map", "result"]);
  syncTable("Strats", data.strats || [], ["id", "map", "side", "name", "notes", "active"]);
  syncTable("StratRuns", data.stratRuns || [], ["id", "stratId", "matchId", "date", "map", "side", "result", "reason"]);
  
  return "Database successfully synchronized from Web App to Google Sheet!";
}

function syncTable(sheetName, items, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clear();
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#ff4655")
    .setFontColor("#ffffff");
  
  if (items.length > 0) {
    const rows = items.map(item => headers.map(h => {
      const val = item[h];
      if (val !== null && typeof val === "object") {
        return JSON.stringify(val);
      }
      return val !== undefined ? val : "";
    }));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}`;
                            navigator.clipboard.writeText(codeGsText);
                            setGsCopied(true);
                            setTimeout(() => setGsCopied(false), 2000);
                          }}
                          className="px-3 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 text-white font-mono font-bold text-[10px] flex items-center gap-1.5"
                        >
                          {gsCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          {gsCopied ? 'COPIED!' : 'COPY TO CLIPBOARD'}
                        </button>
                      </div>

                      <pre className="p-4 bg-black/40 rounded-xl border border-white/10 font-mono text-[10px] text-gray-300 overflow-x-auto max-h-72 select-all">
{`/**
 * VALORANT Scrim Portal - Google Sheets Integration
 * Place this code in Extensions > Apps Script in Google Sheets.
 */

const API_URL = "${window.location.origin}";

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('VALORANT Analytics Sync')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎯 Scrim Tracker Sync')
    .addItem('Open Sync Sidebar', 'showSidebar')
    .addSeparator()
    .addItem('Quick Pull All Data', 'pullAllData')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('index')
    .setTitle('VALORANT Analytics Sync')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function getAppStatus() {
  try {
    const response = UrlFetchApp.fetch(API_URL + "/api/health");
    if (response.getResponseCode() === 200) {
      return { connected: true, msg: "Connected to Scrim Portal successfully!" };
    }
    return { connected: false, msg: "HTTP Error: " + response.getResponseCode() };
  } catch (e) {
    return { connected: false, msg: "Connection failed: " + e.toString() };
  }
}

function pullAllData() {
  const response = UrlFetchApp.fetch(API_URL + "/api/data");
  const data = JSON.parse(response.getContentText());
  
  syncTable("Matches", data.matches || [], ["id", "date", "type", "opponent", "map", "attW", "attL", "defW", "defL", "vod", "notes", "source", "vlrMatchId"]);
  syncTable("PlayerStats", data.playerStats || [], ["id", "matchId", "player", "agent", "kAtt", "kDef", "dAtt", "dDef", "aAtt", "aDef", "kills", "deaths", "assists", "acs", "adr", "hs", "fk", "fd", "rating"]);
  syncTable("Schedule", data.schedule || [], ["id", "date", "calendarKey", "primary", "secondary", "notes", "attendance", "gcalEventId"]);
  syncTable("Goals", data.goals || [], ["id", "date", "goal", "notes", "status", "owner"]);
  syncTable("SoloQ", data.soloq || [], ["id", "date", "player", "wins", "losses", "rank", "rr", "source"]);
  syncTable("Rounds", data.rounds || [], ["id", "matchId", "roundNo", "side", "buy", "enemyBuy", "result", "winBy", "plant", "site", "notes", "isThrow", "thrownBy", "throwReason"]);
  syncTable("Vetos", data.vetos || [], ["id", "matchId", "date", "opponent", "seq", "actor", "action", "map", "result"]);
  syncTable("Strats", data.strats || [], ["id", "map", "side", "name", "notes", "active"]);
  syncTable("StratRuns", data.stratRuns || [], ["id", "stratId", "matchId", "date", "map", "side", "result", "reason"]);
  
  return "Database successfully synchronized from Web App to Google Sheet!";
}

function syncTable(sheetName, items, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clear();
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#ff4655")
    .setFontColor("#ffffff");
  
  if (items.length > 0) {
    const rows = items.map(item => headers.map(h => {
      const val = item[h];
      if (val !== null && typeof val === "object") {
        return JSON.stringify(val);
      }
      return val !== undefined ? val : "";
    }));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}`}
                      </pre>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400 uppercase font-mono font-black">Copy Companion UI HTML Code</span>
                        <button
                          type="button"
                          onClick={() => {
                            const indexHtmlText = `<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
      body { font-family: 'Segoe UI', sans-serif; background-color: #0f172a; color: #f8fafc; }
    </style>
  </head>
  <body class="p-4 space-y-4">
    <div class="border-b border-slate-800 pb-3">
      <h2 class="text-rose-500 font-extrabold tracking-wider uppercase text-sm">Valorant Scrim Portal</h2>
      <p class="text-slate-400 text-xs mt-0.5">Google Sheets Synchronization Hub</p>
    </div>

    <!-- Connection Status -->
    <div id="statusCard" class="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono space-y-1">
      <p class="text-slate-500">Checking connection...</p>
    </div>

    <!-- Primary Control Buttons -->
    <div class="space-y-2 pt-2">
      <button onclick="pullData()" class="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded transition flex items-center justify-center gap-1.5 shadow">
        📥 Pull Data to Sheets
      </button>
      <p class="text-[10px] text-slate-500 text-center leading-relaxed">Pulls latest matches, schedule calendar slots, squad goals, and solo-queue records.</p>
    </div>

    <div class="border-t border-slate-800 pt-3 text-[10px] text-slate-400 space-y-1.5 leading-relaxed">
      <p class="font-bold text-slate-300">How to use:</p>
      <ol class="list-decimal list-inside space-y-1">
        <li>Make structural updates in the Sheets</li>
        <li>Pull any records automatically to merge state</li>
        <li>Rosters and map configurations persist on-the-fly</li>
      </ol>
    </div>

    <script>
      window.onload = function() {
        google.script.run
          .withSuccessHandler(function(status) {
            const card = document.getElementById('statusCard');
            if (status.connected) {
              card.innerHTML = '<span class="text-emerald-400 font-bold">● CONNECTED</span><br/><span class="text-[10px] text-slate-400">Linked to Scrim Portal successfully</span>';
            } else {
              card.innerHTML = '<span class="text-rose-500 font-bold">● OFFLINE</span><br/><span class="text-[10px] text-slate-400">' + status.msg + '</span>';
            }
          })
          .getAppStatus();
      };

      function pullData() {
        const card = document.getElementById('statusCard');
        card.innerHTML = '<span class="text-amber-400 animate-pulse">🔄 SYNCHRONIZING...</span>';
        
        google.script.run
          .withSuccessHandler(function(msg) {
            card.innerHTML = '<span class="text-emerald-400 font-bold">✓ SYNC COMPLETE</span><br/><span class="text-[10px] text-slate-400">' + msg + '</span>';
          })
          .withFailureHandler(function(err) {
            card.innerHTML = '<span class="text-rose-500 font-bold">⚠️ SYNC FAILED</span><br/><span class="text-[10px] text-slate-400">' + err + '</span>';
          })
          .pullAllData();
      }
    </script>
  </body>
</html>`;
                            navigator.clipboard.writeText(indexHtmlText);
                            setHtmlCopied(true);
                            setTimeout(() => setHtmlCopied(false), 2000);
                          }}
                          className="px-3 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 text-white font-mono font-bold text-[10px] flex items-center gap-1.5"
                        >
                          {htmlCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          {htmlCopied ? 'COPIED!' : 'COPY TO CLIPBOARD'}
                        </button>
                      </div>

                      <pre className="p-4 bg-black/40 rounded-xl border border-white/10 font-mono text-[10px] text-gray-300 overflow-x-auto max-h-72 select-all">
{`<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
      body { font-family: 'Segoe UI', sans-serif; background-color: #0f172a; color: #f8fafc; }
    </style>
  </head>
  <body class="p-4 space-y-4">
    <div class="border-b border-slate-800 pb-3">
      <h2 class="text-rose-500 font-extrabold tracking-wider uppercase text-sm">Valorant Scrim Portal</h2>
      <p class="text-slate-400 text-xs mt-0.5">Google Sheets Synchronization Hub</p>
    </div>

    <!-- Connection Status -->
    <div id="statusCard" class="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono space-y-1">
      <p class="text-slate-500">Checking connection...</p>
    </div>

    <!-- Primary Control Buttons -->
    <div class="space-y-2 pt-2">
      <button onclick="pullData()" class="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded transition flex items-center justify-center gap-1.5 shadow">
        📥 Pull Data to Sheets
      </button>
      <p class="text-[10px] text-slate-500 text-center leading-relaxed">Pulls latest matches, schedule calendar slots, squad goals, and solo-queue records.</p>
    </div>

    <div class="border-t border-slate-800 pt-3 text-[10px] text-slate-400 space-y-1.5 leading-relaxed">
      <p class="font-bold text-slate-300">How to use:</p>
      <ol class="list-decimal list-inside space-y-1">
        <li>Make structural updates in the Sheets</li>
        <li>Pull any records automatically to merge state</li>
        <li>Rosters and map configurations persist on-the-fly</li>
      </ol>
    </div>

    <script>
      window.onload = function() {
        google.script.run
          .withSuccessHandler(function(status) {
            const card = document.getElementById('statusCard');
            if (status.connected) {
              card.innerHTML = '<span class="text-emerald-400 font-bold">● CONNECTED</span><br/><span class="text-[10px] text-slate-400">Linked to Scrim Portal successfully</span>';
            } else {
              card.innerHTML = '<span class="text-rose-500 font-bold">● OFFLINE</span><br/><span class="text-[10px] text-slate-400">' + status.msg + '</span>';
            }
          })
          .getAppStatus();
      };

      function pullData() {
        const card = document.getElementById('statusCard');
        card.innerHTML = '<span class="text-amber-400 animate-pulse">🔄 SYNCHRONIZING...</span>';
        
        google.script.run
          .withSuccessHandler(function(msg) {
            card.innerHTML = '<span class="text-emerald-400 font-bold">✓ SYNC COMPLETE</span><br/><span class="text-[10px] text-slate-400">' + msg + '</span>';
          })
          .withFailureHandler(function(err) {
            card.innerHTML = '<span class="text-rose-500 font-bold">⚠️ SYNC FAILED</span><br/><span class="text-[10px] text-slate-400">' + err + '</span>';
          })
          .pullAllData();
      }
    </script>
  </body>
</html>`}
                      </pre>
                    </div>
                  )}

                  <div className={`p-4 rounded-lg border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/5 border-white/10'} text-xs font-mono space-y-2`}>
                    <p className="font-bold text-[#ff4655]">💡 Apps Script Porting Instructions:</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-400 text-[11px] leading-relaxed">
                      <li>In Google Sheets, go to <strong className="text-white">Extensions &gt; Apps Script</strong>.</li>
                      <li>In the editor, overwrite the code in <strong className="text-white">Code.gs</strong> with the code under the script backend tab above.</li>
                      <li>Click the <strong className="text-white">+</strong> icon next to Files, select <strong className="text-white">HTML</strong>, name the file <strong className="text-white">index</strong> (without extensions), and paste the Sidebar View code.</li>
                      <li>Click Save (floppy disk icon), then refresh your Google Sheets tab. You will see a new menu: <strong className="text-white">🎯 Scrim Tracker Sync</strong>!</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: ACCESS CONTROL */}
            {activeSubTab === 'access-control' && (
              <div className="space-y-6">
                <div className="border-b border-white/5 pb-2">
                  <h4 className="text-xs uppercase font-black tracking-widest text-[#ff4655] font-mono">
                    Access Keys & Panel Control
                  </h4>
                  <p className="text-[10px] text-gray-500 font-mono mt-1">
                    Control who has access to your Scrim Hub. You can create custom login keys or immediately revoke access to instantly boot unauthorized users.
                  </p>
                </div>

                {/* Generator Section */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-4">
                  <h5 className="text-[11px] font-mono font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                    <Plus className="w-4 h-4 text-[#ff4655]" /> Generate New Access Key
                  </h5>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-gray-400 font-mono">Key Owner / Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Player TenZ or Analyst"
                        value={newKeyLabel}
                        onChange={e => setNewKeyLabel(e.target.value)}
                        className="w-full p-2.5 bg-black/30 text-white rounded border border-white/10 text-xs font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-gray-400 font-mono">Panel Role</label>
                      <select
                        value={newKeyRole}
                        onChange={e => setNewKeyRole(e.target.value as any)}
                        className="w-full p-2.5 bg-black/30 text-white rounded border border-white/10 text-xs font-mono font-bold"
                      >
                        <option value="player">Player (Read-Only / Tracker View)</option>
                        <option value="coach">Coach (Full Edit / Control Access)</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleCreateKey}
                      className="py-2.5 px-4 bg-[#ff4655] hover:bg-[#ff4655]/90 text-white font-mono font-bold text-xs rounded transition-all uppercase tracking-wider cursor-pointer"
                    >
                      Generate Key
                    </button>
                  </div>
                </div>

                {/* Active Keys List Section */}
                <div className="space-y-3">
                  <h5 className="text-[11px] font-mono font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                    <Key className="w-4 h-4 text-amber-400" /> Active Access Keys
                  </h5>

                  {keysLoading ? (
                    <p className="text-xs text-gray-500 font-mono italic animate-pulse">Loading active key credentials...</p>
                  ) : keysError ? (
                    <p className="text-xs text-rose-400 font-mono">Error: {keysError}</p>
                  ) : keysList.length === 0 ? (
                    <div className="text-center p-6 rounded-xl border border-dashed border-white/5 bg-white/[0.01]">
                      <p className="text-xs text-gray-500 font-mono">No custom keys created yet.</p>
                      <p className="text-[10px] text-gray-600 font-mono mt-1">Use the generator above to invite your players or assistant coaches.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {keysList.map((keyObj) => {
                        const isCoach = keyObj.role === 'coach';
                        const isCopied = copiedKeyId === keyObj.id;
                        return (
                          <div
                            key={keyObj.id}
                            className="p-3.5 rounded-xl bg-black/25 border border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 font-mono text-xs"
                          >
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white uppercase text-sm block truncate">{keyObj.label}</span>
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase ${
                                  isCoach 
                                    ? 'bg-[#ff4655]/10 text-[#ff4655] border border-[#ff4655]/20' 
                                    : 'bg-[#3aa0ff]/10 text-[#3aa0ff] border border-[#3aa0ff]/20'
                                }`}>
                                  {keyObj.role}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-gray-500 text-[10px]">
                                <span className="block truncate">Key: <span className="text-gray-300 font-mono text-[11px]">{keyObj.key}</span></span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleCopyKeyToClipboard(keyObj.id, keyObj.key)}
                                className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all uppercase flex items-center gap-1 ${
                                  isCopied 
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                    : 'bg-white/5 hover:bg-white/10 text-gray-300 border border-white/5'
                                }`}
                              >
                                {isCopied ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" /> Copied!
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" /> Copy Key
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleRevokeKey(keyObj.id, keyObj.label)}
                                className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/30 rounded text-[10px] font-bold transition-all uppercase flex items-center gap-1 cursor-pointer"
                                title="Revoke and Kick Out"
                              >
                                <UserMinus className="w-3.5 h-3.5" /> Revoke
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Save Button */}
            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              {saveSuccess ? (
                <span className="text-xs text-emerald-400 font-mono font-bold flex items-center gap-1.5 animate-pulse">
                  ✓ Configs successfully saved to database!
                </span>
              ) : (
                <span className="text-xs text-gray-500 font-mono">Click Save to persist settings across sessions.</span>
              )}

              <button
                type="submit"
                disabled={saving}
                className={`px-5 py-2.5 ${theme.primaryBg} hover:opacity-90 font-mono font-bold text-xs text-white rounded-lg flex items-center gap-2 cursor-pointer disabled:opacity-50`}
              >
                <Save className="w-4 h-4" />
                {saving ? 'SAVING...' : 'SAVE CONFIGURATIONS'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
