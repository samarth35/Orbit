from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


Theme = Literal["dark", "light"]
View = Literal["Today", "Tasks", "Notes", "Focus", "Calendar", "Groups", "Score", "Profile"]

VIEW_LABELS = ["Today", "Tasks", "Notes", "Focus", "Calendar", "Groups", "Score", "Profile"]
ALLOWED_ACCENTS = {"coral", "mint", "violet", "slate", "silver", "amber", "cyan"}


class Task(BaseModel):
    id: str
    title: str
    meta: str = "Quick capture"
    time: str = ""
    date: str = ""
    priority: str = "New"
    accent: str = "violet"
    done: bool = False
    createdAt: str = ""
    completedAt: str = ""


class Note(BaseModel):
    id: str
    title: str
    body: str = ""
    tag: str = "Note"


class Routine(BaseModel):
    id: str
    title: str
    cadence: str = "Daily"
    anchor: str = "Anytime"
    done: bool = False


class FocusState(BaseModel):
    running: bool = False
    secondsLeft: int = Field(default=25 * 60, ge=0, le=99 * 60)
    completed: int = Field(default=2, ge=0)
    alarmEnabled: bool = True
    alarmName: str = "Soft chime"
    activeSessionId: str = ""
    deadlineAt: int = 0


class CalendarEvent(BaseModel):
    id: str
    title: str
    date: str
    start: str = "09:00"
    end: str = "09:30"
    type: str = "Focus"
    linkedTaskId: str = ""
    notes: str = ""


class Profile(BaseModel):
    name: str = "Samarth Mishra"
    handle: str = "samarth"
    role: str = "Builder"
    email: str = ""
    timezone: str = "Asia/Calcutta"
    avatar: str = ""
    dailyFocusGoal: int = Field(default=4, ge=1, le=16)


class Integration(BaseModel):
    id: str
    provider: str
    label: str
    status: Literal["not_configured", "configured", "connected"] = "not_configured"
    clientId: str = ""
    redirectUri: str = ""
    scopes: str = ""
    lastSync: str = ""


class OrbitState(BaseModel):
    theme: Theme = "dark"
    activeView: View = "Today"
    tasks: list[Task] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    routines: list[Routine] = Field(default_factory=list)
    events: list[CalendarEvent] = Field(default_factory=list)
    focus: FocusState = Field(default_factory=FocusState)
    profile: Profile = Field(default_factory=Profile)
    integrations: list[Integration] = Field(default_factory=list)


class StateEnvelope(BaseModel):
    state: OrbitState


class TaskCreate(BaseModel):
    title: str | None = None
    task: Task | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    meta: str | None = None
    time: str | None = None
    date: str | None = None
    priority: str | None = None
    accent: str | None = None
    done: bool | None = None


class NoteCreate(BaseModel):
    title: str
    body: str = ""
    tag: str = "Note"


class NotePatch(BaseModel):
    title: str | None = None
    body: str | None = None
    tag: str | None = None


class RoutineCreate(BaseModel):
    title: str
    cadence: str = "Daily"
    anchor: str = "Anytime"
    done: bool = False


class RoutinePatch(BaseModel):
    title: str | None = None
    cadence: str | None = None
    anchor: str | None = None
    done: bool | None = None


class FocusPatch(BaseModel):
    running: bool | None = None
    secondsLeft: int | None = Field(default=None, ge=0, le=99 * 60)
    completed: int | None = Field(default=None, ge=0)
    alarmEnabled: bool | None = None
    alarmName: str | None = None


class PreferencesPatch(BaseModel):
    theme: Theme | None = None
    activeView: View | None = None


class SearchResults(BaseModel):
    tasks: list[Task]
    notes: list[Note]
    events: list[CalendarEvent]
    routines: list[Routine]
    suggestions: list[dict[str, str]]


class EventCreate(BaseModel):
    title: str
    date: str
    start: str = "09:00"
    end: str = "09:30"
    type: str = "Focus"
    linkedTaskId: str = ""
    notes: str = ""


class EventPatch(BaseModel):
    title: str | None = None
    date: str | None = None
    start: str | None = None
    end: str | None = None
    type: str | None = None
    linkedTaskId: str | None = None
    notes: str | None = None


class ProfilePatch(BaseModel):
    name: str | None = None
    handle: str | None = None
    role: str | None = None
    email: str | None = None
    timezone: str | None = None
    avatar: str | None = None
    dailyFocusGoal: int | None = Field(default=None, ge=1, le=16)


class IntegrationPatch(BaseModel):
    status: Literal["not_configured", "configured", "connected"] | None = None
    clientId: str | None = None
    redirectUri: str | None = None
    scopes: str | None = None
    lastSync: str | None = None


class User(BaseModel):
    id: str
    handle: str
    displayName: str
    createdAt: str
    timezone: str = "Asia/Calcutta"


class AuthHandleCreate(BaseModel):
    handle: str
    displayName: str | None = None
    timezone: str = "Asia/Calcutta"


class UserPatch(BaseModel):
    handle: str | None = None
    displayName: str | None = None
    timezone: str | None = None


class Group(BaseModel):
    id: str
    name: str
    joinCode: str
    ownerUserId: str
    createdAt: str
    role: str = "member"
    memberCount: int = 1


class GroupCreate(BaseModel):
    name: str


class GroupJoin(BaseModel):
    joinCode: str


class GroupPatch(BaseModel):
    name: str | None = None


class GroupMemberPatch(BaseModel):
    role: Literal["admin", "member"] = "member"


class ScoreBreakdown(BaseModel):
    period: Literal["day", "week", "month", "year"] = "day"
    score: int = 0
    taskPoints: int = 0
    focusPoints: int = 0
    consistencyPoints: int = 0
    completedTaskWeight: float = 0
    totalTaskWeight: float = 0
    scoredTaskWeight: float = 0
    taskGoalWeight: float = 0
    taskScoreCap: float = 0
    scoredTaskCount: int = 0
    completedTaskCount: int = 0
    createdTaskCount: int = 0
    duplicateTaskCount: int = 0
    microTaskCount: int = 0
    invalidFocusCount: int = 0
    spamPenalty: int = 0
    validFocusMinutes: int = 0
    focusGoalMinutes: int = 0
    suspiciousCount: int = 0
    validation: str = "Clean"
    trustScore: int = 100
    trustLabel: str = "High trust"
    validationReasons: list[str] = Field(default_factory=list)
    whyThisChanged: list[str] = Field(default_factory=list)


class ScoreSummary(BaseModel):
    today: ScoreBreakdown
    week: ScoreBreakdown
    month: ScoreBreakdown
    year: ScoreBreakdown


class LeaderboardRow(BaseModel):
    userId: str
    handle: str
    displayName: str
    score: int
    validFocusMinutes: int
    completedTaskWeight: float
    scoredTaskWeight: float = 0
    suspiciousCount: int = 0
    rank: int
    validation: str = "Clean"
    trustScore: int = 100


class FocusSessionRecord(BaseModel):
    id: str
    userId: str
    startedAt: str
    endedAt: str = ""
    plannedMinutes: int = 25
    validMinutes: int = 0
    status: Literal["active", "completed", "cancelled", "flagged"] = "active"
    suspicious: bool = False


def model_to_dict(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def default_state() -> OrbitState:
    return normalize_state(
        {
            "theme": "dark",
            "activeView": "Today",
            "tasks": [
                {
                    "id": "task-1",
                    "title": "Map the top three outcomes for today",
                    "meta": "Planning",
                    "time": "09:10",
                    "priority": "High",
                    "accent": "coral",
                    "done": False,
                },
                {
                    "id": "task-2",
                    "title": "Deep work sprint on Orbit command surface",
                    "meta": "Build",
                    "time": "10:00",
                    "priority": "Focus",
                    "accent": "violet",
                    "done": False,
                },
                {
                    "id": "task-3",
                    "title": "Review feature backlog for Pomodoro and habits",
                    "meta": "Research",
                    "time": "13:30",
                    "priority": "Medium",
                    "accent": "mint",
                    "done": False,
                },
                {
                    "id": "task-4",
                    "title": "Clean notes into future modules",
                    "meta": "Notes",
                    "time": "16:00",
                    "priority": "Low",
                    "accent": "slate",
                    "done": True,
                },
            ],
            "notes": [
                {
                    "id": "note-1",
                    "title": "Pomodoro expansion",
                    "body": "Add session history, streaks, and energy tags.",
                    "tag": "Feature",
                },
                {
                    "id": "note-2",
                    "title": "Smart capture grammar",
                    "body": "Parse dates, #labels, and !priority from one line.",
                    "tag": "AI-ready",
                },
                {
                    "id": "note-3",
                    "title": "Calendar bridge",
                    "body": "Reserve focus blocks from task estimates.",
                    "tag": "Later",
                },
            ],
            "routines": [
                {
                    "id": "routine-1",
                    "title": "Plan top three outcomes",
                    "cadence": "Morning",
                    "anchor": "Before deep work",
                    "done": False,
                },
                {
                    "id": "routine-2",
                    "title": "Add a recovery buffer",
                    "cadence": "Midday",
                    "anchor": "Between meetings",
                    "done": False,
                },
                {
                    "id": "routine-3",
                    "title": "Shutdown note for tomorrow",
                    "cadence": "Evening",
                    "anchor": "End of day",
                    "done": False,
                },
            ],
            "focus": {"running": False, "secondsLeft": 25 * 60, "completed": 2, "alarmEnabled": True},
            "events": [
                {
                    "id": "event-1",
                    "title": "Design QA pass",
                    "date": "2026-07-01",
                    "start": "11:30",
                    "end": "12:15",
                    "type": "Review",
                    "notes": "Check responsive states and polish.",
                },
                {
                    "id": "event-2",
                    "title": "Feature planning",
                    "date": "2026-07-01",
                    "start": "14:00",
                    "end": "14:45",
                    "type": "Planning",
                    "notes": "Calendar, tasks, notes, profile, OAuth.",
                },
                {
                    "id": "event-3",
                    "title": "Shutdown ritual",
                    "date": "2026-07-01",
                    "start": "17:15",
                    "end": "17:30",
                    "type": "Personal",
                    "notes": "Review and reset.",
                },
            ],
            "profile": {
                "name": "Samarth Mishra",
                "handle": "samarth",
                "role": "Builder",
                "email": "",
                "timezone": "Asia/Calcutta",
                "dailyFocusGoal": 4,
            },
            "integrations": [
                {
                    "id": "google",
                    "provider": "google",
                    "label": "Google Calendar",
                    "status": "not_configured",
                    "redirectUri": "http://127.0.0.1:4174/api/auth/google/callback",
                    "scopes": "openid email profile https://www.googleapis.com/auth/calendar.readonly",
                },
            ],
        }
    )


def normalize_state(value: dict[str, Any] | OrbitState | None) -> OrbitState:
    if isinstance(value, OrbitState):
        value = model_to_dict(value)
    source = value if isinstance(value, dict) else {}

    return OrbitState(
        theme="light" if source.get("theme") == "light" else "dark",
        activeView=source.get("activeView") if source.get("activeView") in VIEW_LABELS else "Today",
        tasks=[task for task in (normalize_task(item) for item in source.get("tasks", [])) if task],
        notes=[note for note in (normalize_note(item) for item in source.get("notes", [])) if note],
        routines=[routine for routine in (normalize_routine(item) for item in source.get("routines", [])) if routine],
        events=[event for event in (normalize_event(item) for item in source.get("events", [])) if event],
        focus=normalize_focus(source.get("focus")),
        profile=normalize_profile(source.get("profile")),
        integrations=[
            integration
            for integration in (normalize_integration(item) for item in source.get("integrations", []))
            if integration
        ],
    )


def normalize_task(value: dict[str, Any] | Task | None) -> Task | None:
    if isinstance(value, Task):
        value = model_to_dict(value)
    if not isinstance(value, dict):
        return None

    title = str(value.get("title") or "").strip()
    if not title:
        return None

    return Task(
        id=str(value.get("id") or f"task-{timestamp_id()}"),
        title=title,
        meta=str(value.get("meta") or "Quick capture").strip() or "Quick capture",
        time=str(value.get("time") or short_time()).strip() or short_time(),
        date=str(value.get("date") or "").strip(),
        priority=str(value.get("priority") or "New").strip() or "New",
        accent=value.get("accent") if value.get("accent") in ALLOWED_ACCENTS else "violet",
        done=bool(value.get("done")),
        createdAt=str(value.get("createdAt") or "").strip(),
        completedAt=str(value.get("completedAt") or "").strip(),
    )


def normalize_note(value: dict[str, Any] | Note | None) -> Note | None:
    if isinstance(value, Note):
        value = model_to_dict(value)
    if not isinstance(value, dict):
        return None

    title = str(value.get("title") or "").strip()
    if not title:
        return None

    return Note(
        id=str(value.get("id") or f"note-{timestamp_id()}"),
        title=title,
        body=str(value.get("body") or "").strip(),
        tag=str(value.get("tag") or "Note").strip() or "Note",
    )


def normalize_routine(value: dict[str, Any] | Routine | None) -> Routine | None:
    if isinstance(value, Routine):
        value = model_to_dict(value)
    if not isinstance(value, dict):
        return None

    title = str(value.get("title") or "").strip()
    if not title:
        return None

    return Routine(
        id=str(value.get("id") or f"routine-{timestamp_id()}"),
        title=title,
        cadence=str(value.get("cadence") or "Daily").strip() or "Daily",
        anchor=str(value.get("anchor") or "Anytime").strip() or "Anytime",
        done=bool(value.get("done")),
    )


def normalize_focus(value: dict[str, Any] | FocusState | None) -> FocusState:
    if isinstance(value, FocusState):
        value = model_to_dict(value)
    source = value if isinstance(value, dict) else {}
    deadline = coerce_int(source.get("deadlineAt"), 0, 0, 10**15)
    remaining = max(0, round((deadline - datetime.now().timestamp() * 1000) / 1000)) if source.get("running") and deadline else source.get("secondsLeft")
    return FocusState(
        running=bool(source.get("running")),
        secondsLeft=coerce_int(remaining, 25 * 60, 0, 99 * 60),
        completed=coerce_int(source.get("completed"), 2, 0, 100_000),
        alarmEnabled=bool(source.get("alarmEnabled", True)),
        alarmName=str(source.get("alarmName") or "Soft chime").strip() or "Soft chime",
        activeSessionId=str(source.get("activeSessionId") or "").strip(),
        deadlineAt=deadline,
    )


def normalize_event(value: dict[str, Any] | CalendarEvent | None) -> CalendarEvent | None:
    if isinstance(value, CalendarEvent):
        value = model_to_dict(value)
    if not isinstance(value, dict):
        return None

    title = str(value.get("title") or "").strip()
    date = str(value.get("date") or "").strip()
    if not title or not date:
        return None

    return CalendarEvent(
        id=str(value.get("id") or f"event-{timestamp_id()}"),
        title=title,
        date=date,
        start=str(value.get("start") or "09:00").strip() or "09:00",
        end=str(value.get("end") or "09:30").strip() or "09:30",
        type=str(value.get("type") or "Focus").strip() or "Focus",
        linkedTaskId=str(value.get("linkedTaskId") or "").strip(),
        notes=str(value.get("notes") or "").strip(),
    )


def normalize_profile(value: dict[str, Any] | Profile | None) -> Profile:
    if isinstance(value, Profile):
        value = model_to_dict(value)
    source = value if isinstance(value, dict) else {}
    return Profile(
        name=str(source.get("name") or "Samarth Mishra").strip() or "Samarth Mishra",
        handle=str(source.get("handle") or "samarth").strip() or "samarth",
        role=str(source.get("role") or "Builder").strip() or "Builder",
        email=str(source.get("email") or "").strip(),
        timezone=str(source.get("timezone") or "Asia/Calcutta").strip() or "Asia/Calcutta",
        avatar=str(source.get("avatar") or "").strip(),
        dailyFocusGoal=coerce_int(source.get("dailyFocusGoal"), 4, 1, 16),
    )


def normalize_integration(value: dict[str, Any] | Integration | None) -> Integration | None:
    if isinstance(value, Integration):
        value = model_to_dict(value)
    if not isinstance(value, dict):
        return None
    provider = str(value.get("provider") or value.get("id") or "").strip()
    if not provider:
        return None
    status = value.get("status") if value.get("status") in {"not_configured", "configured", "connected"} else "not_configured"
    return Integration(
        id=str(value.get("id") or provider).strip(),
        provider=provider,
        label=str(value.get("label") or provider.title()).strip(),
        status=status,
        clientId=str(value.get("clientId") or "").strip(),
        redirectUri=str(value.get("redirectUri") or "").strip(),
        scopes=str(value.get("scopes") or "").strip(),
        lastSync=str(value.get("lastSync") or "").strip(),
    )


def captured_task(title: str, now: datetime | None = None) -> Task | None:
    clean_title = str(title or "").strip()
    if not clean_title:
        return None

    now = now or datetime.now()
    has_priority = "!" in clean_title
    has_tag = "#" in clean_title
    return normalize_task(
        {
            "id": f"task-{timestamp_id(now)}",
            "title": clean_title.replace("#", "").replace("!", "").strip(),
            "meta": "Tagged capture" if has_tag else "Quick capture",
            "time": short_time(now),
            "date": now.strftime("%Y-%m-%d"),
            "priority": "High" if has_priority else "New",
            "accent": "coral" if has_priority else "mint" if has_tag else "violet",
            "done": False,
        }
    )


def short_time(now: datetime | None = None) -> str:
    return (now or datetime.now()).strftime("%I:%M %p")


def timestamp_id(now: datetime | None = None) -> int:
    return int((now or datetime.now()).timestamp() * 1000)


def coerce_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return min(max(parsed, minimum), maximum)
