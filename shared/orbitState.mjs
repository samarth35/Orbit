export const VIEW_LABELS = ['Today', 'Tasks', 'Notes', 'Focus', 'Calendar', 'Groups', 'Score', 'Profile'];

export const DEFAULT_TASKS = [
  {
    id: 'task-1',
    title: 'Map the top three outcomes for today',
    meta: 'Planning',
    time: '09:10',
    priority: 'High',
    accent: 'coral',
    done: false
  },
  {
    id: 'task-2',
    title: 'Deep work sprint on Orbit command surface',
    meta: 'Build',
    time: '10:00',
    priority: 'Focus',
    accent: 'violet',
    done: false
  },
  {
    id: 'task-3',
    title: 'Review feature backlog for Pomodoro and habits',
    meta: 'Research',
    time: '13:30',
    priority: 'Medium',
    accent: 'mint',
    done: false
  },
  {
    id: 'task-4',
    title: 'Clean notes into future modules',
    meta: 'Notes',
    time: '16:00',
    priority: 'Low',
    accent: 'slate',
    done: true
  }
];

export const DEFAULT_NOTES = [
  { id: 'note-1', title: 'Pomodoro expansion', body: 'Add session history, streaks, and energy tags.', tag: 'Feature' },
  { id: 'note-2', title: 'Smart capture grammar', body: 'Parse dates, #labels, and !priority from one line.', tag: 'AI-ready' },
  { id: 'note-3', title: 'Calendar bridge', body: 'Reserve focus blocks from task estimates.', tag: 'Later' }
];

export const DEFAULT_ROUTINES = [
  { id: 'routine-1', title: 'Plan top three outcomes', cadence: 'Morning', anchor: 'Before deep work', done: false },
  { id: 'routine-2', title: 'Add a recovery buffer', cadence: 'Midday', anchor: 'Between meetings', done: false },
  { id: 'routine-3', title: 'Shutdown note for tomorrow', cadence: 'Evening', anchor: 'End of day', done: false }
];

export const SUGGESTIONS = [
  { id: 'sug-1', title: 'Start with the high-energy build task', meta: 'Best fit for current focus window', signal: '92%' },
  { id: 'sug-2', title: 'Batch low-priority notes after 4 PM', meta: 'Protect deep work time', signal: '68%' },
  { id: 'sug-3', title: 'Turn backlog review into a 25m sprint', meta: 'Pomodoro-ready', signal: '25m' }
];

export const DEFAULT_FOCUS = {
  running: false,
  secondsLeft: 25 * 60,
  completed: 2,
  alarmEnabled: true,
  alarmName: 'Soft chime',
  activeSessionId: ''
};

export const DEFAULT_EVENTS = [
  { id: 'event-1', title: 'Design QA pass', date: '2026-07-01', start: '11:30', end: '12:15', type: 'Review', notes: 'Check responsive states and polish.' },
  { id: 'event-2', title: 'Feature planning', date: '2026-07-01', start: '14:00', end: '14:45', type: 'Planning', notes: 'Calendar, tasks, notes, profile, OAuth.' },
  { id: 'event-3', title: 'Shutdown ritual', date: '2026-07-01', start: '17:15', end: '17:30', type: 'Personal', notes: 'Review and reset.' }
];

export const DEFAULT_PROFILE = {
  name: 'Samarth Mishra',
  handle: 'samarth',
  role: 'Builder',
  email: '',
  timezone: 'Asia/Calcutta',
  avatar: '',
  dailyFocusGoal: 4
};

export const DEFAULT_INTEGRATIONS = [
  {
    id: 'google',
    provider: 'google',
    label: 'Google Calendar',
    status: 'not_configured',
    clientId: '',
    redirectUri: 'http://127.0.0.1:4174/api/auth/google/callback',
    scopes: 'openid email profile https://www.googleapis.com/auth/calendar.readonly',
    lastSync: ''
  }
];

export function createDefaultState() {
  return normalizeState({
    theme: 'dark',
    activeView: 'Today',
    tasks: DEFAULT_TASKS,
    notes: DEFAULT_NOTES,
    routines: DEFAULT_ROUTINES,
    events: DEFAULT_EVENTS,
    focus: DEFAULT_FOCUS,
    profile: DEFAULT_PROFILE,
    integrations: DEFAULT_INTEGRATIONS
  });
}

export function normalizeState(value = {}) {
  const fallback = {
    theme: 'dark',
    activeView: 'Today',
    tasks: DEFAULT_TASKS,
    notes: DEFAULT_NOTES,
    routines: DEFAULT_ROUTINES,
    events: DEFAULT_EVENTS,
    focus: DEFAULT_FOCUS,
    profile: DEFAULT_PROFILE,
    integrations: DEFAULT_INTEGRATIONS
  };

  const state = value && typeof value === 'object' ? value : {};
  return {
    theme: state.theme === 'light' ? 'light' : fallback.theme,
    activeView: VIEW_LABELS.includes(state.activeView) ? state.activeView : (state.activeView === 'Insights' ? 'Score' : fallback.activeView),
    tasks: Array.isArray(state.tasks) ? state.tasks.map(normalizeTask).filter(Boolean) : [...fallback.tasks],
    notes: Array.isArray(state.notes) ? state.notes.map(normalizeNote).filter(Boolean) : [...fallback.notes],
    routines: Array.isArray(state.routines) && state.routines.length ? state.routines.map(normalizeRoutine).filter(Boolean) : [...fallback.routines],
    events: Array.isArray(state.events) ? state.events.map(normalizeEvent).filter(Boolean) : [...fallback.events],
    focus: normalizeFocus(state.focus),
    profile: normalizeProfile(state.profile),
    integrations: Array.isArray(state.integrations) ? state.integrations.map(normalizeIntegration).filter(Boolean) : [...fallback.integrations]
  };
}

export function normalizeTask(task) {
  if (!task || typeof task !== 'object') return null;
  const title = String(task.title ?? '').trim();
  if (!title) return null;

  return {
    id: String(task.id ?? `task-${Date.now()}`),
    title,
    meta: String(task.meta ?? 'Quick capture').trim() || 'Quick capture',
    time: String(task.time ?? '').trim() || shortTime(),
    date: String(task.date ?? '').trim(),
    priority: String(task.priority ?? 'New').trim() || 'New',
    accent: normalizeAccent(task.accent),
    done: Boolean(task.done),
    createdAt: String(task.createdAt ?? '').trim(),
    completedAt: String(task.completedAt ?? '').trim()
  };
}

export function normalizeNote(note) {
  if (!note || typeof note !== 'object') return null;
  const title = String(note.title ?? '').trim();
  if (!title) return null;

  return {
    id: String(note.id ?? `note-${Date.now()}`),
    title,
    body: String(note.body ?? '').trim(),
    tag: String(note.tag ?? 'Note').trim() || 'Note'
  };
}

export function normalizeRoutine(routine) {
  if (!routine || typeof routine !== 'object') return null;
  const title = String(routine.title ?? '').trim();
  if (!title) return null;

  return {
    id: String(routine.id ?? `routine-${Date.now()}`),
    title,
    cadence: String(routine.cadence ?? 'Daily').trim() || 'Daily',
    anchor: String(routine.anchor ?? 'Anytime').trim() || 'Anytime',
    done: Boolean(routine.done)
  };
}

export function normalizeFocus(focus) {
  const source = focus && typeof focus === 'object' ? focus : {};
  const secondsLeft = Number(source.secondsLeft);
  const completed = Number(source.completed);

  return {
    running: Boolean(source.running),
    secondsLeft: Number.isFinite(secondsLeft) ? Math.min(Math.max(Math.round(secondsLeft), 0), 99 * 60) : DEFAULT_FOCUS.secondsLeft,
    completed: Number.isFinite(completed) ? Math.max(Math.round(completed), 0) : DEFAULT_FOCUS.completed,
    alarmEnabled: source.alarmEnabled !== false,
    alarmName: String(source.alarmName ?? DEFAULT_FOCUS.alarmName).trim() || DEFAULT_FOCUS.alarmName,
    activeSessionId: String(source.activeSessionId ?? '').trim()
  };
}

export function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const title = String(event.title ?? '').trim();
  const date = String(event.date ?? '').trim();
  if (!title || !date) return null;

  return {
    id: String(event.id ?? `event-${Date.now()}`),
    title,
    date,
    start: String(event.start ?? '09:00').trim() || '09:00',
    end: String(event.end ?? '09:30').trim() || '09:30',
    type: String(event.type ?? 'Focus').trim() || 'Focus',
    linkedTaskId: String(event.linkedTaskId ?? '').trim(),
    notes: String(event.notes ?? '').trim()
  };
}

export function normalizeProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const dailyFocusGoal = Number(source.dailyFocusGoal);
  return {
    name: String(source.name ?? DEFAULT_PROFILE.name).trim() || DEFAULT_PROFILE.name,
    handle: String(source.handle ?? DEFAULT_PROFILE.handle).trim() || DEFAULT_PROFILE.handle,
    role: String(source.role ?? DEFAULT_PROFILE.role).trim() || DEFAULT_PROFILE.role,
    email: String(source.email ?? '').trim(),
    timezone: String(source.timezone ?? DEFAULT_PROFILE.timezone).trim() || DEFAULT_PROFILE.timezone,
    avatar: String(source.avatar ?? '').trim(),
    dailyFocusGoal: Number.isFinite(dailyFocusGoal) ? Math.min(Math.max(Math.round(dailyFocusGoal), 1), 16) : DEFAULT_PROFILE.dailyFocusGoal
  };
}

export function normalizeIntegration(integration) {
  if (!integration || typeof integration !== 'object') return null;
  const provider = String(integration.provider ?? integration.id ?? '').trim();
  if (!provider) return null;
  const status = ['not_configured', 'configured', 'connected'].includes(integration.status) ? integration.status : 'not_configured';
  return {
    id: String(integration.id ?? provider).trim(),
    provider,
    label: String(integration.label ?? provider).trim() || provider,
    status,
    clientId: String(integration.clientId ?? '').trim(),
    redirectUri: String(integration.redirectUri ?? '').trim(),
    scopes: String(integration.scopes ?? '').trim(),
    lastSync: String(integration.lastSync ?? '').trim()
  };
}

export function createCapturedTask(title, now = new Date()) {
  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) return null;

  const hasPriority = cleanTitle.includes('!');
  const hasTag = cleanTitle.includes('#');

  return normalizeTask({
    id: `task-${now.getTime()}`,
    title: cleanTitle.replace(/[#!]/g, '').trim(),
    meta: hasTag ? 'Tagged capture' : 'Quick capture',
    time: shortTime(now),
    date: localDateString(now),
    priority: hasPriority ? 'High' : 'New',
    accent: hasPriority ? 'coral' : hasTag ? 'mint' : 'violet',
    done: false,
    createdAt: localDateString(now)
  });
}

function normalizeAccent(accent) {
  const allowed = ['coral', 'mint', 'violet', 'slate', 'silver', 'amber', 'cyan'];
  return allowed.includes(accent) ? accent : 'violet';
}

function shortTime(date = new Date()) {
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function localDateString(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}
