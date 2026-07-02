import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BatteryCharging,
  Bell,
  BellOff,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Circle,
  CircleUserRound,
  Clock3,
  Coffee,
  Command,
  Copy,
  Crown,
  Edit3,
  Flame,
  Gauge,
  Home,
  KeyRound,
  ListTodo,
  LogIn,
  LogOut,
  Medal,
  Moon,
  MoonStar,
  NotebookPen,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Timer,
  Trophy,
  Trash2,
  UserRound,
  UsersRound,
  Zap
} from 'lucide-react';
import AnimatedList from './components/AnimatedList.jsx';
import BorderGlow from './components/BorderGlow.jsx';
import CardNav from './components/CardNav.jsx';
import Dock from './components/Dock.jsx';
import ShapeGrid from './components/ShapeGrid.jsx';
import Strands from './components/Strands.jsx';
import {
  createEvent,
  createNote,
  createRoutine,
  createTask as createTaskRemote,
  completeFocusSession,
  createGroup,
  deleteGroup,
  deleteEvent,
  deleteNote,
  deleteRoutine,
  deleteTask,
  getCurrentUser,
  getGlobalLeaderboard,
  getGroupMembers,
  getGroupLeaderboard,
  getGroups,
  getScoreSummary,
  getSuggestions,
  joinGroup,
  logoutSession,
  patchEvent,
  patchFocus as patchFocusRemote,
  patchGroup,
  patchNote,
  patchPreferences,
  patchProfile,
  patchRoutine,
  patchTask,
  regenerateGroupInvite,
  removeGroupMember,
  resetFocusTimer,
  startGoogleLogin,
  startGuestSession,
  startFocusSession,
  updateGroupMember
} from './api.js';
import { createCapturedTask, createDefaultState, normalizeState, VIEW_LABELS } from '../shared/orbitState.mjs';
import { useMediaQuery, usePrefersReducedMotion } from './hooks.js';

const NAV_ITEMS = [
  {
    label: 'Plan',
    bgColor: 'linear-gradient(135deg, #141019, #262032)',
    textColor: '#f8f6ff',
    links: [
      { label: 'Today', view: 'Today', ariaLabel: 'Open Today' },
      { label: 'Calendar', view: 'Calendar', ariaLabel: 'Open Calendar' }
    ]
  },
  {
    label: 'Create',
    bgColor: 'linear-gradient(135deg, #11131b, #20202b)',
    textColor: '#f8f6ff',
    links: [
      { label: 'Tasks', view: 'Tasks', ariaLabel: 'Open Tasks' },
      { label: 'Notes', view: 'Notes', ariaLabel: 'Open Notes' }
    ]
  },
  {
    label: 'Balance',
    bgColor: 'linear-gradient(135deg, #101018, #211b2b)',
    textColor: '#f8f6ff',
    links: [
      { label: 'Focus', view: 'Focus', ariaLabel: 'Open Focus' },
      { label: 'Groups', view: 'Groups', ariaLabel: 'Open Groups' },
      { label: 'Score', view: 'Score', ariaLabel: 'Open Score' }
    ]
  }
];

const STRAND_COLORS = {
  dark: ['#f8f6ff', '#8b5cf6', '#c4b5fd', '#9ca3af'],
  light: ['#111827', '#7c3aed', '#a78bfa', '#64748b']
};

const FALLBACK_CACHE_KEY = 'orbit.state.v2';
function localDateString(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

const TODAY = localDateString();
const TIME_SLOTS = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
const CALENDAR_START_HOUR = 0;
const CALENDAR_END_HOUR = 24;
const CALENDAR_START_MINUTES = CALENDAR_START_HOUR * 60;
const CALENDAR_END_MINUTES = CALENDAR_END_HOUR * 60;
const CALENDAR_HOURS = Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR + 1 }, (_, index) => CALENDAR_START_HOUR + index);
const EVENT_TYPES = ['Focus', 'Meeting', 'Planning', 'Review', 'Recovery', 'Personal'];
const PERIODS = ['day', 'week', 'month', 'year'];
const EMPTY_SCORE = {
  period: 'day',
  score: 0,
  taskPoints: 0,
  focusPoints: 0,
  consistencyPoints: 0,
  completedTaskWeight: 0,
  totalTaskWeight: 0,
  scoredTaskWeight: 0,
  taskGoalWeight: 0,
  taskScoreCap: 0,
  scoredTaskCount: 0,
  completedTaskCount: 0,
  createdTaskCount: 0,
  duplicateTaskCount: 0,
  microTaskCount: 0,
  invalidFocusCount: 0,
  spamPenalty: 0,
  validFocusMinutes: 0,
  focusGoalMinutes: 0,
  suspiciousCount: 0,
  validation: 'Clean',
  trustScore: 100,
  trustLabel: 'High trust',
  validationReasons: ['Clean activity trail. No scoring penalties were applied.'],
  whyThisChanged: []
};
const EMPTY_SCORE_SUMMARY = {
  today: { ...EMPTY_SCORE, period: 'day' },
  week: { ...EMPTY_SCORE, period: 'week' },
  month: { ...EMPTY_SCORE, period: 'month' },
  year: { ...EMPTY_SCORE, period: 'year' }
};
const VIEW_PATHS = {
  Today: '/',
  Tasks: '/tasks',
  Notes: '/notes',
  Focus: '/focus',
  Calendar: '/calendar',
  Groups: '/groups',
  Score: '/score',
  Profile: '/profile'
};

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function todayLabel() {
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  }).format(new Date());
}

function dateLabel(dateString) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(`${dateString}T12:00:00`));
}

function minutesFromClock(value = '00:00') {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function eventDurationMinutes(event) {
  const start = minutesFromClock(event.start);
  const end = minutesFromClock(event.end);
  return Math.max(end - start, 30);
}

function durationLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function readCachedState() {
  try {
    const stored = window.localStorage.getItem(FALLBACK_CACHE_KEY);
    return stored ? normalizeState(JSON.parse(stored)) : createDefaultState();
  } catch {
    return createDefaultState();
  }
}

function resolveUpdater(updater, current) {
  return typeof updater === 'function' ? updater(current) : updater;
}

function sortedEvents(events) {
  return [...events].sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
}

function layoutDayEvents(events) {
  const blocks = sortedEvents(events).map(event => {
    const rawStart = minutesFromClock(event.start);
    const rawEnd = Math.max(minutesFromClock(event.end), rawStart + 30);
    return {
      event,
      start: Math.max(rawStart, CALENDAR_START_MINUTES),
      end: Math.min(rawEnd, CALENDAR_END_MINUTES)
    };
  }).filter(block => block.end > CALENDAR_START_MINUTES && block.start < CALENDAR_END_MINUTES);

  const laidOut = [];
  let cluster = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    const active = [];
    let maxColumn = 0;
    cluster.forEach(block => {
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (active[index].end <= block.start) active.splice(index, 1);
      }
      const usedColumns = new Set(active.map(item => item.column));
      let column = 0;
      while (usedColumns.has(column)) column += 1;
      block.column = column;
      active.push(block);
      maxColumn = Math.max(maxColumn, column);
    });
    cluster.forEach(block => laidOut.push({ ...block, columns: maxColumn + 1 }));
    cluster = [];
  };

  blocks.forEach(block => {
    if (!cluster.length || block.start < clusterEnd) {
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, block.end);
      return;
    }
    flushCluster();
    cluster.push(block);
    clusterEnd = block.end;
  });

  if (cluster.length) flushCluster();
  return laidOut;
}

function pathForView(view) {
  return VIEW_PATHS[view] ?? '/';
}

function viewFromPath(pathname = window.location.pathname) {
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!clean) return 'Today';
  if (clean === 'insights') return 'Score';
  return VIEW_LABELS.find(label => label.toLowerCase() === clean) ?? 'Today';
}

export default function App() {
  const [orbitState, setOrbitState] = useState(readCachedState);
  const [backendStatus, setBackendStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [taskDraft, setTaskDraft] = useState({ title: '', date: TODAY, priority: 'New', meta: 'Quick capture' });
  const [noteDraft, setNoteDraft] = useState({ title: '', body: '', tag: 'Note' });
  const [eventDraft, setEventDraft] = useState({ title: '', date: TODAY, start: '09:00', end: '09:30', type: 'Focus', notes: '' });
  const [routineDraft, setRoutineDraft] = useState({ title: '', cadence: 'Daily', anchor: 'Anytime' });
  const [profileDraft, setProfileDraft] = useState(null);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authInfo, setAuthInfo] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [scores, setScores] = useState(EMPTY_SCORE_SUMMARY);
  const [groups, setGroups] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [scorePeriod, setScorePeriod] = useState('day');
  const [leaderboardPeriod, setLeaderboardPeriod] = useState('day');
  const [leaderboardScope, setLeaderboardScope] = useState('group');
  const [activeGroupId, setActiveGroupId] = useState('');
  const [copiedGroupCode, setCopiedGroupCode] = useState('');
  const [groupDraft, setGroupDraft] = useState('');
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [joinCodeDraft, setJoinCodeDraft] = useState('');
  const [booting, setBooting] = useState(true);
  const inputRef = useRef(null);
  const lastCompletedRef = useRef(orbitState.focus.completed);
  const reducedMotion = usePrefersReducedMotion();
  const compactDock = useMediaQuery('(max-width: 760px)');
  const tinyDock = useMediaQuery('(max-width: 430px)');
  const { theme, tasks, notes, routines, events, activeView, focus, profile } = orbitState;

  const updateOrbitState = useCallback(updater => {
    setOrbitState(current => normalizeState(resolveUpdater(updater, current)));
  }, []);

  const setFocus = useCallback(updater => {
    updateOrbitState(current => ({ ...current, focus: resolveUpdater(updater, current.focus) }));
  }, [updateOrbitState]);

  useEffect(() => {
    setProfileDraft(profile);
  }, [profile]);

  useEffect(() => {
    const stillExists = notes.some(note => note.id === selectedNoteId);
    if (!selectedNoteId || !stillExists) {
      setSelectedNoteId(notes[0]?.id ?? null);
    }
  }, [notes, selectedNoteId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    setBackendStatus('loading');
    Promise.all([getCurrentUser(), getSuggestions().catch(() => [])])
      .then(([payload, nextSuggestions]) => {
        if (cancelled) return;
        setCurrentUser(payload.user);
        setAuthInfo(payload.auth ?? null);
        setSessionInfo(payload.session ?? null);
        setOrbitState(normalizeState({ ...payload.state, activeView: viewFromPath() }));
        setScores({ ...EMPTY_SCORE_SUMMARY, ...(payload.scores ?? {}) });
        setGroups(payload.groups ?? []);
        setSuggestions(nextSuggestions);
        setBackendStatus('online');
      })
      .catch(error => {
        if (cancelled) return;
        if (error?.status === 401) {
          setCurrentUser(null);
          setAuthInfo(null);
          setSessionInfo(null);
          setBackendStatus('online');
        } else {
          setBackendStatus('offline');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshScores = useCallback(() => {
    return getScoreSummary()
      .then(nextScores => {
        setScores({ ...EMPTY_SCORE_SUMMARY, ...(nextScores ?? {}) });
        return nextScores;
      })
      .catch(() => {
        setBackendStatus('offline');
        return null;
      });
  }, []);

  const refreshGroups = useCallback(() => {
    return getGroups()
      .then(nextGroups => {
        setGroups(nextGroups);
        return nextGroups;
      })
      .catch(() => {
        setBackendStatus('offline');
        return [];
      });
  }, []);

  useEffect(() => {
    const initialView = viewFromPath();
    window.history.replaceState({ view: initialView }, '', pathForView(initialView));
    updateOrbitState(current => ({ ...current, activeView: initialView }));

    const handlePopState = () => {
      const nextView = viewFromPath();
      updateOrbitState(current => ({ ...current, activeView: nextView }));
      if (!currentUser) return;
      patchPreferences({ activeView: nextView })
        .then(state => setOrbitState(normalizeState({ ...state, activeView: nextView })))
        .catch(() => setBackendStatus('offline'));
    };

    const handleHistoryKeys = event => {
      const active = document.activeElement;
      const typing = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.tagName === 'SELECT';
      if (typing || !event.altKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        window.history.back();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        window.history.forward();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleHistoryKeys);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleHistoryKeys);
    };
  }, [currentUser, updateOrbitState]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FALLBACK_CACHE_KEY, JSON.stringify(orbitState));
    } catch {
      // Local API owns persistence; browser cache is only the offline cushion.
    }
  }, [orbitState]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), reducedMotion ? 280 : 1200);
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);

  useEffect(() => {
    if (!focus.running || focus.secondsLeft <= 0) return undefined;
    const interval = window.setInterval(() => {
      setFocus(current => {
        if (!current.running) return current;
        const nextSeconds = Math.max(current.secondsLeft - 1, 0);
        return {
          ...current,
          running: nextSeconds > 0,
          secondsLeft: nextSeconds,
          completed: nextSeconds === 0 ? current.completed + 1 : current.completed
        };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [focus.running, focus.secondsLeft, setFocus]);

  useEffect(() => {
    if (focus.completed <= lastCompletedRef.current) {
      lastCompletedRef.current = focus.completed;
      return;
    }

    lastCompletedRef.current = focus.completed;
    if (focus.alarmEnabled) playFocusAlarm();
    const completionCall = focus.activeSessionId ? completeFocusSession(focus.activeSessionId) : patchFocusRemote(focus).then(state => ({ state }));
    completionCall
      .then(payload => {
        setOrbitState(payload.state ?? payload);
        setBackendStatus('online');
        refreshScores();
        refreshLeaderboard();
      })
      .catch(() => setBackendStatus('offline'));
  }, [focus, focus.completed, refreshScores]);

  const todayEvents = useMemo(() => sortedEvents(events.filter(event => event.date === TODAY)), [events]);
  const upcomingEvents = useMemo(() => sortedEvents(events).slice(0, 8), [events]);
  const openTasks = tasks.filter(task => !task.done);
  const doneTasks = tasks.filter(task => task.done);
  const completion = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;
  const routineCompletion = routines.length ? Math.round((routines.filter(item => item.done).length / routines.length) * 100) : 0;
  const focusProgress = Math.min(Math.max(((25 * 60 - focus.secondsLeft) / (25 * 60)) * 100, 0), 100);
  const focusGap = Math.max((profile.dailyFocusGoal || 4) - focus.completed, 0);
  const recoveryPressure = todayEvents.length >= 5 ? 'Heavy' : todayEvents.length >= 3 ? 'Guarded' : 'Open';
  const activeStrands = STRAND_COLORS[theme] ?? STRAND_COLORS.dark;
  const activeGroup = groups.find(group => group.id === activeGroupId) ?? groups[0] ?? null;
  const currentScore = scores.today ?? EMPTY_SCORE;
  const periodScore = scores[scorePeriod === 'day' ? 'today' : scorePeriod] ?? EMPTY_SCORE;
  const myRank = leaderboard.find(row => row.userId === currentUser?.id)?.rank ?? null;
  const nextEvent = todayEvents.find(event => minutesFromClock(event.end) >= minutesFromClock(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()))) ?? todayEvents[0] ?? upcomingEvents[0] ?? null;

  useEffect(() => {
    setGroupNameDraft(activeGroup?.name ?? '');
  }, [activeGroup?.id, activeGroup?.name]);

  useEffect(() => {
    if (!currentUser) return;
    if (leaderboardScope === 'group' && !activeGroup) {
      setLeaderboard([]);
      return;
    }
    const loadLeaderboard = leaderboardScope === 'group'
      ? getGroupLeaderboard(activeGroup.id, leaderboardPeriod)
      : getGlobalLeaderboard(leaderboardPeriod);
    loadLeaderboard
      .then(setLeaderboard)
      .catch(() => {
        setLeaderboard([]);
        setBackendStatus('offline');
      });
  }, [activeGroup, currentUser, leaderboardPeriod, leaderboardScope]);

  useEffect(() => {
    if (!groups.length) {
      if (activeGroupId) setActiveGroupId('');
      return;
    }
    if (!activeGroupId || !groups.some(group => group.id === activeGroupId)) {
      setActiveGroupId(groups[0].id);
    }
  }, [activeGroupId, groups]);

  useEffect(() => {
    if (!currentUser || !activeGroup) {
      setGroupMembers([]);
      return;
    }
    getGroupMembers(activeGroup.id)
      .then(setGroupMembers)
      .catch(() => setGroupMembers([]));
  }, [activeGroup, currentUser]);
  const selectedNote = notes.find(note => note.id === selectedNoteId) ?? notes[0] ?? null;

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter(task => `${task.title} ${task.meta} ${task.priority}`.toLowerCase().includes(needle));
  }, [query, tasks]);

  const dockIconMap = {
    Today: <Home size={21} />,
    Tasks: <ListTodo size={21} />,
    Notes: <NotebookPen size={21} />,
    Focus: <Timer size={21} />,
    Calendar: <CalendarDays size={21} />,
    Groups: <UsersRound size={21} />,
    Score: <BarChart3 size={21} />,
    Profile: <UserRound size={21} />
  };

  const dockItems = VIEW_LABELS.map(label => ({
    label,
    icon: dockIconMap[label],
    onClick: () => handleNavigate(label),
    className: activeView === label ? 'active' : ''
  }));
  const dockSizing = tinyDock
    ? { panelHeight: 54, baseItemSize: 34, magnification: 38, dockHeight: 86, distance: 110 }
    : compactDock
      ? { panelHeight: 62, baseItemSize: 40, magnification: 46, dockHeight: 98, distance: 130 }
      : { panelHeight: 82, baseItemSize: 58, magnification: 74, dockHeight: 150, distance: 180 };

  const handleNavigate = view => {
    const nextPath = pathForView(view);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ view }, '', nextPath);
    }
    if (view === activeView) return;
    updateOrbitState(current => ({ ...current, activeView: view }));
    if (!currentUser) return;
    patchPreferences({ activeView: view })
      .then(state => {
        setOrbitState(normalizeState({ ...state, activeView: view }));
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const refreshSuggestions = () => {
    getSuggestions().then(setSuggestions).catch(() => undefined);
  };

  const refreshLeaderboard = useCallback((period = leaderboardPeriod, scope = leaderboardScope, group = activeGroup) => {
    if (scope === 'group' && !group) {
      setLeaderboard([]);
      return Promise.resolve([]);
    }
    const request = scope === 'group'
      ? getGroupLeaderboard(group.id, period)
      : getGlobalLeaderboard(period);
    return request
      .then(rows => {
        setLeaderboard(rows);
        return rows;
      })
      .catch(() => {
        setLeaderboard([]);
        setBackendStatus('offline');
        return [];
      });
  }, [activeGroup, leaderboardPeriod, leaderboardScope]);

  useEffect(() => {
    if (!currentUser || !['Today', 'Groups', 'Score'].includes(activeView)) return;
    refreshScores();
    refreshLeaderboard();
  }, [activeView, currentUser, refreshLeaderboard, refreshScores]);

  const handleGuestLogin = () => {
    startGuestSession()
      .then(payload => {
        setCurrentUser(payload.user);
        setAuthInfo(payload.auth ?? null);
        setSessionInfo(payload.session ?? null);
        setOrbitState(normalizeState({ ...payload.state, activeView: viewFromPath() }));
        setScores({ ...EMPTY_SCORE_SUMMARY, ...(payload.scores ?? {}) });
        setGroups(payload.groups ?? []);
        setBackendStatus('online');
        refreshSuggestions();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleGoogleLogin = () => {
    startGoogleLogin(window.location.pathname || '/');
  };

  const handleLogout = () => {
    logoutSession()
      .catch(() => undefined)
      .finally(() => {
        setCurrentUser(null);
        setAuthInfo(null);
        setSessionInfo(null);
        setGroups([]);
        setGroupMembers([]);
        setLeaderboard([]);
        setActiveGroupId('');
        setCopiedGroupCode('');
        setBackendStatus('online');
      });
  };

  const handleCreateGroup = event => {
    event.preventDefault();
    const name = groupDraft.trim();
    if (!name) return;
    createGroup(name)
      .then(payload => {
        setGroups(payload.groups);
        setActiveGroupId(payload.group.id);
        setGroupDraft('');
        setLeaderboardScope('group');
        getGroupMembers(payload.group.id).then(setGroupMembers).catch(() => undefined);
        refreshLeaderboard(leaderboardPeriod, 'group', payload.group);
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleJoinGroup = event => {
    event.preventDefault();
    const joinCode = joinCodeDraft.trim();
    if (!joinCode) return;
    joinGroup(joinCode)
      .then(payload => {
        setGroups(payload.groups);
        setActiveGroupId(payload.group.id);
        setJoinCodeDraft('');
        setLeaderboardScope('group');
        getGroupMembers(payload.group.id).then(setGroupMembers).catch(() => undefined);
        refreshLeaderboard(leaderboardPeriod, 'group', payload.group);
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleRegenerateInvite = () => {
    if (!activeGroup) return;
    regenerateGroupInvite(activeGroup.id)
      .then(payload => {
        setGroups(payload.groups);
        setActiveGroupId(payload.group.id);
        getGroupMembers(payload.group.id).then(setGroupMembers).catch(() => undefined);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleRenameGroup = event => {
    event.preventDefault();
    if (!activeGroup) return;
    const name = groupNameDraft.trim();
    if (!name || name === activeGroup.name) return;
    patchGroup(activeGroup.id, { name })
      .then(payload => {
        setGroups(payload.groups);
        setActiveGroupId(payload.group.id);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleDeleteGroup = () => {
    if (!activeGroup || activeGroup.role !== 'owner') return;
    const fallbackName = activeGroup.name;
    const confirmed = window.confirm(`Delete "${fallbackName}" for everyone? This cannot be undone.`);
    if (!confirmed) return;
    deleteGroup(activeGroup.id)
      .then(payload => {
        const nextGroups = payload.groups ?? [];
        const nextActiveGroup = nextGroups[0] ?? null;
        setGroups(nextGroups);
        setActiveGroupId(nextActiveGroup?.id ?? '');
        setGroupMembers([]);
        setLeaderboardScope(nextActiveGroup ? 'group' : 'global');
        refreshLeaderboard(leaderboardPeriod, nextActiveGroup ? 'group' : 'global', nextActiveGroup);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleUpdateGroupMemberRole = (memberUserId, role) => {
    if (!activeGroup) return;
    updateGroupMember(activeGroup.id, memberUserId, role)
      .then(members => {
        setGroupMembers(members);
        refreshGroups();
        refreshLeaderboard();
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleRemoveGroupMember = memberUserId => {
    if (!activeGroup) return;
    const leavingSelf = memberUserId === currentUser?.id;
    removeGroupMember(activeGroup.id, memberUserId)
      .then(payload => {
        const nextGroups = payload.groups ?? [];
        const nextActiveGroup = leavingSelf ? nextGroups[0] ?? null : activeGroup;
        setGroupMembers(leavingSelf ? [] : payload.members);
        setGroups(nextGroups);
        if (leavingSelf) {
          setActiveGroupId(nextActiveGroup?.id ?? '');
          setLeaderboardScope(nextActiveGroup ? 'group' : 'global');
          refreshLeaderboard(leaderboardPeriod, nextActiveGroup ? 'group' : 'global', nextActiveGroup);
        } else {
          refreshLeaderboard();
        }
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleLeaveGroup = () => {
    if (!activeGroup || activeGroup.role === 'owner' || !currentUser) return;
    handleRemoveGroupMember(currentUser.id);
  };

  const handleCopyGroupCode = code => {
    const value = String(code || '').trim();
    if (!value) return;

    const fallbackCopy = () => {
      const node = document.createElement('textarea');
      node.value = value;
      node.setAttribute('readonly', '');
      node.style.position = 'fixed';
      node.style.opacity = '0';
      document.body.appendChild(node);
      node.select();
      document.execCommand('copy');
      document.body.removeChild(node);
    };

    Promise.resolve()
      .then(() => navigator.clipboard?.writeText ? navigator.clipboard.writeText(value) : fallbackCopy())
      .catch(fallbackCopy)
      .finally(() => {
        setCopiedGroupCode(value);
        window.setTimeout(() => {
          setCopiedGroupCode(current => current === value ? '' : current);
        }, 1600);
      });
  };

  const addTask = title => {
    const task = createCapturedTask(title);
    if (!task) return;
    updateOrbitState(current => ({ ...current, tasks: [task, ...current.tasks] }));
    setQuery('');
    createTaskRemote(title)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        refreshSuggestions();
        refreshScores();
        refreshLeaderboard();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const createTaskFromDraft = event => {
    event.preventDefault();
    const title = taskDraft.title.trim();
    if (!title) return;
    const optimistic = createCapturedTask(title);
    if (optimistic) {
      optimistic.date = taskDraft.date;
      optimistic.priority = taskDraft.priority;
      optimistic.meta = taskDraft.meta;
      updateOrbitState(current => ({ ...current, tasks: [optimistic, ...current.tasks] }));
    }
    setTaskDraft(current => ({ ...current, title: '' }));
    createTaskRemote(`${title}${taskDraft.priority === 'High' ? ' !' : ''}`)
      .then(state => patchTask(state.tasks[0].id, { date: taskDraft.date, priority: taskDraft.priority, meta: taskDraft.meta }))
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        refreshSuggestions();
        refreshScores();
        refreshLeaderboard();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const updateTask = (taskId, updates) => {
    updateOrbitState(current => ({
      ...current,
      tasks: current.tasks.map(task => (task.id === taskId ? { ...task, ...updates } : task))
    }));
    patchTask(taskId, updates)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        refreshScores();
        refreshLeaderboard();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const toggleTask = taskId => {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    updateTask(taskId, { done: !task.done });
  };

  const removeTask = taskId => {
    updateOrbitState(current => ({ ...current, tasks: current.tasks.filter(task => task.id !== taskId) }));
    deleteTask(taskId)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        refreshSuggestions();
        refreshScores();
        refreshLeaderboard();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const createNoteFromDraft = event => {
    event.preventDefault();
    if (!noteDraft.title.trim()) return;
    createNote(noteDraft)
      .then(state => {
        setOrbitState(state);
        setSelectedNoteId(state.notes[0]?.id ?? null);
        setBackendStatus('online');
        setNoteDraft({ title: '', body: '', tag: 'Note' });
      })
      .catch(() => setBackendStatus('offline'));
  };

  const updateNote = (noteId, updates) => {
    updateOrbitState(current => ({
      ...current,
      notes: current.notes.map(note => (note.id === noteId ? { ...note, ...updates } : note))
    }));
    patchNote(noteId, updates)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const removeNote = noteId => {
    updateOrbitState(current => ({ ...current, notes: current.notes.filter(note => note.id !== noteId) }));
    deleteNote(noteId)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const createEventFromDraft = event => {
    event.preventDefault();
    if (!eventDraft.title.trim()) return;
    createEvent(eventDraft)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        setEventDraft(current => ({ ...current, title: '', notes: '' }));
        refreshSuggestions();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const updateEvent = (eventId, updates) => {
    updateOrbitState(current => ({
      ...current,
      events: sortedEvents(current.events.map(item => (item.id === eventId ? { ...item, ...updates } : item)))
    }));
    patchEvent(eventId, updates)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const removeEvent = eventId => {
    updateOrbitState(current => ({ ...current, events: current.events.filter(item => item.id !== eventId) }));
    deleteEvent(eventId)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        refreshSuggestions();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const createRoutineFromDraft = event => {
    event.preventDefault();
    if (!routineDraft.title.trim()) return;
    createRoutine(routineDraft)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        setRoutineDraft({ title: '', cadence: 'Daily', anchor: 'Anytime' });
        refreshSuggestions();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const updateRoutine = (routineId, updates) => {
    updateOrbitState(current => ({
      ...current,
      routines: current.routines.map(routine => (routine.id === routineId ? { ...routine, ...updates } : routine))
    }));
    patchRoutine(routineId, updates)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const removeRoutine = routineId => {
    updateOrbitState(current => ({ ...current, routines: current.routines.filter(routine => routine.id !== routineId) }));
    deleteRoutine(routineId)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        refreshSuggestions();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const toggleFocus = () => {
    if (!focus.running) {
      setFocus(current => ({ ...current, running: true }));
      startFocusSession()
        .then(payload => {
          setOrbitState(payload.state);
          setBackendStatus('online');
        })
        .catch(() => setBackendStatus('offline'));
      return;
    }
    const nextFocus = { ...focus, running: false };
    setFocus(nextFocus);
    patchFocusRemote(nextFocus)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const resetFocus = () => {
    setFocus(current => ({ ...current, running: false, secondsLeft: 25 * 60 }));
    resetFocusTimer()
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const saveProfile = event => {
    event.preventDefault();
    patchProfile(profileDraft)
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        refreshScores();
        refreshLeaderboard();
      })
      .catch(() => setBackendStatus('offline'));
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    updateOrbitState(current => ({ ...current, theme: nextTheme }));
    patchPreferences({ theme: nextTheme })
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const protectFocusBlock = () => {
    const task = openTasks.find(item => item.priority === 'Focus' || item.priority === 'High') ?? openTasks[0];
    createEvent({
      title: task ? `Focus: ${task.title}` : 'Protected focus block',
      date: TODAY,
      start: '15:00',
      end: '15:25',
      type: 'Focus',
      linkedTaskId: task?.id ?? '',
      notes: 'Auto-planned from Orbit focus protocol.'
    })
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        handleNavigate('Calendar');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const addRecoveryBuffer = () => {
    createEvent({
      title: 'Recovery buffer',
      date: TODAY,
      start: '16:30',
      end: '16:45',
      type: 'Recovery',
      notes: 'Step away, hydrate, reset attention.'
    })
      .then(state => {
        setOrbitState(state);
        setBackendStatus('online');
        handleNavigate('Calendar');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const createShutdownNote = () => {
    createNote({
      title: 'Shutdown note',
      tag: 'Shutdown',
      body: 'Closed loops:\nTomorrow first task:\nLoose ends parked:'
    })
      .then(state => {
        setOrbitState(state);
        setSelectedNoteId(state.notes[0]?.id ?? null);
        setBackendStatus('online');
        handleNavigate('Notes');
      })
      .catch(() => setBackendStatus('offline'));
  };

  const handleCommandSubmit = event => {
    event.preventDefault();
    addTask(query);
  };

  if (!currentUser) {
    return (
      <OnboardingScreen
        theme={theme}
        backendStatus={backendStatus}
        onGoogleLogin={handleGoogleLogin}
        onGuestLogin={handleGuestLogin}
      />
    );
  }

  return (
    <div className="app-shell">
      <AmbientLayer theme={theme} />
      <CardNav
        className="orbit-card-nav"
        items={NAV_ITEMS}
        activeView={activeView}
        onNavigate={handleNavigate}
        onQuickCapture={() => inputRef.current?.focus()}
        baseColor="color-mix(in srgb, var(--panel) 30%, transparent)"
        menuColor="var(--text)"
        buttonBgColor="color-mix(in srgb, var(--panel-strong) 42%, transparent)"
        buttonTextColor="var(--text)"
      />
      <Dock items={dockItems} className="orbit-dock" {...dockSizing} />

      <main className="orbit-workspace">
        <TopConsole
          backendStatus={backendStatus}
          inputRef={inputRef}
          query={query}
          setQuery={setQuery}
          onSubmit={handleCommandSubmit}
          onToggleTheme={toggleTheme}
          theme={theme}
          profile={profile}
          onProfile={() => handleNavigate('Profile')}
        />

        <section className="orbit-stage">
          <div className="workspace-panel glass-panel">
            <ActivePage
              activeView={activeView}
              tasks={tasks}
              filteredTasks={filteredTasks}
              openTasks={openTasks}
              doneTasks={doneTasks}
              notes={notes}
              routines={routines}
              events={events}
              todayEvents={todayEvents}
              upcomingEvents={upcomingEvents}
              focus={focus}
              focusProgress={focusProgress}
              currentUser={currentUser}
              authInfo={authInfo}
              sessionInfo={sessionInfo}
              scores={scores}
              currentScore={currentScore}
              periodScore={periodScore}
              scorePeriod={scorePeriod}
              onScorePeriodChange={setScorePeriod}
              groups={groups}
              groupMembers={groupMembers}
              activeGroup={activeGroup}
              activeGroupId={activeGroup?.id ?? ''}
              copiedGroupCode={copiedGroupCode}
              leaderboard={leaderboard}
              leaderboardPeriod={leaderboardPeriod}
              leaderboardScope={leaderboardScope}
              myRank={myRank}
              nextEvent={nextEvent}
              groupDraft={groupDraft}
              groupNameDraft={groupNameDraft}
              joinCodeDraft={joinCodeDraft}
              profile={profileDraft ?? profile}
              suggestions={suggestions}
              selectedNote={selectedNote}
              taskDraft={taskDraft}
              noteDraft={noteDraft}
              eventDraft={eventDraft}
              routineDraft={routineDraft}
              completion={completion}
              routineCompletion={routineCompletion}
              focusGap={focusGap}
              recoveryPressure={recoveryPressure}
              onNavigate={handleNavigate}
              onTaskDraftChange={setTaskDraft}
              onNoteDraftChange={setNoteDraft}
              onEventDraftChange={setEventDraft}
              onRoutineDraftChange={setRoutineDraft}
              onGroupDraftChange={setGroupDraft}
              onGroupNameDraftChange={setGroupNameDraft}
              onJoinCodeDraftChange={setJoinCodeDraft}
              onActiveGroupChange={setActiveGroupId}
              onCreateTask={createTaskFromDraft}
              onCreateNote={createNoteFromDraft}
              onCreateEvent={createEventFromDraft}
              onCreateRoutine={createRoutineFromDraft}
              onCreateGroup={handleCreateGroup}
              onJoinGroup={handleJoinGroup}
              onRenameGroup={handleRenameGroup}
              onDeleteGroup={handleDeleteGroup}
              onRegenerateInvite={handleRegenerateInvite}
              onUpdateGroupMemberRole={handleUpdateGroupMemberRole}
              onRemoveGroupMember={handleRemoveGroupMember}
              onLeaveGroup={handleLeaveGroup}
              onCopyGroupCode={handleCopyGroupCode}
              onLeaderboardPeriodChange={setLeaderboardPeriod}
              onLeaderboardScopeChange={setLeaderboardScope}
              onToggleTask={toggleTask}
              onUpdateTask={updateTask}
              onDeleteTask={removeTask}
              onSelectNote={setSelectedNoteId}
              onUpdateNote={updateNote}
              onDeleteNote={removeNote}
              onUpdateEvent={updateEvent}
              onDeleteEvent={removeEvent}
              onUpdateRoutine={updateRoutine}
              onDeleteRoutine={removeRoutine}
              onFocusChange={nextFocus => {
                setFocus(nextFocus);
                patchFocusRemote(nextFocus).then(setOrbitState).catch(() => setBackendStatus('offline'));
              }}
              onToggleFocus={toggleFocus}
              onResetFocus={resetFocus}
              onProfileChange={setProfileDraft}
              onSaveProfile={saveProfile}
              onLogout={handleLogout}
              onGoogleLogin={handleGoogleLogin}
              onProtectFocus={protectFocusBlock}
              onRecoveryBuffer={addRecoveryBuffer}
              onShutdownNote={createShutdownNote}
            />
          </div>
        </section>

        <LegalStrip />
      </main>

      {booting ? (
        <LoadingOverlay title="Orbit is aligning" subtitle="Preparing planner, notes, focus, and rituals" colors={activeStrands} />
      ) : null}
    </div>
  );
}

function LegalStrip() {
  return (
    <footer className="legal-strip" aria-label="Orbit legal links">
      <span>Orbit Social Lock-In</span>
      <a href="#terms">Terms of Service</a>
      <a href="#privacy">Privacy</a>
      <a href="#security">Security</a>
      <span>Fair-play scoring, cookie sessions, group-visible handles.</span>
    </footer>
  );
}

function AmbientLayer({ theme }) {
  return (
    <div className="grid-layer" aria-hidden="true">
      <ShapeGrid
        direction="diagonal"
        speed={theme === 'dark' ? 0.18 : 0.12}
        squareSize={54}
        borderColor={theme === 'dark' ? 'rgba(196, 181, 253, 0.08)' : 'rgba(124, 58, 237, 0.08)'}
        hoverFillColor={theme === 'dark' ? 'rgba(167, 139, 250, 0.10)' : 'rgba(124, 58, 237, 0.05)'}
        hoverTrailAmount={3}
      />
    </div>
  );
}

function TopConsole({ backendStatus, inputRef, query, setQuery, onSubmit, onToggleTheme, theme, profile, onProfile }) {
  return (
    <section className="top-console glass-panel">
      <div className="console-brand">
        <span className={`status-dot ${backendStatus}`} title={`Backend ${backendStatus}`} />
        <span className="brand-orbit">Orbit</span>
        <small>{todayLabel()}</small>
      </div>
      <form className="command-bar" onSubmit={onSubmit}>
        <Search size={18} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Capture a task, search, or add ! for priority"
          aria-label="Search or quick capture"
        />
        <kbd>Enter</kbd>
      </form>
      <div className="console-actions">
        <button type="button" className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button type="button" className="profile-button" aria-label="Open profile and login" onClick={onProfile}>
          <CircleUserRound size={22} />
          <span>{profile.handle || 'me'}</span>
        </button>
      </div>
    </section>
  );
}

function OnboardingScreen({ theme, onGoogleLogin, onGuestLogin }) {
  return (
    <div className="app-shell onboarding-shell">
      <AmbientLayer theme={theme} />
      <section className="auth-shell glass-panel">
        <div className="auth-visual">
          <Strands
            colors={STRAND_COLORS.dark}
            count={5}
            speed={0.2}
            amplitude={0.72}
            waviness={1.08}
            thickness={0.58}
            glow={2.6}
            spread={1.2}
            intensity={0.6}
            opacity={0.66}
            scale={1.08}
          />
          <div className="auth-copy">
            <span className="login-mark"><ShieldCheck size={22} /></span>
            <h1>Enter Orbit</h1>
            <p>Sign in with Google for identity, groups, and fair leaderboard scoring. Guest mode keeps this browser session moving.</p>
          </div>
        </div>
        <div className="auth-actions-panel">
          <BorderGlow className="action-glow fill static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72">
            <button type="button" className="primary-button google-button" onClick={onGoogleLogin}>
              <LogIn size={16} /> Continue with Google
            </button>
          </BorderGlow>
          <button type="button" className="secondary-button guest-button" onClick={onGuestLogin}>
            <UserRound size={16} /> Continue as guest
          </button>
          <p className="backend-note">Guest sessions receive a unique handle and can be upgraded later.</p>
        </div>
      </section>
    </div>
  );
}

function ActivePage(props) {
  const { activeView } = props;
  if (activeView === 'Tasks') return <TasksPage {...props} />;
  if (activeView === 'Notes') return <NotesPage {...props} />;
  if (activeView === 'Calendar') return <CalendarPage {...props} />;
  if (activeView === 'Focus') return <FocusPage {...props} />;
  if (activeView === 'Groups') return <GroupsPage {...props} />;
  if (activeView === 'Score') return <ScorePage {...props} />;
  if (activeView === 'Profile') return <ProfilePage {...props} />;
  return <TodayPage {...props} />;
}

function TodayPage({
  openTasks,
  routines,
  todayEvents,
  notes,
  suggestions,
  completion,
  routineCompletion,
  focus,
  focusProgress,
  currentScore,
  activeGroup,
  myRank,
  nextEvent,
  focusGap,
  recoveryPressure,
  onNavigate,
  onToggleTask,
  onUpdateRoutine,
  onProtectFocus,
  onRecoveryBuffer,
  onShutdownNote,
  onToggleFocus,
  onResetFocus
}) {
  const primarySuggestion = suggestions[0];
  const latestNote = notes[0];

  return (
    <div className="page-surface today-page refined-home">
      <PageHeader
        icon={<Home size={18} />}
        title="Lock-in desk"
        copy="Today is about one honest score: finish useful work, start real focus, and climb with your group."
        action={<IconButton icon={<Timer size={16} />} label={focus.running ? 'Pause focus' : 'Start focus'} onClick={onToggleFocus} />}
      />
      <div className="home-summary-strip">
        <BorderGlow className="metric-glow static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72">
          <Metric icon={<Trophy size={21} />} label="Lock-in score" value={`${currentScore.score}`} tone="violet" onClick={() => onNavigate('Score')} />
        </BorderGlow>
        <BorderGlow className="metric-glow metric-glow-rank static-glow" colors={['#8dd8c8', '#c4b5fd', '#6b7280']} glowColor="166 55 70">
          <Metric icon={<Medal size={21} />} label={activeGroup ? activeGroup.name : 'Global rank'} value={myRank ? `#${myRank}` : '--'} tone="mint" onClick={() => onNavigate('Groups')} />
        </BorderGlow>
        <BorderGlow className="metric-glow metric-glow-muted static-glow" colors={['#6b7280', '#8b5cf6', '#c4b5fd']} glowColor="252 36 64">
          <Metric icon={<Target size={21} />} label="Task progress" value={`${completion}%`} tone="slate" onClick={() => onNavigate('Tasks')} />
        </BorderGlow>
      </div>
      <div className="home-command-grid">
        <section className="desk-panel home-plan-panel">
          <SectionTitle icon={<Clock3 size={17} />} title="Day plan" action={<button type="button" onClick={() => onNavigate('Calendar')}>Open calendar</button>} />
          <p className="panel-note">{nextEvent ? `Next block: ${nextEvent.title} at ${nextEvent.start}. Tap the planner to edit details.` : 'Build a clean day plan from focus, recovery, and personal blocks.'}</p>
          <PlannerCanvas events={todayEvents} onNavigate={onNavigate} />
        </section>

        <section className="desk-panel home-focus-panel">
          <SectionTitle icon={<Timer size={17} />} title="Validated focus" action={<button type="button" onClick={onProtectFocus}>Schedule block</button>} />
          <p className="panel-note">{currentScore.validFocusMinutes} valid minutes logged. {focusGap ? `${focusGap} block${focusGap === 1 ? '' : 's'} left for the daily goal.` : 'Daily goal is protected.'}</p>
          <FocusReactor focus={focus} focusProgress={focusProgress} />
          <div className="focus-actions home-focus-actions">
            <BorderGlow className="action-glow fill static-glow" colors={['#8b5cf6', '#c4b5fd', '#6b7280']} glowColor="260 72 72">
              <button type="button" className="primary-button" onClick={onToggleFocus}>
                {focus.running ? 'Pause focus' : 'Start focus'}
              </button>
            </BorderGlow>
            <button type="button" className="secondary-button" onClick={onResetFocus}>Reset</button>
          </div>
          {primarySuggestion ? (
            <button type="button" className="mini-suggestion" onClick={() => onNavigate('Score')}>
              <span>{primarySuggestion.signal}</span>
              <strong>{primarySuggestion.title}</strong>
              <em>{primarySuggestion.meta}</em>
            </button>
          ) : null}
        </section>

        <section className="desk-panel home-task-panel">
          <SectionTitle icon={<ListTodo size={17} />} title="Priority queue" action={<button type="button" onClick={() => onNavigate('Tasks')}>Edit</button>} />
          <p className="panel-note">Only the first open loops live here. Full sorting and editing stays on Tasks.</p>
          {openTasks.length ? (
            <AnimatedList
              items={openTasks.slice(0, 5)}
              className="home-task-list"
              displayScrollbar={false}
              showGradients={false}
              onItemSelect={task => onToggleTask(task.id)}
              renderItem={task => <TaskRow task={task} onToggle={() => onToggleTask(task.id)} />}
            />
          ) : (
            <EmptyState icon={<CheckCircle2 size={24} />} title="Nothing open" copy="Add a task from the command bar or Tasks page." />
          )}
        </section>

        <section className="desk-panel home-ritual-panel">
          <SectionTitle icon={<Sparkles size={17} />} title="Rituals" action={<button type="button" onClick={onShutdownNote}>Shutdown note</button>} />
          <p className="panel-note">Small guardrails for work-life balance: start clean, recover early, end deliberately.</p>
          <div className="ritual-stack">
            {routines.slice(0, 3).map(routine => (
              <RoutineRow key={routine.id} routine={routine} onToggle={() => onUpdateRoutine(routine.id, { done: !routine.done })} />
            ))}
          </div>
          <div className="home-ritual-actions">
            <button type="button" className="quiet-action" onClick={onRecoveryBuffer}><Coffee size={15} /> Add recovery buffer</button>
            <button type="button" className="quiet-action" onClick={() => onNavigate('Focus')}><ShieldCheck size={15} /> Edit rituals</button>
          </div>
          {latestNote ? (
            <button type="button" className="home-note-snapshot" onClick={() => onNavigate('Notes')}>
              <NotebookPen size={16} />
              <span>
                <em>Latest note</em>
                <strong>{latestNote.title}</strong>
              </span>
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function TasksPage({
  filteredTasks,
  doneTasks,
  taskDraft,
  onTaskDraftChange,
  onCreateTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask
}) {
  return (
    <div className="page-surface">
      <PageHeader icon={<ListTodo size={18} />} title="Tasks" copy="Capture a concrete next action, assign priority/date/context, and clear it from the open loop column." />
      <form className="compose-bar" onSubmit={onCreateTask}>
        <label className="form-field">
          <span>Task</span>
          <input value={taskDraft.title} onChange={event => onTaskDraftChange({ ...taskDraft, title: event.target.value })} placeholder="Add a clear next action" />
        </label>
        <label className="form-field">
          <span>Context</span>
          <input value={taskDraft.meta} onChange={event => onTaskDraftChange({ ...taskDraft, meta: event.target.value })} placeholder="Work, home, call..." />
        </label>
        <label className="form-field">
          <span>Due</span>
          <input type="date" value={taskDraft.date} onChange={event => onTaskDraftChange({ ...taskDraft, date: event.target.value })} />
        </label>
        <label className="form-field">
          <span>Priority</span>
          <select value={taskDraft.priority} onChange={event => onTaskDraftChange({ ...taskDraft, priority: event.target.value })}>
            <option>New</option>
            <option>High</option>
            <option>Focus</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </label>
        <PrimaryAction icon={<Plus size={16} />} label="Add task" />
      </form>
      <div className="task-board">
        <TaskColumn title="Open loop" count={filteredTasks.filter(task => !task.done).length}>
          {filteredTasks.filter(task => !task.done).map(task => (
            <EditableTask key={task.id} task={task} onToggle={onToggleTask} onUpdate={onUpdateTask} onDelete={onDeleteTask} />
          ))}
        </TaskColumn>
        <TaskColumn title="Closed" count={doneTasks.length}>
          {doneTasks.map(task => (
            <EditableTask key={task.id} task={task} onToggle={onToggleTask} onUpdate={onUpdateTask} onDelete={onDeleteTask} />
          ))}
        </TaskColumn>
      </div>
    </div>
  );
}

function NotesPage({
  notes,
  selectedNote,
  noteDraft,
  onNoteDraftChange,
  onCreateNote,
  onSelectNote,
  onUpdateNote,
  onDeleteNote
}) {
  return (
    <div className="page-surface">
      <PageHeader icon={<NotebookPen size={18} />} title="Notes" copy="Use the inbox to pick an idea, then edit in the larger writing surface without fighting tiny cards." />
      <form className="compose-bar notes-compose" onSubmit={onCreateNote}>
        <label className="form-field">
          <span>Title</span>
          <input value={noteDraft.title} onChange={event => onNoteDraftChange({ ...noteDraft, title: event.target.value })} placeholder="Note title" />
        </label>
        <label className="form-field">
          <span>Tag</span>
          <input value={noteDraft.tag} onChange={event => onNoteDraftChange({ ...noteDraft, tag: event.target.value })} placeholder="Idea, meeting..." />
        </label>
        <PrimaryAction icon={<Plus size={16} />} label="New note" />
      </form>
      <div className="notes-workspace">
        <section className="notes-index desk-panel">
          <AnimatedList
            items={notes}
            className="notes-index-list"
            showGradients={false}
            displayScrollbar
            onItemSelect={note => onSelectNote(note.id)}
            renderItem={note => <NoteIndexRow note={note} active={selectedNote?.id === note.id} />}
          />
        </section>
        <section className="note-editor desk-panel">
          {selectedNote ? (
            <>
              <div className="editor-toolbar">
                <label className="form-field">
                  <span>Title</span>
                  <input value={selectedNote.title} onChange={event => onUpdateNote(selectedNote.id, { title: event.target.value })} />
                </label>
                <label className="form-field">
                  <span>Tag</span>
                  <input value={selectedNote.tag} onChange={event => onUpdateNote(selectedNote.id, { tag: event.target.value })} />
                </label>
                <button type="button" className="icon-danger" onClick={() => onDeleteNote(selectedNote.id)}><Trash2 size={16} /> Delete</button>
              </div>
              <label className="form-field editor-body-field">
                <span>Body</span>
                <textarea value={selectedNote.body} onChange={event => onUpdateNote(selectedNote.id, { body: event.target.value })} placeholder="Write the thought clearly." />
              </label>
            </>
          ) : (
            <EmptyState icon={<NotebookPen size={24} />} title="No note selected" copy="Create or select a note to begin." />
          )}
        </section>
      </div>
    </div>
  );
}

function CalendarPage({
  tasks,
  events,
  todayEvents,
  eventDraft,
  onEventDraftChange,
  onCreateEvent,
  onUpdateEvent,
  onDeleteEvent,
  onProtectFocus,
  onRecoveryBuffer
}) {
  const [selectedEventId, setSelectedEventId] = useState(null);
  const selectedEvent = events.find(event => event.id === selectedEventId) ?? null;
  const [detailDraft, setDetailDraft] = useState(selectedEvent);
  const visibleEvents = sortedEvents(todayEvents);
  const scheduledMinutes = visibleEvents.reduce((total, event) => total + eventDurationMinutes(event), 0);
  const firstBlock = visibleEvents[0]?.start ?? '--';
  const lastBlock = visibleEvents[visibleEvents.length - 1]?.end ?? '--';

  useEffect(() => {
    setDetailDraft(selectedEvent);
  }, [selectedEvent]);

  const saveDetail = event => {
    event.preventDefault();
    if (!detailDraft) return;
    onUpdateEvent(detailDraft.id, detailDraft);
  };

  return (
    <div className="page-surface calendar-page">
      <PageHeader
        icon={<CalendarDays size={18} />}
        title="Calendar"
        copy="A real day planner: blocks sit where they belong, edits stay close, and recovery has visible space."
        action={<IconButton icon={<Timer size={16} />} label="Schedule focus" onClick={onProtectFocus} />}
      />
      <div className="calendar-workspace">
        <section className="desk-panel calendar-timeline-panel">
          <SectionTitle icon={<Clock3 size={17} />} title="Today timeline" action={<button type="button" onClick={onRecoveryBuffer}>Add buffer</button>} />
          <div className="calendar-stats-row">
            <CalendarStat label="Day" value={dateLabel(TODAY)} />
            <CalendarStat label="Scheduled" value={durationLabel(scheduledMinutes)} />
            <CalendarStat label="Window" value={`${firstBlock}-${lastBlock}`} />
          </div>
          <CalendarDayCanvas events={visibleEvents} selectedEventId={selectedEventId} onSelectEvent={setSelectedEventId} />
        </section>

        <aside className="calendar-side-stack">
          <CalendarDetailPanel
            detailDraft={detailDraft}
            tasks={tasks}
            onDraftChange={setDetailDraft}
            onSave={saveDetail}
            onDelete={onDeleteEvent}
          />
          <section className="desk-panel calendar-create-panel">
            <SectionTitle icon={<CalendarPlus size={17} />} title="Create block" />
            <form className="calendar-create-form" onSubmit={onCreateEvent}>
              <label>
                <span>Title</span>
                <input value={eventDraft.title} onChange={event => onEventDraftChange({ ...eventDraft, title: event.target.value })} placeholder="Deep work, review, gym..." />
              </label>
              <div className="calendar-form-row">
                <label>
                  <span>Date</span>
                  <input type="date" value={eventDraft.date} onChange={event => onEventDraftChange({ ...eventDraft, date: event.target.value })} />
                </label>
                <label>
                  <span>Type</span>
                  <select value={eventDraft.type} onChange={event => onEventDraftChange({ ...eventDraft, type: event.target.value })}>
                    {EVENT_TYPES.map(type => <option key={type}>{type}</option>)}
                  </select>
                </label>
              </div>
              <div className="calendar-form-row">
                <label>
                  <span>Start</span>
                  <input type="time" value={eventDraft.start} onChange={event => onEventDraftChange({ ...eventDraft, start: event.target.value })} />
                </label>
                <label>
                  <span>End</span>
                  <input type="time" value={eventDraft.end} onChange={event => onEventDraftChange({ ...eventDraft, end: event.target.value })} />
                </label>
              </div>
              <PrimaryAction icon={<CalendarPlus size={16} />} label="Add block" />
            </form>
          </section>

          <section className="desk-panel calendar-block-list-panel">
            <SectionTitle icon={<CalendarDays size={17} />} title="Schedule cards" />
            <div className="calendar-block-list">
              {visibleEvents.length ? visibleEvents.map(event => (
                <button
                  key={event.id}
                  type="button"
                  className={`calendar-block-row type-${event.type.toLowerCase()} ${selectedEventId === event.id ? 'selected' : ''}`}
                  onClick={() => setSelectedEventId(event.id)}
                >
                  <span className="calendar-block-time">
                    {event.start}
                    <small>{event.end}</small>
                  </span>
                  <span className="calendar-block-copy">
                    <strong>{event.title}</strong>
                    <em>{event.type} / {durationLabel(eventDurationMinutes(event))}</em>
                  </span>
                </button>
              )) : (
                <EmptyState icon={<CalendarDays size={18} />} title="No blocks yet" copy="Add a block and it will appear here." />
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function CalendarDetailPanel({ detailDraft, tasks, onDraftChange, onSave, onDelete }) {
  if (!detailDraft) {
    return (
      <section className="desk-panel calendar-detail-panel empty-detail">
        <CalendarDays size={22} />
        <strong>Select a schedule card</strong>
        <p>Touch a block on the timeline to open its detail view here.</p>
      </section>
    );
  }

  return (
    <section className="desk-panel calendar-detail-panel">
      <SectionTitle icon={<Edit3 size={17} />} title="Block details" />
      <form className="calendar-detail-form" onSubmit={onSave}>
        <label>
          <span>Title</span>
          <input value={detailDraft.title} onChange={event => onDraftChange({ ...detailDraft, title: event.target.value })} />
        </label>
        <div className="calendar-form-row">
          <label>
            <span>Date</span>
            <input type="date" value={detailDraft.date} onChange={event => onDraftChange({ ...detailDraft, date: event.target.value })} />
          </label>
          <label>
            <span>Type</span>
            <select value={detailDraft.type} onChange={event => onDraftChange({ ...detailDraft, type: event.target.value })}>
              {EVENT_TYPES.map(type => <option key={type}>{type}</option>)}
            </select>
          </label>
        </div>
        <div className="calendar-form-row">
          <label>
            <span>Start</span>
            <input type="time" value={detailDraft.start} onChange={event => onDraftChange({ ...detailDraft, start: event.target.value })} />
          </label>
          <label>
            <span>End</span>
            <input type="time" value={detailDraft.end} onChange={event => onDraftChange({ ...detailDraft, end: event.target.value })} />
          </label>
        </div>
        <label>
          <span>Linked task</span>
          <select value={detailDraft.linkedTaskId} onChange={event => onDraftChange({ ...detailDraft, linkedTaskId: event.target.value })}>
            <option value="">No linked task</option>
            {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
        <label>
          <span>Notes</span>
          <textarea value={detailDraft.notes} onChange={event => onDraftChange({ ...detailDraft, notes: event.target.value })} />
        </label>
        <div className="detail-actions">
          <PrimaryAction icon={<ShieldCheck size={16} />} label="Save block" />
          <button type="button" className="icon-danger" onClick={() => onDelete(detailDraft.id)}><Trash2 size={16} /> Delete</button>
        </div>
      </form>
    </section>
  );
}

function FocusPage({
  focus,
  focusProgress,
  routines,
  onFocusChange,
  onToggleFocus,
  onResetFocus,
  onUpdateRoutine,
  onCreateRoutine,
  routineDraft,
  onRoutineDraftChange,
  onDeleteRoutine,
  onRecoveryBuffer,
  onShutdownNote,
  onProtectFocus
}) {
  return (
    <div className="page-surface">
      <PageHeader icon={<Timer size={18} />} title="Focus" copy="Run a Pomodoro-style session, choose the alarm, and maintain rituals that protect work-life balance." />
      <div className="focus-workspace">
        <section className="focus-command desk-panel">
          <FocusReactor focus={focus} focusProgress={focusProgress} />
          <div className="focus-actions">
            <BorderGlow className="action-glow fill static-glow" colors={['#8b5cf6', '#c4b5fd', '#6b7280']} glowColor="260 72 72">
              <button type="button" className="primary-button" onClick={onToggleFocus}>
                {focus.running ? 'Pause focus' : 'Start focus'}
              </button>
            </BorderGlow>
            <button type="button" className="secondary-button" onClick={onResetFocus}>Reset</button>
          </div>
          <div className="focus-settings">
            <button type="button" className={`toggle-tile ${focus.alarmEnabled ? 'active' : ''}`} onClick={() => onFocusChange({ ...focus, alarmEnabled: !focus.alarmEnabled })}>
              {focus.alarmEnabled ? <Bell size={19} /> : <BellOff size={19} />}
              <span>{focus.alarmEnabled ? 'Alarm enabled' : 'Alarm muted'}</span>
            </button>
            <label className="form-field">
              <span>Sound</span>
              <select value={focus.alarmName} onChange={event => onFocusChange({ ...focus, alarmName: event.target.value })}>
                <option>Soft chime</option>
                <option>Deep pulse</option>
                <option>Clean bell</option>
              </select>
            </label>
            <label className="form-field">
              <span>Length</span>
              <input type="number" min="5" max="99" value={Math.round(focus.secondsLeft / 60)} onChange={event => onFocusChange({ ...focus, secondsLeft: Number(event.target.value) * 60, running: false })} />
            </label>
          </div>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<Sparkles size={17} />} title="Ritual engine" action={<button type="button" onClick={onShutdownNote}>Shutdown note</button>} />
          <form className="routine-compose" onSubmit={onCreateRoutine}>
            <label className="form-field">
              <span>Ritual</span>
              <input value={routineDraft.title} onChange={event => onRoutineDraftChange({ ...routineDraft, title: event.target.value })} placeholder="Add a ritual" />
            </label>
            <label className="form-field">
              <span>Cadence</span>
              <select value={routineDraft.cadence} onChange={event => onRoutineDraftChange({ ...routineDraft, cadence: event.target.value })}>
                <option>Morning</option>
                <option>Midday</option>
                <option>Evening</option>
                <option>Daily</option>
              </select>
            </label>
            <button type="submit"><Plus size={15} /></button>
          </form>
          <div className="ritual-stack editable">
            {routines.map(routine => (
              <EditableRoutine key={routine.id} routine={routine} onUpdate={onUpdateRoutine} onDelete={onDeleteRoutine} />
            ))}
          </div>
          <div className="ritual-actions">
            <button type="button" onClick={onProtectFocus}><Timer size={15} /> Schedule focus</button>
            <button type="button" onClick={onRecoveryBuffer}><Coffee size={15} /> Recovery buffer</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function GroupsPage({
  groups,
  groupMembers = [],
  activeGroup,
  activeGroupId,
  copiedGroupCode,
  leaderboard,
  leaderboardPeriod,
  leaderboardScope,
  groupDraft,
  groupNameDraft,
  joinCodeDraft,
  currentUser,
  onGroupDraftChange,
  onGroupNameDraftChange,
  onJoinCodeDraftChange,
  onActiveGroupChange,
  onCreateGroup,
  onJoinGroup,
  onRenameGroup,
  onDeleteGroup,
  onRegenerateInvite,
  onUpdateGroupMemberRole,
  onRemoveGroupMember,
  onLeaveGroup,
  onCopyGroupCode,
  onLeaderboardPeriodChange,
  onLeaderboardScopeChange
}) {
  const canLeaveActiveGroup = activeGroup && activeGroup.role !== 'owner';
  const activeCodeCopied = activeGroup && copiedGroupCode === activeGroup.joinCode;
  const visibleMembers = activeGroup && currentUser && !groupMembers.some(member => member.userId === currentUser.id)
    ? [
        {
          userId: currentUser.id,
          handle: currentUser.handle,
          displayName: currentUser.displayName,
          role: activeGroup.role,
          joinedAt: activeGroup.createdAt,
        },
        ...groupMembers,
      ]
    : groupMembers;
  const visibleLeaderboard = leaderboard;
  const groupLeaderboardLocked = leaderboardScope === 'group' && !activeGroup;
  const leaderboardEmptyTitle = groupLeaderboardLocked
    ? 'Join a group to unlock ranks'
    : leaderboardScope === 'group'
      ? 'No scored members yet'
      : 'No public ranks yet';
  const leaderboardEmptyCopy = groupLeaderboardLocked
    ? 'Create a crew or enter an invite code first. Group boards only show members of your selected crew.'
    : leaderboardScope === 'group'
      ? 'Members will appear here after validated tasks or focus sessions update their score.'
      : currentUser?.isGuest
        ? 'Guest sessions can use Orbit, but they stay out of public rankings.'
        : 'Complete scoreable work to appear on the global board.';

  return (
    <div className="page-surface groups-page">
      <PageHeader
        icon={<UsersRound size={18} />}
        title="Groups"
        copy="Create a lock-in crew, share the join code, and compete on validated task and focus scores."
      />
      <div className="groups-workspace">
        <section className="desk-panel group-command-panel">
          <SectionTitle icon={<Crown size={17} />} title="Your league" />
          <BorderGlow className="group-card-glow static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72">
            <div className="group-active-card">
              <div className="group-active-copy">
                <span>{activeGroup ? 'Active group' : 'No group yet'}</span>
                <strong>{activeGroup?.name ?? 'Create or join a crew'}</strong>
                <em>{activeGroup ? `${activeGroup.memberCount} member${activeGroup.memberCount === 1 ? '' : 's'} / code ${activeGroup.joinCode}` : 'Rankings unlock once you join a group.'}</em>
              </div>
              <div className="group-action-row">
                {activeGroup ? (
                  <button type="button" className="quiet-action" onClick={() => onCopyGroupCode(activeGroup.joinCode)}>
                    <Copy size={14} /> {activeCodeCopied ? 'Copied' : 'Copy code'}
                  </button>
                ) : null}
                {activeGroup?.canManage ? (
                  <button type="button" className="quiet-action" onClick={onRegenerateInvite}><KeyRound size={14} /> Regenerate code</button>
                ) : null}
                {activeGroup?.role === 'owner' ? (
                  <button type="button" className="quiet-action danger-quiet" onClick={onDeleteGroup}><Trash2 size={14} /> Delete group</button>
                ) : null}
                {canLeaveActiveGroup ? (
                  <button type="button" className="quiet-action danger-quiet" onClick={onLeaveGroup}><LogOut size={14} /> Leave group</button>
                ) : activeGroup ? (
                  <span className="owner-note"><ShieldCheck size={13} /> Owner</span>
                ) : null}
              </div>
            </div>
          </BorderGlow>
          {activeGroup?.canManage ? (
            <form className="group-manage-form" onSubmit={onRenameGroup}>
              <label>
                <span>Group name</span>
                <input value={groupNameDraft} onChange={event => onGroupNameDraftChange(event.target.value)} placeholder="Group name" />
              </label>
              <PrimaryAction icon={<Edit3 size={16} />} label="Save group" />
            </form>
          ) : null}
          <form className="group-form" onSubmit={onCreateGroup}>
            <label className="form-field">
              <span>New group</span>
              <input value={groupDraft} onChange={event => onGroupDraftChange(event.target.value)} placeholder="Crew name" />
            </label>
            <PrimaryAction icon={<Plus size={16} />} label="Create group" />
          </form>
          <form className="group-form" onSubmit={onJoinGroup}>
            <label className="form-field">
              <span>Invite code</span>
              <input value={joinCodeDraft} onChange={event => onJoinCodeDraftChange(event.target.value.toUpperCase())} placeholder="Paste code" />
            </label>
            <PrimaryAction icon={<KeyRound size={16} />} label="Join group" />
          </form>
          <div className="joined-groups">
            <SectionTitle icon={<UsersRound size={17} />} title="Joined groups" />
            {groups.map(group => (
              <article key={group.id} className={`joined-group-row ${group.id === activeGroupId ? 'active' : ''}`}>
                <button type="button" className="joined-group-main" onClick={() => onActiveGroupChange(group.id)}>
                  <span>
                    <strong>{group.name}</strong>
                    <em>{group.role} / {group.memberCount} member{group.memberCount === 1 ? '' : 's'}</em>
                  </span>
                </button>
                <button type="button" className="copy-code-button" onClick={() => onCopyGroupCode(group.joinCode)} aria-label={`Copy ${group.name} code`}>
                  <code>{copiedGroupCode === group.joinCode ? 'Copied' : group.joinCode}</code>
                  <Copy size={13} />
                </button>
              </article>
            ))}
            {!groups.length ? <p className="panel-note">Create a crew or paste a join code to get started.</p> : null}
          </div>
          <div className="member-list">
            <SectionTitle icon={<UsersRound size={17} />} title={`Members${activeGroup ? ` (${visibleMembers.length})` : ''}`} />
            {visibleMembers.length ? visibleMembers.map(member => (
              <article key={member.userId} className={`member-row ${member.userId === currentUser?.id ? 'self' : ''}`}>
                <CircleUserRound size={18} />
                <div>
                  <strong>{member.displayName || member.handle}</strong>
                  <span>@{member.handle} / {member.role}{member.userId === currentUser?.id ? ' / you' : ''}</span>
                </div>
                <div className="member-controls">
                  {activeGroup?.canManage && member.role !== 'owner' && member.userId !== currentUser?.id ? (
                    <>
                      <button
                        type="button"
                        className="quiet-action"
                        aria-label={member.role === 'admin' ? `Make ${member.displayName || member.handle} a member` : `Make ${member.displayName || member.handle} an admin`}
                        onClick={() => onUpdateGroupMemberRole(member.userId, member.role === 'admin' ? 'member' : 'admin')}
                      >
                        <ShieldCheck size={13} /> {member.role === 'admin' ? 'Member' : 'Admin'}
                      </button>
                      <button type="button" className="quiet-action danger-quiet" aria-label={`Remove ${member.displayName || member.handle}`} onClick={() => onRemoveGroupMember(member.userId)}><Trash2 size={13} /> Remove</button>
                    </>
                  ) : null}
                </div>
              </article>
            )) : (
              <p className="panel-note">Join or create a group to see the crew roster.</p>
            )}
          </div>
        </section>
        <section className="desk-panel leaderboard-panel">
          <div className="leaderboard-toolbar">
            <SectionTitle icon={<Trophy size={17} />} title="Leaderboard" />
            <BorderGlow className="leaderboard-control-glow static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72">
              <div className="leaderboard-controls">
                <label className="select-chip">
                  <span><UsersRound size={13} /> Board</span>
                  <select value={leaderboardScope} onChange={event => onLeaderboardScopeChange(event.target.value)}>
                    <option value="group">Group</option>
                    <option value="global">Global</option>
                  </select>
                </label>
                <label className="select-chip">
                  <span><Clock3 size={13} /> Period</span>
                  <select value={leaderboardPeriod} onChange={event => onLeaderboardPeriodChange(event.target.value)}>
                    {PERIODS.map(period => <option key={period} value={period}>{period}</option>)}
                  </select>
                </label>
              </div>
            </BorderGlow>
          </div>
          <div className="leaderboard-list">
            {visibleLeaderboard.length ? visibleLeaderboard.map(row => (
              <LeaderboardRow key={row.userId} row={row} active={row.userId === currentUser?.id} />
            )) : (
              <div className="leaderboard-empty-card">
                <UsersRound size={24} />
                <strong>{leaderboardEmptyTitle}</strong>
                <p>{leaderboardEmptyCopy}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScorePage({
  tasks,
  routines,
  todayEvents,
  suggestions,
  periodScore,
  scorePeriod,
  onScorePeriodChange,
  routineCompletion,
  focusGap,
  recoveryPressure,
  onProtectFocus,
  onRecoveryBuffer,
  onShutdownNote
}) {
  const openHigh = tasks.filter(task => !task.done && ['high', 'focus'].includes(String(task.priority).toLowerCase())).length;
  const validationReasons = periodScore.validationReasons?.length ? periodScore.validationReasons : ['Clean activity trail. No scoring penalties were applied.'];
  const whyChanged = periodScore.whyThisChanged?.length ? periodScore.whyThisChanged : [
    `Tasks contributed ${periodScore.taskPoints}/35 points.`,
    `Focus contributed ${periodScore.focusPoints}/45 points.`,
    `Consistency contributed ${periodScore.consistencyPoints}/20 points.`
  ];
  return (
    <div className="page-surface score-page">
      <PageHeader
        icon={<BarChart3 size={18} />}
        title="Score"
        copy="Backend-computed lock-in score with trust, caps, validation reasons, and a clear trail for leaderboard confidence."
        action={<PeriodSelect value={scorePeriod} onChange={onScorePeriodChange} />}
      />
      <div className="insight-workspace">
        <section className="desk-panel balance-panel">
          <BorderGlow className="score-glow static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72">
            <div className="balance-score" style={{ '--score': `${periodScore.score}%` }}>
              <strong>{periodScore.score}</strong>
              <span>Lock-in score</span>
            </div>
          </BorderGlow>
          <div className="balance-copy">
            <h3>{periodScore.trustLabel ?? (periodScore.validation === 'Clean' ? 'High trust' : periodScore.validation)}</h3>
            <p>{periodScore.validFocusMinutes} valid focus minutes / {periodScore.scoredTaskWeight ?? periodScore.completedTaskWeight} scored task weight. Validation: {periodScore.validation}.</p>
          </div>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<Gauge size={17} />} title="Score breakdown" />
          <div className="signal-grid">
            <InsightCard title="Task points" value={`${periodScore.taskPoints}/35`} copy={`${periodScore.scoredTaskWeight ?? 0} scored of ${periodScore.taskGoalWeight ?? 0} target weight`} />
            <InsightCard title="Focus points" value={`${periodScore.focusPoints}/45`} copy={`${periodScore.validFocusMinutes} of ${periodScore.focusGoalMinutes} goal minutes`} />
            <InsightCard title="Consistency" value={`${periodScore.consistencyPoints}/20`} copy="Clean bonus for real tasks plus validated focus" />
            <InsightCard title="Trust" value={`${periodScore.trustScore ?? 100}`} copy={`${periodScore.spamPenalty ?? 0} penalty / ${periodScore.suspiciousCount} flags`} />
          </div>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<ShieldAlert size={17} />} title="Validation trail" />
          <div className="score-reasons">
            {validationReasons.map(reason => <p key={reason}>{reason}</p>)}
          </div>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<Sparkles size={17} />} title="Why this changed" />
          <div className="score-reasons">
            {whyChanged.map(reason => <p key={reason}>{reason}</p>)}
          </div>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<ShieldAlert size={17} />} title="Operating signals" />
          <div className="signal-grid">
            <InsightCard title="Open priority" value={String(openHigh)} copy="High-focus tasks still open" />
            <InsightCard title="Calendar pressure" value={recoveryPressure} copy={`${todayEvents.length} blocks scheduled today`} />
            <InsightCard title="Focus gap" value={String(focusGap)} copy="Blocks left for daily goal" />
            <InsightCard title="Rituals" value={`${routineCompletion}%`} copy={`${routines.filter(item => item.done).length} of ${routines.length} done`} />
          </div>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<Zap size={17} />} title="Recommended moves" />
          <div className="balance-copy">
            <p>Actions here improve tomorrow's ranking only when the backend can validate them cleanly.</p>
          </div>
          <div className="recommendation-actions">
            <button type="button" onClick={onProtectFocus}><Timer size={15} /> Schedule focus</button>
            <button type="button" onClick={onRecoveryBuffer}><Coffee size={15} /> Add buffer</button>
            <button type="button" onClick={onShutdownNote}><MoonStar size={15} /> Shutdown note</button>
          </div>
          <AnimatedList items={suggestions} className="insight-suggestions" displayScrollbar={false} showGradients={false} renderItem={suggestion => <SuggestionRow suggestion={suggestion} />} />
        </section>
      </div>
    </div>
  );
}

function ProfilePage({ profile, currentUser, authInfo, sessionInfo, activeGroup, onProfileChange, onSaveProfile, onNavigate, onGoogleLogin, onLogout }) {
  const google = authInfo?.providers?.google;
  const googleAccount = authInfo?.accounts?.find(account => account.provider === 'google');
  return (
    <div className="page-surface">
      <PageHeader icon={<UserRound size={18} />} title="Profile" copy="Manage identity, connected Google account, active session, and group presence." />
      <div className="profile-workspace">
        <section className="login-hero desk-panel">
          <div className="login-strands">
            <Strands
              colors={STRAND_COLORS.dark}
              count={4}
              speed={0.22}
              amplitude={0.65}
              waviness={1.1}
              thickness={0.62}
              glow={2.4}
              spread={1.15}
              intensity={0.55}
              opacity={0.62}
              scale={1.08}
            />
          </div>
          <div className="login-copy">
            <span className="login-mark"><ShieldCheck size={20} /></span>
            <h2>{currentUser?.displayName ?? profile.name}</h2>
            <p>@{currentUser?.handle ?? profile.handle} / {activeGroup ? activeGroup.name : 'No active group yet'}</p>
            <div className="profile-action-row">
              <button type="button" onClick={() => onNavigate('Groups')}>Open groups</button>
              <button type="button" onClick={onLogout}><LogOut size={15} /> Logout</button>
            </div>
          </div>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<LogIn size={17} />} title="Google login" />
          <div className="oauth-status-card">
            <span>{google?.connected ? 'Connected' : google?.configured ? 'Ready to connect' : 'Not configured'}</span>
            <strong>{googleAccount?.email || 'Google OAuth'}</strong>
            <p>{google?.configured ? 'Use Google to verify identity and later power calendar sync.' : 'Add Google client credentials to .env, then restart the backend.'}</p>
            <button type="button" className="primary-button" onClick={onGoogleLogin}><LogIn size={15} /> {google?.connected ? 'Reconnect Google' : 'Connect Google'}</button>
          </div>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<CircleUserRound size={17} />} title="Identity" />
          <form className="profile-form" onSubmit={onSaveProfile}>
            <label className="form-field">
              <span>Display name</span>
              <input value={profile.name} onChange={event => onProfileChange({ ...profile, name: event.target.value })} placeholder="Name" />
            </label>
            <label className="form-field">
              <span>Handle</span>
              <input value={profile.handle} onChange={event => onProfileChange({ ...profile, handle: event.target.value })} placeholder="Handle" />
            </label>
            <label className="form-field">
              <span>Role</span>
              <input value={profile.role} onChange={event => onProfileChange({ ...profile, role: event.target.value })} placeholder="Student, founder, designer..." />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input value={profile.email} onChange={event => onProfileChange({ ...profile, email: event.target.value })} placeholder="Email" />
            </label>
            <label className="form-field">
              <span>Timezone</span>
              <input value={profile.timezone} onChange={event => onProfileChange({ ...profile, timezone: event.target.value })} placeholder="Asia/Calcutta" />
            </label>
            <label className="form-field">
              <span>Daily focus goal</span>
              <input type="number" min="1" max="16" value={profile.dailyFocusGoal} onChange={event => onProfileChange({ ...profile, dailyFocusGoal: Number(event.target.value) })} />
            </label>
            <PrimaryAction icon={<ShieldCheck size={16} />} label="Save profile" />
          </form>
        </section>
        <section className="desk-panel">
          <SectionTitle icon={<KeyRound size={17} />} title="Session" />
          <div className="session-card">
            <span>Secure access</span>
            <strong>{sessionInfo ? 'Session active' : 'Signed in'}</strong>
            <p>Protected cookie session. Expires {sessionInfo?.expiresAt ? new Date(sessionInfo.expiresAt).toLocaleDateString() : 'on schedule'}.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function TodayRail({ focus, focusProgress, activeStrands, suggestions, routines, onToggleFocus, onResetFocus, onUpdateRoutine, onProtectFocus, onRecoveryBuffer }) {
  return (
    <aside className="today-rail">
      <section className="focus-card glass-panel">
        <FocusReactor focus={focus} focusProgress={focusProgress} strands={activeStrands} />
        <div className="focus-actions">
          <BorderGlow className="action-glow fill static-glow" colors={['#8b5cf6', '#c4b5fd', '#6b7280']} glowColor="260 72 72">
            <button type="button" className="primary-button" onClick={onToggleFocus}>
              {focus.running ? 'Pause focus' : 'Start focus'}
            </button>
          </BorderGlow>
          <button type="button" className="secondary-button" onClick={onResetFocus}>Reset</button>
        </div>
      </section>
      <section className="suggestions-card glass-panel">
        <SectionTitle icon={<Zap size={17} />} title="Smart moves" />
        <AnimatedList items={suggestions} className="suggestion-list" displayScrollbar={false} showGradients={false} renderItem={suggestion => <SuggestionRow suggestion={suggestion} />} />
        <div className="rail-actions">
          <button type="button" onClick={onProtectFocus}>Schedule focus</button>
          <button type="button" onClick={onRecoveryBuffer}>Buffer</button>
        </div>
      </section>
      <section className="ritual-card glass-panel">
        <SectionTitle icon={<Sparkles size={17} />} title="Rituals" />
        <div className="ritual-stack">
          {routines.slice(0, 3).map(routine => (
            <RoutineRow key={routine.id} routine={routine} onToggle={() => onUpdateRoutine(routine.id, { done: !routine.done })} />
          ))}
        </div>
      </section>
    </aside>
  );
}

function FeatureGuide() {
  const items = [
    {
      icon: <Clock3 size={16} />,
      title: 'Time blocks',
      copy: 'Calendar events become planner rows so you see the day as protected attention, not a list.'
    },
    {
      icon: <Sparkles size={16} />,
      title: 'Rituals',
      copy: 'Morning, midday, and shutdown habits keep work from leaking into the rest of life.'
    },
    {
      icon: <Zap size={16} />,
      title: 'Smart moves',
      copy: 'Orbit suggests one practical next action: focus, recover, convert notes, or close the day.'
    }
  ];

  return (
    <div className="feature-guide">
      {items.map(item => (
        <article key={item.title}>
          <span>{item.icon}</span>
          <div>
            <strong>{item.title}</strong>
            <p>{item.copy}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function FocusReactor({ focus, focusProgress, strands = STRAND_COLORS.dark }) {
  return (
    <div className="focus-reactor" style={{ '--progress': `${focusProgress}%` }}>
      <BorderGlow
        className="reactor-border-glow static-glow"
        backgroundColor="transparent"
        borderRadius={999}
        glowRadius={30}
        glowIntensity={0.9}
        fillOpacity={0.14}
        colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']}
        glowColor="260 72 72"
      >
        <div className={`reactor-ring ${focus.running ? 'running' : ''}`}>
          <Strands
            colors={strands}
            count={3}
            speed={focus.running ? 0.45 : 0.16}
            amplitude={0.7}
            waviness={1.05}
            thickness={0.56}
            glow={2.2}
            spread={1}
            intensity={0.58}
            opacity={0.58}
            scale={1.06}
          />
          <div className="timer-face">
            <span>Deep work</span>
            <strong>{formatTime(focus.secondsLeft)}</strong>
          </div>
        </div>
      </BorderGlow>
    </div>
  );
}

function CalendarStat({ label, value }) {
  return (
    <div className="calendar-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CalendarDayCanvas({ events, selectedEventId, onSelectEvent }) {
  const laidOutEvents = layoutDayEvents(events);
  const daySpan = CALENDAR_END_MINUTES - CALENDAR_START_MINUTES;

  return (
    <div className="calendar-day-canvas">
      <div className="calendar-time-column" aria-hidden="true">
        {CALENDAR_HOURS.map(hour => (
          <span key={hour}>{`${hour.toString().padStart(2, '0')}:00`}</span>
        ))}
      </div>
      <div className="calendar-grid-field">
        <div className="calendar-grid-lines" aria-hidden="true">
          {CALENDAR_HOURS.map(hour => <span key={hour} />)}
        </div>
        <div className="calendar-event-layer">
          {laidOutEvents.map(({ event, start, end, column, columns }) => {
            const top = ((start - CALENDAR_START_MINUTES) / daySpan) * 100;
            const height = ((end - start) / daySpan) * 100;
            return (
              <button
                type="button"
                key={event.id}
                className={`calendar-block type-${event.type.toLowerCase()} ${selectedEventId === event.id ? 'selected' : ''}`}
                style={{
                  '--top': `${top}%`,
                  '--height': `${height}%`,
                  '--left': `${(column / columns) * 100}%`,
                  '--width': `${100 / columns}%`,
                  '--col': column,
                  '--cols': columns
                }}
                onClick={() => onSelectEvent?.(event.id)}
              >
                <span>{event.type}</span>
                <strong>{event.title}</strong>
                <em>{event.start}-{event.end} / {durationLabel(eventDurationMinutes(event))}</em>
              </button>
            );
          })}
          {!laidOutEvents.length ? (
            <div className="calendar-empty-block">
              <CalendarDays size={22} />
              <strong>No blocks today</strong>
              <span>Create a focus, recovery, or personal block from the right panel.</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlannerCanvas({ events, onNavigate }) {
  return (
    <div className="planner-canvas">
      {TIME_SLOTS.map(slot => {
        const slotEvents = events.filter(event => event.start.slice(0, 2) === slot.slice(0, 2));
        return (
          <button type="button" className="time-row" key={slot} onClick={() => onNavigate?.('Calendar')}>
            <span className="time-label">{slot}</span>
            <span className="time-track">
              {slotEvents.length ? slotEvents.map(event => (
                <span className={`event-chip type-${event.type.toLowerCase()}`} key={event.id}>
                  <strong>{event.title}</strong>
                  <em>{event.start}-{event.end}</em>
                </span>
              )) : <span className="empty-slot" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PageHeader({ icon, title, copy, action }) {
  return (
    <div className="page-header">
      <span className="page-icon">{icon}</span>
      <div>
        <h1>{title}</h1>
        {copy ? <p>{copy}</p> : null}
      </div>
      {action ? (
        <BorderGlow className="page-action-glow static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72" glowIntensity={0.58} fillOpacity={0.2}>
          <div className="page-action">{action}</div>
        </BorderGlow>
      ) : null}
    </div>
  );
}

function SectionTitle({ icon, title, action }) {
  return (
    <div className="section-title">
      <div>
        <span>{icon}</span>
        <h2>{title}</h2>
      </div>
      {action ?? null}
    </div>
  );
}

function PeriodSelect({ value, onChange }) {
  return (
    <BorderGlow className="period-select-glow static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72">
      <label className="period-select-shell">
        <span><Clock3 size={13} /> Period</span>
        <select className="period-select" value={value} onChange={event => onChange(event.target.value)}>
          {PERIODS.map(period => <option key={period} value={period}>{period}</option>)}
        </select>
      </label>
    </BorderGlow>
  );
}

function IconButton({ icon, label, onClick }) {
  return (
    <button type="button" className="mini-button" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function PrimaryAction({ icon, label }) {
  return (
    <BorderGlow className="action-glow primary-action-glow static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72">
      <button type="submit" className="primary-submit">
        {icon}
        {label}
      </button>
    </BorderGlow>
  );
}

function Metric({ icon, label, value, tone, onClick }) {
  const Component = onClick ? 'button' : 'div';
  return (
    <Component type={onClick ? 'button' : undefined} className={`metric-card tone-${tone}`} onClick={onClick}>
      <span className="metric-icon">{icon}</span>
      <span>
        <em>{label}</em>
        <strong>{value}</strong>
      </span>
    </Component>
  );
}

function TaskColumn({ title, count, children }) {
  return (
    <section className="task-column desk-panel">
      <SectionTitle icon={<Circle size={14} />} title={`${title} (${count})`} />
      <div className="editable-stack">{children}</div>
    </section>
  );
}

function EditableTask({ task, onToggle, onUpdate, onDelete }) {
  return (
    <article className={`editable-row accent-${task.accent} ${task.done ? 'done' : ''}`}>
      <button type="button" className="check-button" onClick={() => onToggle(task.id)} aria-label={`Toggle ${task.title}`}>
        <CheckCircle2 size={18} />
      </button>
      <input aria-label="Task title" value={task.title} onChange={event => onUpdate(task.id, { title: event.target.value })} />
      <input aria-label="Task context" value={task.meta} onChange={event => onUpdate(task.id, { meta: event.target.value })} />
      <input aria-label="Task due date" type="date" value={task.date || ''} onChange={event => onUpdate(task.id, { date: event.target.value })} />
      <select aria-label="Task priority" value={task.priority} onChange={event => onUpdate(task.id, { priority: event.target.value })}>
        <option>New</option>
        <option>High</option>
        <option>Focus</option>
        <option>Medium</option>
        <option>Low</option>
      </select>
      <button type="button" className="icon-danger" onClick={() => onDelete(task.id)}><Trash2 size={16} /></button>
    </article>
  );
}

function TaskRow({ task, onToggle }) {
  return (
    <div className={`task-row accent-${task.accent} ${task.done ? 'done' : ''}`}>
      <button type="button" className="check-button" onClick={event => { event.stopPropagation(); onToggle(); }} aria-label={`Mark ${task.title}`}>
        <CheckCircle2 size={18} />
      </button>
      <div className="task-main">
        <strong>{task.title}</strong>
        <span>{task.meta} / {task.time}</span>
      </div>
      <span className="priority-chip">{task.priority}</span>
    </div>
  );
}

function RoutineRow({ routine, onToggle }) {
  return (
    <button type="button" className={`routine-row ${routine.done ? 'done' : ''}`} onClick={onToggle}>
      <CheckCircle2 size={17} />
      <span>
        <strong>{routine.title}</strong>
        <em>{routine.cadence} / {routine.anchor}</em>
      </span>
    </button>
  );
}

function LeaderboardRow({ row, active }) {
  return (
    <BorderGlow
      className={`leaderboard-row-glow static-glow ${active ? 'active' : ''}`}
      colors={active ? ['#8dd8c8', '#c4b5fd', '#8b5cf6'] : ['#8b5cf6', '#c4b5fd', '#6b7280']}
      glowColor={active ? '166 55 70' : '260 72 72'}
      glowIntensity={active ? 0.9 : 0.48}
      fillOpacity={active ? 0.34 : 0.2}
    >
      <article className={`leaderboard-row ${active ? 'active' : ''}`}>
        <span className="rank-badge">#{row.rank}</span>
        <div>
          <strong>{row.displayName || row.handle}</strong>
          <em>@{row.handle} / {row.validation}</em>
        </div>
        <div className="leaderboard-score">
          <strong>{row.score}</strong>
          <span>{row.validFocusMinutes}m / {row.scoredTaskWeight ?? row.completedTaskWeight}w</span>
        </div>
      </article>
    </BorderGlow>
  );
}

function EditableRoutine({ routine, onUpdate, onDelete }) {
  return (
    <article className={`editable-routine ${routine.done ? 'done' : ''}`}>
      <button type="button" className="check-button" onClick={() => onUpdate(routine.id, { done: !routine.done })}><CheckCircle2 size={17} /></button>
      <input aria-label="Routine title" value={routine.title} onChange={event => onUpdate(routine.id, { title: event.target.value })} />
      <input aria-label="Routine anchor" value={routine.anchor} onChange={event => onUpdate(routine.id, { anchor: event.target.value })} />
      <select aria-label="Routine cadence" value={routine.cadence} onChange={event => onUpdate(routine.id, { cadence: event.target.value })}>
        <option>Morning</option>
        <option>Midday</option>
        <option>Evening</option>
        <option>Daily</option>
      </select>
      <button type="button" className="icon-danger" onClick={() => onDelete(routine.id)}><Trash2 size={16} /></button>
    </article>
  );
}

function EditableEvent({ event, selected, onUpdate, onDelete }) {
  return (
    <article className={`event-editor type-${event.type.toLowerCase()} ${selected ? 'selected' : ''}`}>
      <input aria-label="Event title" value={event.title} onChange={change => onUpdate(event.id, { title: change.target.value })} />
      <input aria-label="Event date" type="date" value={event.date} onChange={change => onUpdate(event.id, { date: change.target.value })} />
      <input aria-label="Event start time" type="time" value={event.start} onChange={change => onUpdate(event.id, { start: change.target.value })} />
      <input aria-label="Event end time" type="time" value={event.end} onChange={change => onUpdate(event.id, { end: change.target.value })} />
      <select aria-label="Event type" value={event.type} onChange={change => onUpdate(event.id, { type: change.target.value })}>
        {EVENT_TYPES.map(type => <option key={type}>{type}</option>)}
      </select>
      <button type="button" className="icon-danger" onClick={() => onDelete(event.id)}><Trash2 size={16} /></button>
      <textarea aria-label="Event notes" value={event.notes} onChange={change => onUpdate(event.id, { notes: change.target.value })} placeholder="Notes" />
    </article>
  );
}

function NoteIndexRow({ note, active }) {
  return (
    <div className={`note-index-row ${active ? 'active' : ''}`}>
      <span>{note.tag}</span>
      <strong>{note.title}</strong>
      <p>{note.body || 'No body yet'}</p>
    </div>
  );
}

function NoteMini({ note }) {
  return (
    <article className="note-mini">
      <span>{note.tag}</span>
      <strong>{note.title}</strong>
      <p>{note.body || 'Empty note'}</p>
    </article>
  );
}

function SuggestionRow({ suggestion }) {
  return (
    <div className="suggestion-row">
      <div>
        <strong>{suggestion.title}</strong>
        <span>{suggestion.meta}</span>
      </div>
      <em>{suggestion.signal}</em>
    </div>
  );
}

function InsightCard({ title, value, copy }) {
  return (
    <BorderGlow className="insight-card-glow static-glow" colors={['#8b5cf6', '#c4b5fd', '#8dd8c8']} glowColor="260 72 72" glowIntensity={0.52} fillOpacity={0.2}>
      <div className="insight-card">
        <span>{title}</span>
        <strong>{value}</strong>
        <p>{copy}</p>
      </div>
    </BorderGlow>
  );
}

function EmptyState({ icon, title, copy }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function LoadingOverlay({ title, subtitle, colors }) {
  return (
    <div className="loading-overlay">
      <div className="loading-strands">
        <Strands
          colors={colors}
          count={4}
          speed={0.34}
          amplitude={0.8}
          waviness={1.2}
          thickness={0.62}
          glow={2.5}
          taper={2.4}
          spread={1.18}
          intensity={0.56}
          saturation={1.12}
          opacity={0.72}
          scale={1.12}
        />
      </div>
      <div className="loading-panel">
        <Command size={24} />
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

function playFocusAlarm() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.14);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.55);
  } catch {
    // Browsers may block audio until the user interacts.
  }
}
