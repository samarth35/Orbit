from __future__ import annotations

from pathlib import Path
from typing import Any
import hmac

from fastapi import Depends, FastAPI, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import cookie_secure, database_url, load_dotenv, oauth_env, public_base_url
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
    NoteCreate,
    NotePatch,
    OrbitState,
    PreferencesPatch,
    ProfilePatch,
    RoutineCreate,
    RoutinePatch,
    StateEnvelope,
    TaskCreate,
    TaskPatch,
    UserPatch,
)
from .services import OrbitService
from .postgres_store import PostgresStateStore
from .sqlite_store import SqliteStateStore


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DIST_ROOT = PROJECT_ROOT / "dist"
DATA_PATH = PROJECT_ROOT / "data" / "orbit.sqlite3"

load_dotenv()
store = PostgresStateStore(database_url()) if database_url() else SqliteStateStore(DATA_PATH)
service = OrbitService(store)

app = FastAPI(title="Orbit API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:4174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_COOKIE = "orbit_session"
CSRF_COOKIE = "orbit_csrf"
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

if (DIST_ROOT / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_ROOT / "assets"), name="assets")


@app.get("/api/health")
def health() -> dict[str, Any]:
    state = service.state()
    return {"ok": True, "tasks": len(state.tasks), "notes": len(state.notes)}


def request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return (forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else ""))[:80]


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in user.items() if not key.startswith("_")}


def set_session_cookies(response: Response, session_payload: dict[str, Any]) -> None:
    secure = cookie_secure()
    response.set_cookie(
        SESSION_COOKIE,
        session_payload["token"],
        max_age=30 * 24 * 60 * 60,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        session_payload["csrfToken"],
        max_age=30 * 24 * 60 * 60,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def refresh_csrf_cookie(response: Response, session: dict[str, Any]) -> None:
    response.set_cookie(
        CSRF_COOKIE,
        session["csrfToken"],
        max_age=30 * 24 * 60 * 60,
        httponly=False,
        secure=cookie_secure(),
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def current_user(request: Request, response: Response) -> dict[str, Any]:
    session_token = request.cookies.get(SESSION_COOKIE, "")
    session_context = service.session_user(session_token, request.headers.get("user-agent", ""), request_ip(request))
    if not session_context:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    session = session_context["session"]
    if request.method in MUTATING_METHODS:
        csrf_header = request.headers.get("x-orbit-csrf", "")
        csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
        expected = session["csrfToken"]
        if not csrf_header or not csrf_cookie or not hmac.compare_digest(csrf_header, csrf_cookie) or not hmac.compare_digest(csrf_header, expected):
            raise HTTPException(status_code=403, detail="CSRF validation failed")
    refresh_csrf_cookie(response, session)
    user = dict(session_context["user"])
    user["_session"] = session
    user["_auth"] = session_context.get("auth", {})
    return user


@app.post("/api/auth/handle")
def auth_handle(payload: AuthHandleCreate, request: Request, response: Response) -> dict[str, Any]:
    user = service.auth_handle(payload)
    session_payload = service.create_session(user["id"], request.headers.get("user-agent", ""), request_ip(request))
    set_session_cookies(response, session_payload)
    return {"user": user, "state": service.state(user["id"]), "scores": service.score_summary(user["id"]), "groups": service.groups(user["id"]), "auth": service.auth_status(user["id"]), "session": session_payload["session"]}


@app.post("/api/auth/guest")
def auth_guest(request: Request, response: Response) -> dict[str, Any]:
    user = service.auth_guest()
    session_payload = service.create_session(user["id"], request.headers.get("user-agent", ""), request_ip(request))
    set_session_cookies(response, session_payload)
    return {"user": user, "state": service.state(user["id"]), "scores": service.score_summary(user["id"]), "groups": service.groups(user["id"]), "auth": service.auth_status(user["id"]), "session": session_payload["session"]}


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    service.revoke_session(request.cookies.get(SESSION_COOKIE, ""))
    clear_session_cookies(response)
    return {"ok": True}


@app.get("/api/auth/google/status")
def google_status(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return service.auth_status(user["id"])["providers"]["google"]


@app.get("/api/auth/google/start")
def google_start(redirect: str = Query(default="/")):
    payload = service.begin_google_oauth(redirect)
    if not payload.get("configured"):
        return payload
    return RedirectResponse(payload["url"])


@app.get("/api/auth/google/callback")
def google_callback(request: Request, state: str = Query(default=""), code: str = Query(default="")):
    if not state or not code:
        raise HTTPException(status_code=400, detail="Missing OAuth callback parameters")
    payload = service.complete_google_oauth(state, code, request.headers.get("user-agent", ""), request_ip(request))
    redirect = RedirectResponse(payload.get("redirectTo") or "/")
    set_session_cookies(redirect, payload["session"])
    return redirect


@app.get("/api/users/me")
def get_current_user(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": public_user(user), "state": service.state(user["id"]), "scores": service.score_summary(user["id"]), "groups": service.groups(user["id"]), "auth": user["_auth"], "session": user["_session"]}


@app.patch("/api/users/me")
def patch_user(payload: UserPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": service.patch_user(payload, user["id"])}


@app.get("/api/state")
def get_state(user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.state(user["id"])}


@app.put("/api/state")
def put_state(payload: StateEnvelope | OrbitState, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    state = payload.state if isinstance(payload, StateEnvelope) else payload
    return {"state": service.replace_state(state, user["id"])}


@app.get("/api/tasks")
def list_tasks(user: dict[str, Any] = Depends(current_user)) -> dict[str, list]:
    return {"tasks": service.state(user["id"]).tasks}


@app.post("/api/tasks", status_code=201)
def create_task(payload: TaskCreate, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    task, state = service.create_task(payload, user["id"])
    return {"task": task, "state": state}


@app.patch("/api/tasks/{task_id}")
def patch_task(task_id: str, payload: TaskPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.patch_task(task_id, payload, user["id"])}


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.delete_task(task_id, user["id"])}


@app.get("/api/notes")
def list_notes(user: dict[str, Any] = Depends(current_user)) -> dict[str, list]:
    return {"notes": service.state(user["id"]).notes}


@app.post("/api/notes", status_code=201)
def create_note(payload: NoteCreate, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    note, state = service.create_note(payload, user["id"])
    return {"note": note, "state": state}


@app.patch("/api/notes/{note_id}")
def patch_note(note_id: str, payload: NotePatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.patch_note(note_id, payload, user["id"])}


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.delete_note(note_id, user["id"])}


@app.get("/api/routines")
def list_routines(user: dict[str, Any] = Depends(current_user)) -> dict[str, list]:
    return {"routines": service.state(user["id"]).routines}


@app.post("/api/routines", status_code=201)
def create_routine(payload: RoutineCreate, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.create_routine(payload, user["id"])}


@app.patch("/api/routines/{routine_id}")
def patch_routine(routine_id: str, payload: RoutinePatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.patch_routine(routine_id, payload, user["id"])}


@app.delete("/api/routines/{routine_id}")
def delete_routine(routine_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.delete_routine(routine_id, user["id"])}


@app.get("/api/calendar/events")
def list_events(user: dict[str, Any] = Depends(current_user)) -> dict[str, list]:
    return {"events": service.state(user["id"]).events}


@app.post("/api/calendar/events", status_code=201)
def create_event(payload: EventCreate, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.create_event(payload, user["id"])}


@app.patch("/api/calendar/events/{event_id}")
def patch_event(event_id: str, payload: EventPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.patch_event(event_id, payload, user["id"])}


@app.delete("/api/calendar/events/{event_id}")
def delete_event(event_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.delete_event(event_id, user["id"])}


@app.patch("/api/focus")
def patch_focus(payload: FocusPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.patch_focus(payload, user["id"])}


@app.post("/api/focus/reset")
def reset_focus(user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.reset_focus(user["id"])}


@app.post("/api/focus/sessions/start")
def start_focus_session(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return service.start_focus_session(user["id"])


@app.post("/api/focus/sessions/complete")
def complete_focus_session(session_id: str | None = Query(default=None), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return service.complete_focus_session(user["id"], session_id)


@app.patch("/api/preferences")
def patch_preferences(payload: PreferencesPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.patch_preferences(payload, user["id"])}


@app.get("/api/profile")
def profile(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    state = service.state(user["id"])
    return {"profile": state.profile, "integrations": state.integrations, "auth": user["_auth"], "session": user["_session"]}


@app.patch("/api/profile")
def patch_profile(payload: ProfilePatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.patch_profile(payload, user["id"])}


@app.patch("/api/integrations/{integration_id}")
def patch_integration(integration_id: str, payload: IntegrationPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, OrbitState]:
    return {"state": service.patch_integration(integration_id, payload, user["id"])}


@app.get("/api/oauth/{provider}/authorize")
def oauth_authorize(provider: str) -> dict[str, Any]:
    integration = next((item for item in service.state().integrations if item.provider == provider), None)
    config = oauth_env(provider)
    configured = bool(config["client_id"] and config["client_secret"])
    env_prefix = f"ORBIT_{provider.strip().upper().replace('-', '_')}"
    return {
        "provider": provider,
        "configured": configured,
        "redirectUri": config["redirect_uri"] or (integration.redirectUri if integration else ""),
        "message": f"Set {env_prefix}_CLIENT_ID and {env_prefix}_CLIENT_SECRET in .env before enabling redirects." if not configured else "OAuth credentials are configured from .env.",
    }


@app.get("/api/suggestions")
def suggestions(user: dict[str, Any] = Depends(current_user)) -> dict[str, list[dict[str, str]]]:
    return {"suggestions": service.suggestions(user["id"])}


@app.get("/api/search")
def search(q: str = Query(default=""), user: dict[str, Any] = Depends(current_user)):
    return service.search(q, user["id"])


@app.post("/api/groups", status_code=201)
def create_group(payload: GroupCreate, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"group": service.create_group(payload, user["id"]), "groups": service.groups(user["id"])}


@app.post("/api/groups/join")
def join_group(payload: GroupJoin, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"group": service.join_group(payload, user["id"]), "groups": service.groups(user["id"])}


@app.get("/api/groups")
def list_groups(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"groups": service.groups(user["id"])}


@app.patch("/api/groups/{group_id}")
def patch_group(group_id: str, payload: GroupPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"group": service.patch_group(group_id, payload, user["id"]), "groups": service.groups(user["id"])}


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    service.delete_group(group_id, user["id"])
    return {"ok": True, "groups": service.groups(user["id"])}


@app.post("/api/groups/{group_id}/invite/regenerate")
def regenerate_group_invite(group_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"group": service.regenerate_group_invite(group_id, user["id"]), "groups": service.groups(user["id"])}


@app.get("/api/groups/{group_id}/members")
def group_members(group_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"members": service.group_members(group_id, user["id"])}


@app.patch("/api/groups/{group_id}/members/{member_user_id}")
def update_group_member(group_id: str, member_user_id: str, payload: GroupMemberPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"members": service.update_group_member_role(group_id, member_user_id, payload, user["id"])}


@app.delete("/api/groups/{group_id}/members/{member_user_id}")
def remove_group_member(group_id: str, member_user_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"members": service.remove_group_member(group_id, member_user_id, user["id"]), "groups": service.groups(user["id"])}


@app.get("/api/groups/{group_id}/leaderboard")
def group_leaderboard(group_id: str, period: str = Query(default="day"), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"leaderboard": service.leaderboard(period, group_id, user["id"])}


@app.get("/api/leaderboard/global")
def global_leaderboard(period: str = Query(default="day"), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"leaderboard": service.leaderboard(period, None, user["id"])}


@app.get("/api/scores/me")
def score_me(period: str = Query(default="day"), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"score": service.score(period, user["id"])}


@app.get("/api/scores/summary")
def score_summary(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"scores": service.score_summary(user["id"])}


@app.get("/{full_path:path}")
def serve_app(full_path: str):
    requested = (DIST_ROOT / full_path).resolve()
    if DIST_ROOT.exists() and requested.is_file() and DIST_ROOT in requested.parents:
        return FileResponse(requested)

    index = DIST_ROOT / "index.html"
    if index.exists():
        return FileResponse(index)

    return {"error": "Run npm run build before starting Orbit."}
