import { normalizeState } from '../shared/orbitState.mjs';

const API_ROOT = import.meta.env.VITE_API_ROOT ?? '';
const CSRF_COOKIE = 'orbit_csrf';

export function getStoredUserId() {
  return '';
}

export function setStoredUserId(userId) {
  return userId;
}

function readCookie(name) {
  return document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? '';
}

let mutationQueue = Promise.resolve();

function request(path, options = {}) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method ?? 'GET').toUpperCase())) {
    const result = mutationQueue.then(() => performRequest(path, options));
    mutationQueue = result.catch(() => undefined);
    return result;
  }
  return performRequest(path, options);
}

async function performRequest(path, options = {}) {
  const method = String(options.method ?? 'GET').toUpperCase();
  const csrf = readCookie(CSRF_COOKIE);
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'X-Orbit-CSRF': decodeURIComponent(csrf) } : {}),
    ...options.headers
  };
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      credentials: 'include',
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(30000)
    });
  } catch (error) {
    window.dispatchEvent(new CustomEvent('orbit:request-error', { detail: { status: 0, message: 'Orbit could not reach the server. Your latest changes may not have saved. Please try again.' } }));
    throw error;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    let message = body || `Request failed with ${response.status}`;
    try {
      const parsed = JSON.parse(body);
      message = Array.isArray(parsed.detail) ? parsed.detail.map(item => item.msg).join('. ') : (parsed.detail || message);
    } catch {
      // Keep response text as-is.
    }
    const error = new Error(message);
    error.status = response.status;
    if (!(response.status === 401 && path === '/api/users/me')) window.dispatchEvent(new CustomEvent('orbit:request-error', { detail: { status: response.status, message } }));
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function startGuestSession() {
  const payload = await request('/api/auth/guest', { method: 'POST' });
  return {
    user: payload.user,
    state: normalizeState(payload.state),
    scores: payload.scores,
    groups: payload.groups ?? [],
    auth: payload.auth ?? {},
    session: payload.session ?? null
  };
}

export async function getCurrentUser() {
  const payload = await request('/api/users/me');
  return {
    user: payload.user,
    state: normalizeState(payload.state),
    scores: payload.scores,
    groups: payload.groups ?? [],
    auth: payload.auth ?? {},
    session: payload.session ?? null
  };
}

export async function logoutSession() {
  await request('/api/auth/logout', { method: 'POST' });
}

export async function getGoogleAuthStatus() {
  return request('/api/auth/google/status');
}

export function startGoogleLogin(redirect = window.location.pathname || '/') {
  window.location.href = `${API_ROOT}/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
}

export async function patchUser(updates) {
  const payload = await request('/api/users/me', {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return payload.user;
}

export async function getOrbitState() {
  const payload = await request('/api/state');
  return normalizeState(payload.state ?? payload);
}

export async function createTask(title, task) {
  const payload = await request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, ...(task ? { task } : {}) })
  });
  return normalizeState(payload.state);
}

export async function patchTask(taskId, updates) {
  const payload = await request(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return normalizeState(payload.state);
}

export async function deleteTask(taskId) {
  const payload = await request(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE'
  });
  return normalizeState(payload.state);
}

export async function createNote(note) {
  const payload = await request('/api/notes', {
    method: 'POST',
    body: JSON.stringify(note)
  });
  return normalizeState(payload.state);
}

export async function patchNote(noteId, updates, keepalive = false) {
  const payload = await request(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
    keepalive
  });
  return normalizeState(payload.state);
}

export async function deleteNote(noteId) {
  const payload = await request(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE'
  });
  return normalizeState(payload.state);
}

export async function createRoutine(routine) {
  const payload = await request('/api/routines', {
    method: 'POST',
    body: JSON.stringify(routine)
  });
  return normalizeState(payload.state);
}

export async function patchRoutine(routineId, updates) {
  const payload = await request(`/api/routines/${encodeURIComponent(routineId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return normalizeState(payload.state);
}

export async function deleteRoutine(routineId) {
  const payload = await request(`/api/routines/${encodeURIComponent(routineId)}`, {
    method: 'DELETE'
  });
  return normalizeState(payload.state);
}

export async function createEvent(event) {
  const payload = await request('/api/calendar/events', {
    method: 'POST',
    body: JSON.stringify(event)
  });
  return normalizeState(payload.state);
}

export async function patchEvent(eventId, updates) {
  const payload = await request(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return normalizeState(payload.state);
}

export async function deleteEvent(eventId) {
  const payload = await request(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE'
  });
  return normalizeState(payload.state);
}

export async function patchFocus(updates) {
  const payload = await request('/api/focus', {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return normalizeState(payload.state);
}

export async function resetFocusTimer() {
  const payload = await request('/api/focus/reset', { method: 'POST' });
  return normalizeState(payload.state);
}

export async function startFocusSession() {
  const payload = await request('/api/focus/sessions/start', { method: 'POST' });
  return { session: payload.session, state: normalizeState(payload.state) };
}

export async function completeFocusSession(sessionId) {
  const suffix = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  const payload = await request(`/api/focus/sessions/complete${suffix}`, { method: 'POST' });
  return { session: payload.session, state: normalizeState(payload.state) };
}

export async function patchPreferences(updates) {
  const payload = await request('/api/preferences', {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return normalizeState(payload.state);
}

export async function patchProfile(updates) {
  const payload = await request('/api/profile', {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return normalizeState(payload.state);
}

export async function patchIntegration(integrationId, updates) {
  const payload = await request(`/api/integrations/${encodeURIComponent(integrationId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return normalizeState(payload.state);
}

export async function getSuggestions() {
  const payload = await request('/api/suggestions');
  return payload.suggestions ?? [];
}

export async function getScoreSummary() {
  const payload = await request('/api/scores/summary');
  return payload.scores;
}

export async function getMyScore(period = 'day') {
  const payload = await request(`/api/scores/me?period=${encodeURIComponent(period)}`);
  return payload.score;
}

export async function getGroups() {
  const payload = await request('/api/groups');
  return payload.groups ?? [];
}

export async function createGroup(name) {
  const payload = await request('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  return { group: payload.group, groups: payload.groups ?? [] };
}

export async function joinGroup(joinCode) {
  const payload = await request('/api/groups/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode })
  });
  return { group: payload.group, groups: payload.groups ?? [] };
}

export async function patchGroup(groupId, updates) {
  const payload = await request(`/api/groups/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return { group: payload.group, groups: payload.groups ?? [] };
}

export async function deleteGroup(groupId) {
  const payload = await request(`/api/groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE'
  });
  return { groups: payload.groups ?? [] };
}

export async function regenerateGroupInvite(groupId) {
  const payload = await request(`/api/groups/${encodeURIComponent(groupId)}/invite/regenerate`, { method: 'POST' });
  return { group: payload.group, groups: payload.groups ?? [] };
}

export async function getGroupMembers(groupId) {
  const payload = await request(`/api/groups/${encodeURIComponent(groupId)}/members`);
  return payload.members ?? [];
}

export async function updateGroupMember(groupId, memberUserId, role) {
  const payload = await request(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberUserId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ role })
  });
  return payload.members ?? [];
}

export async function removeGroupMember(groupId, memberUserId) {
  const payload = await request(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberUserId)}`, {
    method: 'DELETE'
  });
  return { members: payload.members ?? [], groups: payload.groups ?? [] };
}

export async function getGroupLeaderboard(groupId, period = 'day') {
  const payload = await request(`/api/groups/${encodeURIComponent(groupId)}/leaderboard?period=${encodeURIComponent(period)}`);
  return payload.leaderboard ?? [];
}

export async function getGlobalLeaderboard(period = 'day') {
  const payload = await request(`/api/leaderboard/global?period=${encodeURIComponent(period)}`);
  return payload.leaderboard ?? [];
}
