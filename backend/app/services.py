from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from typing import Any

from fastapi import HTTPException

from .models import (
    AuthHandleCreate,
    EventCreate,
    EventPatch,
    FocusPatch,
    GroupCreate,
    GroupJoin,
    GroupMemberPatch,
    GroupPatch,
    IntegrationPatch,
    Note,
    NoteCreate,
    NotePatch,
    OrbitState,
    PreferencesPatch,
    ProfilePatch,
    RoutineCreate,
    RoutinePatch,
    SearchResults,
    Task,
    TaskCreate,
    TaskPatch,
    UserPatch,
    captured_task,
    model_to_dict,
    normalize_focus,
    normalize_event,
    normalize_integration,
    normalize_note,
    normalize_profile,
    normalize_routine,
    normalize_state,
    normalize_task,
)


@dataclass
class OrbitService:
    store: Any

    def state(self, user_id: str | None = None) -> OrbitState:
        return self.store.read(user_id)

    def replace_state(self, state: OrbitState | dict[str, Any], user_id: str | None = None) -> OrbitState:
        return self.store.write(normalize_state(model_to_dict(state) if hasattr(state, "dict") else state), user_id)

    def create_task(self, payload: TaskCreate, user_id: str | None = None) -> tuple[Task, OrbitState]:
        task = payload.task or captured_task(payload.title or "")
        task = normalize_task(task)
        if not task:
            raise HTTPException(status_code=400, detail="Task title is required")
        task.id = self.store.new_id("tsk")
        task.createdAt = date.today().isoformat()

        def update(state: OrbitState) -> OrbitState:
            state.tasks = [task, *state.tasks]
            return state

        state = self.store.update(update, user_id)
        user = self.store.user(user_id)
        self.store.score_breakdown(user["id"], "day")
        return task, state

    def patch_task(self, task_id: str, payload: TaskPatch, user_id: str | None = None) -> OrbitState:
        updates = patch_payload(payload)
        if not updates:
            return self.state(user_id)

        def update(state: OrbitState) -> OrbitState:
            changed = False
            next_tasks = []
            for task in state.tasks:
                if task.id != task_id:
                    next_tasks.append(task)
                    continue
                next_values = {**model_to_dict(task), **updates, "id": task.id}
                if updates.get("done") is True and not task.done:
                    next_values["completedAt"] = date.today().isoformat()
                if updates.get("done") is False:
                    next_values["completedAt"] = ""
                patched = normalize_task(next_values)
                if patched:
                    next_tasks.append(patched)
                    changed = True
                    if updates.get("done") is True and not task.done:
                        user = self.store.user(user_id)
                        self.store.log_activity(user["id"], "task_completed", task.id, {"priority": task.priority})
            if not changed:
                raise HTTPException(status_code=404, detail="Task not found")
            state.tasks = next_tasks
            return state

        state = self.store.update(update, user_id)
        user = self.store.user(user_id)
        self.store.score_breakdown(user["id"], "day")
        return state

    def delete_task(self, task_id: str, user_id: str | None = None) -> OrbitState:
        def update(state: OrbitState) -> OrbitState:
            next_tasks = [task for task in state.tasks if task.id != task_id]
            if len(next_tasks) == len(state.tasks):
                raise HTTPException(status_code=404, detail="Task not found")
            state.tasks = next_tasks
            return state

        state = self.store.update(update, user_id)
        user = self.store.user(user_id)
        self.store.score_breakdown(user["id"], "day")
        return state

    def create_note(self, payload: NoteCreate, user_id: str | None = None) -> tuple[Note, OrbitState]:
        note = normalize_note({"id": self.store.new_id("not"), **model_to_dict(payload)})
        if not note:
            raise HTTPException(status_code=400, detail="Note title is required")

        def update(state: OrbitState) -> OrbitState:
            state.notes = [note, *state.notes]
            return state

        return note, self.store.update(update, user_id)

    def patch_note(self, note_id: str, payload: NotePatch, user_id: str | None = None) -> OrbitState:
        updates = patch_payload(payload)
        if not updates:
            return self.state(user_id)

        def update(state: OrbitState) -> OrbitState:
            changed = False
            next_notes = []
            for note in state.notes:
                if note.id != note_id:
                    next_notes.append(note)
                    continue
                patched = normalize_note({**model_to_dict(note), **updates, "id": note.id})
                if patched:
                    next_notes.append(patched)
                    changed = True
            if not changed:
                raise HTTPException(status_code=404, detail="Note not found")
            state.notes = next_notes
            return state

        return self.store.update(update, user_id)

    def delete_note(self, note_id: str, user_id: str | None = None) -> OrbitState:
        def update(state: OrbitState) -> OrbitState:
            next_notes = [note for note in state.notes if note.id != note_id]
            if len(next_notes) == len(state.notes):
                raise HTTPException(status_code=404, detail="Note not found")
            state.notes = next_notes
            return state

        return self.store.update(update, user_id)

    def create_routine(self, payload: RoutineCreate, user_id: str | None = None) -> OrbitState:
        routine = normalize_routine({"id": self.store.new_id("rtn"), **model_to_dict(payload)})
        if not routine:
            raise HTTPException(status_code=400, detail="Routine title is required")

        def update(state: OrbitState) -> OrbitState:
            state.routines = [*state.routines, routine]
            return state

        return self.store.update(update, user_id)

    def patch_routine(self, routine_id: str, payload: RoutinePatch, user_id: str | None = None) -> OrbitState:
        updates = patch_payload(payload)
        if not updates:
            return self.state(user_id)

        def update(state: OrbitState) -> OrbitState:
            changed = False
            next_routines = []
            for routine in state.routines:
                if routine.id != routine_id:
                    next_routines.append(routine)
                    continue
                patched = normalize_routine({**model_to_dict(routine), **updates, "id": routine.id})
                if patched:
                    next_routines.append(patched)
                    changed = True
            if not changed:
                raise HTTPException(status_code=404, detail="Routine not found")
            state.routines = next_routines
            return state

        return self.store.update(update, user_id)

    def delete_routine(self, routine_id: str, user_id: str | None = None) -> OrbitState:
        def update(state: OrbitState) -> OrbitState:
            next_routines = [routine for routine in state.routines if routine.id != routine_id]
            if len(next_routines) == len(state.routines):
                raise HTTPException(status_code=404, detail="Routine not found")
            state.routines = next_routines
            return state

        return self.store.update(update, user_id)

    def create_event(self, payload: EventCreate, user_id: str | None = None) -> OrbitState:
        event = normalize_event({"id": self.store.new_id("evt"), **model_to_dict(payload)})
        if not event:
            raise HTTPException(status_code=400, detail="Event title and date are required")
        validate_event(event)

        def update(state: OrbitState) -> OrbitState:
            state.events = sorted([*state.events, event], key=lambda item: (item.date, item.start))
            return state

        return self.store.update(update, user_id)

    def patch_event(self, event_id: str, payload: EventPatch, user_id: str | None = None) -> OrbitState:
        updates = patch_payload(payload)
        if not updates:
            return self.state(user_id)

        def update(state: OrbitState) -> OrbitState:
            changed = False
            next_events = []
            for event in state.events:
                if event.id != event_id:
                    next_events.append(event)
                    continue
                patched = normalize_event({**model_to_dict(event), **updates, "id": event.id})
                if patched:
                    validate_event(patched)
                    next_events.append(patched)
                    changed = True
            if not changed:
                raise HTTPException(status_code=404, detail="Event not found")
            state.events = sorted(next_events, key=lambda item: (item.date, item.start))
            return state

        return self.store.update(update, user_id)

    def delete_event(self, event_id: str, user_id: str | None = None) -> OrbitState:
        def update(state: OrbitState) -> OrbitState:
            next_events = [event for event in state.events if event.id != event_id]
            if len(next_events) == len(state.events):
                raise HTTPException(status_code=404, detail="Event not found")
            state.events = next_events
            return state

        return self.store.update(update, user_id)

    def patch_focus(self, payload: FocusPatch, user_id: str | None = None) -> OrbitState:
        updates = patch_payload(payload)
        if updates.get("running") is False:
            return self.store.pause_focus(user_id, updates)

        def update(state: OrbitState) -> OrbitState:
            state.focus = normalize_focus({**model_to_dict(state.focus), **updates})
            return state

        return self.store.update(update, user_id)

    def reset_focus(self, user_id: str | None = None) -> OrbitState:
        return self.store.reset_focus(user_id)

    def patch_preferences(self, payload: PreferencesPatch, user_id: str | None = None) -> OrbitState:
        updates = patch_payload(payload)

        def update(state: OrbitState) -> OrbitState:
            if "theme" in updates:
                state.theme = updates["theme"]
            if "activeView" in updates:
                state.activeView = updates["activeView"]
            return state

        return self.store.update(update, user_id)

    def patch_profile(self, payload: ProfilePatch, user_id: str | None = None) -> OrbitState:
        updates = patch_payload(payload)

        def update(state: OrbitState) -> OrbitState:
            state.profile = normalize_profile({**model_to_dict(state.profile), **updates})
            return state

        return self.store.update(update, user_id)

    def patch_integration(self, integration_id: str, payload: IntegrationPatch, user_id: str | None = None) -> OrbitState:
        updates = patch_payload(payload)

        def update(state: OrbitState) -> OrbitState:
            changed = False
            next_integrations = []
            for integration in state.integrations:
                if integration.id != integration_id:
                    next_integrations.append(integration)
                    continue
                patched = normalize_integration({**model_to_dict(integration), **updates, "id": integration.id})
                if patched:
                    next_integrations.append(patched)
                    changed = True
            if not changed:
                raise HTTPException(status_code=404, detail="Integration not found")
            state.integrations = next_integrations
            return state

        return self.store.update(update, user_id)

    def auth_handle(self, payload: AuthHandleCreate) -> dict[str, Any]:
        handle = payload.handle.strip()
        if not handle:
            raise HTTPException(status_code=400, detail="Handle is required")
        return self.store.auth_handle(handle, payload.displayName, payload.timezone)

    def auth_guest(self) -> dict[str, Any]:
        return self.store.auth_guest()

    def user(self, user_id: str | None = None) -> dict[str, Any]:
        return self.store.user(user_id)

    def patch_user(self, payload: UserPatch, user_id: str | None = None) -> dict[str, Any]:
        return self.store.patch_user(user_id, patch_payload(payload))

    def create_session(self, user_id: str, user_agent: str = "", ip_address: str = "") -> dict[str, Any]:
        return self.store.create_session(user_id, user_agent, ip_address)

    def session_user(self, token: str | None, user_agent: str = "", ip_address: str = "") -> dict[str, Any] | None:
        return self.store.session_user(token, user_agent, ip_address)

    def revoke_session(self, token: str | None) -> None:
        self.store.revoke_session(token)

    def auth_status(self, user_id: str) -> dict[str, Any]:
        return self.store.auth_status(user_id)

    def begin_google_oauth(self, redirect_to: str = "/", guest_user_id: str = "") -> dict[str, Any]:
        return self.store.begin_google_oauth(redirect_to, guest_user_id)

    def complete_google_oauth(self, state: str, code: str, user_agent: str = "", ip_address: str = "") -> dict[str, Any]:
        return self.store.complete_google_oauth(state, code, user_agent, ip_address)

    def create_group(self, payload: GroupCreate, user_id: str | None = None) -> dict[str, Any]:
        try:
            return self.store.create_group(user_id, payload.name)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    def join_group(self, payload: GroupJoin, user_id: str | None = None) -> dict[str, Any]:
        try:
            return self.store.join_group(user_id, payload.joinCode)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    def groups(self, user_id: str | None = None) -> list[dict[str, Any]]:
        return self.store.groups_for_user(user_id)

    def patch_group(self, group_id: str, payload: GroupPatch, user_id: str | None = None) -> dict[str, Any]:
        return self.store.patch_group(group_id, user_id, payload.name)

    def delete_group(self, group_id: str, user_id: str | None = None) -> None:
        self.store.delete_group(group_id, user_id)

    def regenerate_group_invite(self, group_id: str, user_id: str | None = None) -> dict[str, Any]:
        return self.store.regenerate_group_invite(group_id, user_id)

    def group_members(self, group_id: str, user_id: str | None = None) -> list[dict[str, Any]]:
        return self.store.group_members(group_id, user_id)

    def update_group_member_role(self, group_id: str, member_user_id: str, payload: GroupMemberPatch, user_id: str | None = None) -> list[dict[str, Any]]:
        return self.store.update_group_member_role(group_id, user_id, member_user_id, payload.role)

    def remove_group_member(self, group_id: str, member_user_id: str, user_id: str | None = None) -> list[dict[str, Any]]:
        return self.store.remove_group_member(group_id, user_id, member_user_id)

    def leaderboard(self, period: str = "day", group_id: str | None = None, viewer_user_id: str | None = None) -> list[dict[str, Any]]:
        return self.store.leaderboard(period, group_id, viewer_user_id)

    def score_summary(self, user_id: str | None = None) -> dict[str, Any]:
        return self.store.score_summary(user_id)

    def score(self, period: str = "day", user_id: str | None = None) -> dict[str, Any]:
        user = self.store.user(user_id)
        return self.store.score_breakdown(user["id"], period)

    def start_focus_session(self, user_id: str | None = None) -> dict[str, Any]:
        state = self.state(user_id)
        planned_minutes = max(round(state.focus.secondsLeft / 60), 5)
        session = self.store.start_focus_session(user_id, planned_minutes)
        return {"session": session, "state": self.state(user_id)}

    def complete_focus_session(self, user_id: str | None = None, session_id: str | None = None) -> dict[str, Any]:
        result = self.store.complete_focus_session(user_id, session_id)
        return {"session": result.get("session"), "state": normalize_state(result.get("state"))}

    def suggestions(self, user_id: str | None = None) -> list[dict[str, str]]:
        state = self.state(user_id)
        open_tasks = [task for task in state.tasks if not task.done]
        high_priority = next((task for task in open_tasks if task.priority.lower() in {"high", "focus"}), None)
        note_count = len(state.notes)
        open_routines = [routine for routine in state.routines if not routine.done]
        today = date.today().isoformat()
        today_events = [event for event in state.events if event.date == today] if today else []
        focus_gap = max(state.profile.dailyFocusGoal - state.focus.completed, 0)

        suggestions = []
        if high_priority:
            suggestions.append(
                {
                    "id": "sug-focus-task",
                    "title": f"Start with {high_priority.title}",
                    "meta": "Highest leverage open item",
                    "signal": "Now",
                }
            )
        if state.focus.secondsLeft >= 20 * 60:
            suggestions.append(
                {
                    "id": "sug-focus-block",
                    "title": "Use the full focus block before switching context",
                    "meta": "Timer is ready for deep work",
                    "signal": "25m",
                }
            )
        if len(today_events) >= 4:
            suggestions.append(
                {
                    "id": "sug-break-buffer",
                    "title": "Add a recovery buffer between meetings",
                    "meta": f"{len(today_events)} scheduled blocks can drain context fast",
                    "signal": "10m",
                }
            )
        if focus_gap:
            suggestions.append(
                {
                    "id": "sug-focus-goal",
                    "title": "Protect one more deep-work block",
                    "meta": f"{focus_gap} block{'s' if focus_gap != 1 else ''} left for your daily goal",
                    "signal": "Goal",
                }
            )
        next_routine = open_routines[0] if open_routines else None
        if next_routine:
            suggestions.append(
                {
                    "id": "sug-routine",
                    "title": next_routine.title,
                    "meta": f"{next_routine.cadence} ritual / {next_routine.anchor}",
                    "signal": "Ritual",
                }
            )
        suggestions.append(
            {
                "id": "sug-notes",
                "title": "Turn recent notes into concrete next actions",
                "meta": f"{note_count} notes ready to mine",
                "signal": "Later",
            }
        )
        suggestions.append(
            {
                "id": "sug-shutdown",
                "title": "Close with a shutdown note",
                "meta": "Pick tomorrow's first task before logging off",
                "signal": "End",
            }
        )
        return suggestions[:3]

    def search(self, query: str, user_id: str | None = None) -> SearchResults:
        needle = query.strip().lower()
        state = self.state(user_id)
        suggestions = self.suggestions(user_id)
        if not needle:
            return SearchResults(
                tasks=state.tasks,
                notes=state.notes,
                events=state.events,
                routines=state.routines,
                suggestions=suggestions,
            )

        return SearchResults(
            tasks=[
                task
                for task in state.tasks
                if needle in f"{task.title} {task.meta} {task.priority}".lower()
            ],
            notes=[
                note
                for note in state.notes
                if needle in f"{note.title} {note.body} {note.tag}".lower()
            ],
            events=[
                event
                for event in state.events
                if needle in f"{event.title} {event.date} {event.start} {event.type} {event.notes}".lower()
            ],
            routines=[
                routine
                for routine in state.routines
                if needle in f"{routine.title} {routine.cadence} {routine.anchor}".lower()
            ],
            suggestions=[
                item
                for item in suggestions
                if needle in f"{item['title']} {item['meta']} {item['signal']}".lower()
            ],
        )


def patch_payload(model: Any) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=True)
    return model.dict(exclude_unset=True)


def validate_event(event) -> None:
    try:
        date.fromisoformat(event.date)
        start = time.fromisoformat(event.start)
        end = time.fromisoformat(event.end)
        if end <= start:
            raise ValueError("end before start")
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Choose a valid date and an end time after the start time.") from error


def unique_id(prefix: str, existing: list[str]) -> str:
    existing_set = set(existing)
    index = len(existing_set) + 1
    candidate = f"{prefix}-{index}"
    while candidate in existing_set:
        index += 1
        candidate = f"{prefix}-{index}"
    return candidate
