import React, { useState, useMemo } from 'react';
import { TrackerData, Schedule, Goal } from '../types';
import { Calendar, ChevronLeft, ChevronRight, CheckSquare, Plus, Edit2, Trash2, CalendarDays, ClipboardList, Clock, AlertCircle } from 'lucide-react';

interface ComponentProps {
  data: TrackerData;
  theme: any;
  onUpsert: (sheet: string, row: any) => Promise<any>;
  onRemove: (sheet: string, id: string) => Promise<any>;
}

export default function CalendarGoals({ data, theme, onUpsert, onRemove }: ComponentProps) {
  const [activeSubTab, setActiveSubTab] = useState<'calendar' | 'goals'>('calendar');
  const isLight = data.settings.theme === 'daylight';

  // --- CALENDAR STATE ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDateStr, setSelectedDateStr] = useState<string>(new Date().toISOString().slice(0, 10));
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Partial<Schedule> | null>(null);

  // --- GOALS STATE ---
  const [goalFilter, setGoalFilter] = useState<string>('All');
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Partial<Goal> | null>(null);

  const players = data.settings.players || [];
  const calendars = data.settings.calendars || [];
  const scheduleList = data.schedule || [];
  const goalsList = data.goals || [];

  // --- CALENDAR CALCULATIONS ---
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);
  const firstDayIndex = useMemo(() => {
    const day = new Date(year, month, 1).getDay();
    // Adjust for week start: 1 for Monday, 0 for Sunday
    const startOffset = data.settings.weekStart || 1;
    return (day - startOffset + 7) % 7;
  }, [year, month, data.settings.weekStart]);

  const prevMonthDays = useMemo(() => new Date(year, month, 0).getDate(), [year, month]);

  const monthName = currentDate.toLocaleString('default', { month: 'long' });

  const calendarDays = useMemo(() => {
    const cells = [];
    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const m = month === 0 ? 11 : month - 1;
      const y = month === 0 ? year - 1 : year;
      cells.push({ day: d, currentMonth: false, dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ day: i, currentMonth: true, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    // Next month filler days
    const totalCellsSoFar = cells.length;
    const remaining = 42 - totalCellsSoFar;
    for (let i = 1; i <= remaining; i++) {
      const m = month === 11 ? 0 : month + 1;
      const y = month === 11 ? year + 1 : year;
      cells.push({ day: i, currentMonth: false, dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    return cells;
  }, [daysInMonth, firstDayIndex, prevMonthDays, year, month]);

  const scheduleMap = useMemo(() => {
    const map: Record<string, Schedule[]> = {};
    scheduleList.forEach((s) => {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    });
    return map;
  }, [scheduleList]);

  const shiftMonth = (dir: number) => {
    setCurrentDate(new Date(year, month + dir, 1));
  };

  const selectedDaySchedules = useMemo(() => {
    return scheduleMap[selectedDateStr] || [];
  }, [scheduleMap, selectedDateStr]);

  // --- CALENDAR MUTATIONS ---
  const handleOpenAddSchedule = (dateStr: string) => {
    setEditingSchedule({
      id: '',
      date: dateStr,
      calendarKey: calendars[0]?.key || 'practice',
      primary: '',
      secondary: '',
      notes: '',
      attendance: players.reduce((acc, p) => ({ ...acc, [p]: 'Prac' }), {})
    });
    setScheduleModalOpen(true);
  };

  const handleOpenEditSchedule = (sched: Schedule) => {
    setEditingSchedule({ ...sched });
    setScheduleModalOpen(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule || !editingSchedule.primary) return;
    if (data.settings.confirmOnSave && !window.confirm('Save this schedule item?')) return;
    
    await onUpsert('Schedule', editingSchedule);
    setScheduleModalOpen(false);
    setEditingSchedule(null);
  };

  const handleDeleteSchedule = async (id: string) => {
    if (data.settings.confirmOnDelete && !window.confirm('Delete this schedule? This action is irreversible.')) return;
    await onRemove('Schedule', id);
  };

  // --- GOAL MUTATIONS ---
  const filteredGoals = useMemo(() => {
    if (goalFilter === 'All') return goalsList;
    return goalsList.filter(g => g.status === goalFilter);
  }, [goalsList, goalFilter]);

  const handleOpenAddGoal = () => {
    setEditingGoal({
      id: '',
      date: new Date().toISOString().slice(0, 10),
      goal: '',
      notes: '',
      status: 'Open',
      owner: ''
    });
    setGoalModalOpen(true);
  };

  const handleOpenEditGoal = (g: Goal) => {
    setEditingGoal({ ...g });
    setGoalModalOpen(true);
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGoal || !editingGoal.goal) return;
    await onUpsert('Goals', editingGoal);
    setGoalModalOpen(false);
    setEditingGoal(null);
  };

  const handleDeleteGoal = async (id: string) => {
    if (data.settings.confirmOnDelete && !window.confirm('Delete this goal?')) return;
    await onRemove('Goals', id);
  };

  const handleQuickStatusGoal = async (g: Goal, nextStatus: string) => {
    await onUpsert('Goals', { ...g, status: nextStatus });
  };

  return (
    <div className="space-y-6">
      {/* Sub Tabs Toggle */}
      <div className="flex gap-2 border-b border-white/10 pb-4">
        <button
          onClick={() => setActiveSubTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase rounded-lg transition-all ${
            activeSubTab === 'calendar'
              ? 'bg-white/5 text-white shadow-md border-b-2 border-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          Schedule Calendar
        </button>
        <button
          onClick={() => setActiveSubTab('goals')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase rounded-lg transition-all ${
            activeSubTab === 'goals'
              ? 'bg-white/5 text-white shadow-md border-b-2 border-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          Practice Goals
        </button>
      </div>

      {activeSubTab === 'calendar' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Grid Frame */}
          <div className={`lg:col-span-2 p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} flex flex-col`}>
            {/* Calendar Controller Header */}
            <div className="flex justify-between items-center mb-5">
              <div className="flex items-center gap-2">
                <Calendar className={`w-5 h-5 ${theme.text}`} />
                <h3 className="font-black text-sm tracking-wide uppercase">{monthName} {year}</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => shiftMonth(-1)}
                  className={`p-1.5 rounded bg-white/5 hover:bg-white/10 border ${isLight ? 'border-slate-200' : 'border-white/10'} transition-colors`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => shiftMonth(1)}
                  className={`p-1.5 rounded bg-white/5 hover:bg-white/10 border ${isLight ? 'border-slate-200' : 'border-white/10'} transition-colors`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Days of Week Row */}
            <div className="grid grid-cols-7 gap-1 text-center font-bold font-mono text-[10px] text-gray-500 uppercase mb-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="py-1">{d}</div>)}
            </div>

            {/* Calendar Cells Grid */}
            <div className="grid grid-cols-7 gap-1 flex-grow">
              {calendarDays.map((cell, idx) => {
                const dayScheds = scheduleMap[cell.dateStr] || [];
                const isSelected = selectedDateStr === cell.dateStr;
                const isToday = new Date().toISOString().slice(0, 10) === cell.dateStr;

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDateStr(cell.dateStr)}
                    className={`min-h-[70px] p-1.5 rounded-lg border flex flex-col text-left transition-all ${
                      cell.currentMonth
                        ? isLight ? 'bg-slate-50 text-slate-800' : 'bg-white/5 text-slate-100'
                        : 'opacity-30'
                    } ${
                      isSelected
                        ? isLight ? 'border-slate-800 bg-slate-100 ring-2 ring-slate-200' : 'border-white bg-white/10 ring-2 ring-white/10'
                        : isLight ? 'border-slate-100' : 'border-white/5'
                    } ${isToday ? `ring-2 ring-offset-2 ${isLight ? 'ring-slate-400' : 'ring-rose-500'}` : ''}`}
                  >
                    <span className="text-xs font-black font-mono">{cell.day}</span>
                    
                    {/* Events indicators */}
                    <div className="mt-auto space-y-1 w-full overflow-hidden">
                      {dayScheds.slice(0, 2).map((s) => {
                        const cal = calendars.find(c => c.key === s.calendarKey) || { color: '#ff4655' };
                        return (
                          <div
                            key={s.id}
                            style={{ backgroundColor: cal.color + '22', borderLeft: `3px solid ${cal.color}` }}
                            className="text-[9px] px-1 py-0.5 rounded-sm truncate text-white uppercase font-black tracking-tighter"
                          >
                            {s.primary}
                          </div>
                        );
                      })}
                      {dayScheds.length > 2 && (
                        <div className="text-[8px] text-gray-500 font-bold text-center">+{dayScheds.length - 2} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Day details side card */}
          <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} h-fit`}>
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-black text-xs uppercase text-gray-500 font-mono">Day Details: {selectedDateStr}</h4>
              <button
                onClick={() => handleOpenAddSchedule(selectedDateStr)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded ${theme.primaryBg} text-white cursor-pointer hover:opacity-90`}
              >
                <Plus className="w-3.5 h-3.5" /> ADD EVENT
              </button>
            </div>

            {selectedDaySchedules.length > 0 ? (
              <div className="space-y-4">
                {selectedDaySchedules.map((sched) => {
                  const cal = calendars.find(c => c.key === sched.calendarKey) || { color: '#ff4655', name: 'Schedule' };
                  return (
                    <div key={sched.id} className={`p-4 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-100' : 'bg-white/5 border-white/5'} space-y-3 relative group`}>
                      <div className="absolute right-3 top-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenEditSchedule(sched)}
                          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(sched.id)}
                          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cal.color }}></div>
                        <span className="text-[10px] uppercase font-black tracking-widest text-gray-400 font-mono">{cal.name}</span>
                      </div>

                      <div>
                        <h5 className="text-base font-black tracking-tight">{sched.primary}</h5>
                        {sched.secondary && (
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{sched.secondary}</p>
                        )}
                      </div>

                      {sched.notes && (
                        <p className="text-xs text-gray-400 bg-black/10 p-2.5 rounded font-mono leading-relaxed">{sched.notes}</p>
                      )}

                      {/* Attendance List */}
                      <div>
                        <p className="text-[10px] uppercase font-black tracking-widest text-gray-500 mb-1.5 font-mono">Attendance Roster</p>
                        <div className="flex flex-wrap gap-1">
                          {players.map((p) => {
                            const state = sched.attendance?.[p] || 'OFF';
                            const badgeColor = {
                              Prac: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                              Official: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
                              OFF: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
                              Late: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                              Absent: 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                            }[state as string] || 'bg-slate-500/10 text-slate-400';

                            return (
                              <div key={p} className={`px-2 py-0.5 rounded text-[9px] font-bold border ${badgeColor}`}>
                                {p}: {state}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center text-gray-500 font-mono text-xs flex flex-col items-center justify-center gap-2">
                <Clock className="w-8 h-8 text-gray-600" />
                No events scheduled for this day.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* GOALS VIEW */
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            {/* Filter buttons */}
            <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/5">
              {['All', 'Open', 'In progress', 'Done'].map((st) => (
                <button
                  key={st}
                  onClick={() => setGoalFilter(st)}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                    goalFilter === st
                      ? isLight ? 'bg-slate-900 text-white' : 'bg-white/10 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <button
              onClick={handleOpenAddGoal}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded ${theme.primaryBg} text-white cursor-pointer`}
            >
              <Plus className="w-4 h-4" /> NEW GOAL
            </button>
          </div>

          {/* Goals list */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGoals.map((g) => {
              const borderCol = {
                'Open': 'border-blue-500/20 shadow-blue-500/5',
                'In progress': 'border-amber-500/20 shadow-amber-500/5',
                'Done': 'border-emerald-500/20 shadow-emerald-500/5'
              }[g.status as string] || 'border-white/10';

              const badgeCol = {
                'Open': 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
                'In progress': 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
                'Done': 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }[g.status as string] || 'bg-slate-500/10';

              return (
                <div key={g.id} className={`p-5 rounded-xl border bg-white/5 shadow-lg ${borderCol} flex flex-col justify-between group relative`}>
                  <div className="absolute right-4 top-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleOpenEditGoal(g)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteGoal(g.id)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase font-mono ${badgeCol}`}>
                        {g.status}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">{g.date}</span>
                    </div>

                    <div>
                      <h5 className="text-base font-black tracking-tight leading-snug">{g.goal}</h5>
                      {g.notes && <p className="text-xs text-gray-400 mt-1 font-mono leading-relaxed">{g.notes}</p>}
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-white/5 flex justify-between items-center">
                    <span className="text-[10px] font-mono text-gray-500 uppercase">
                      Owner: {g.owner || 'TEAM'}
                    </span>

                    {/* Quick status cycle */}
                    <div className="flex items-center gap-1">
                      {g.status === 'Open' && (
                        <button
                          onClick={() => handleQuickStatusGoal(g, 'In progress')}
                          className="px-2 py-1 text-[9px] font-bold bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded font-mono uppercase"
                        >
                          Start
                        </button>
                      )}
                      {g.status === 'In progress' && (
                        <button
                          onClick={() => handleQuickStatusGoal(g, 'Done')}
                          className="px-2 py-1 text-[9px] font-bold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded font-mono uppercase"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredGoals.length === 0 && (
              <div className="col-span-full py-16 text-center text-gray-500 font-mono text-xs flex flex-col items-center justify-center gap-2 bg-white/5 rounded-xl border border-white/5">
                <AlertCircle className="w-8 h-8 text-gray-600" />
                No goals in this category.
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- SCHEDULE MODAL --- */}
      {scheduleModalOpen && editingSchedule && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto animate-fadeIn">
          <form onSubmit={handleSaveSchedule} className={`w-full max-w-xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h4 className="text-lg font-black tracking-tight uppercase">
                {editingSchedule.id ? 'EDIT EVENT' : 'ADD NEW EVENT'}
              </h4>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Date</label>
                <input
                  type="date"
                  required
                  value={editingSchedule.date}
                  onChange={e => setEditingSchedule({ ...editingSchedule, date: e.target.value })}
                  className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Type</label>
                <select
                  value={editingSchedule.calendarKey}
                  onChange={e => setEditingSchedule({ ...editingSchedule, calendarKey: e.target.value })}
                  className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  {calendars.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Primary Topic / Map</label>
              <input
                type="text"
                required
                placeholder="e.g. Ascent, VOD Review"
                value={editingSchedule.primary}
                onChange={e => setEditingSchedule({ ...editingSchedule, primary: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Secondary Goal / Notes (Sub-title)</label>
              <input
                type="text"
                placeholder="e.g. A split details, pistol rounds only"
                value={editingSchedule.secondary}
                onChange={e => setEditingSchedule({ ...editingSchedule, secondary: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Additional Details</label>
              <textarea
                rows={3}
                placeholder="Scrim links, specific notes, discord tags"
                value={editingSchedule.notes}
                onChange={e => setEditingSchedule({ ...editingSchedule, notes: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono"
              />
            </div>

            {/* Attendance fields */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono block border-b border-white/5 pb-1">Attendance States</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {players.map((p) => {
                  const state = editingSchedule.attendance?.[p] || 'Prac';
                  return (
                    <div key={p} className="flex items-center justify-between gap-2 border border-white/5 bg-black/10 p-2 rounded">
                      <span className="text-xs font-bold truncate">{p}</span>
                      <select
                        value={state}
                        onChange={(e) => {
                          const updatedAtt = { ...editingSchedule.attendance, [p]: e.target.value };
                          setEditingSchedule({ ...editingSchedule, attendance: updatedAtt });
                        }}
                        className="bg-black text-[10px] p-1 rounded text-white font-mono"
                      >
                        {data.settings.attendanceStates.map(st => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white`}
              >
                SAVE SCHEDULE
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- GOAL MODAL --- */}
      {goalModalOpen && editingGoal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <form onSubmit={handleSaveGoal} className={`w-full max-w-md p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h4 className="text-lg font-black tracking-tight uppercase">
                {editingGoal.id ? 'EDIT GOAL' : 'ADD NEW GOAL'}
              </h4>
              <button
                type="button"
                onClick={() => setGoalModalOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Date Assigned</label>
              <input
                type="date"
                required
                value={editingGoal.date}
                onChange={e => setEditingGoal({ ...editingGoal, date: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Goal / Practice Topic</label>
              <input
                type="text"
                required
                placeholder="e.g. Bind: Hold garden control cleaner"
                value={editingGoal.goal}
                onChange={e => setEditingGoal({ ...editingGoal, goal: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Details / Tips</label>
              <textarea
                rows={3}
                placeholder="Focus items, setups, key players responsibilities"
                value={editingGoal.notes}
                onChange={e => setEditingGoal({ ...editingGoal, notes: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Status</label>
                <select
                  value={editingGoal.status}
                  onChange={e => setEditingGoal({ ...editingGoal, status: e.target.value })}
                  className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  {data.settings.goalStates.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Owner (Dropdown)</label>
                <select
                  value={editingGoal.owner}
                  onChange={e => setEditingGoal({ ...editingGoal, owner: e.target.value })}
                  className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  <option value="">TEAM Goal</option>
                  {players.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setGoalModalOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white`}
              >
                SAVE GOAL
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
