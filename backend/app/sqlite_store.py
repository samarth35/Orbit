from __future__ import annotations

import json
import base64
import hashlib
import hmac
import secrets
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError

from fastapi import HTTPException

from .config import oauth_env, public_base_url, session_secret
from .models import OrbitState, default_state, model_to_dict, normalize_state


DEFAULT_USER_ID = "user-default"
PERIODS = {"day", "week", "month", "year"}
TASK_POINT_MAX = 35
FOCUS_POINT_MAX = 45
CONSISTENCY_POINT_MAX = 20
DAILY_TASK_GOAL_WEIGHT = 4.5
DAILY_TASK_SCORE_CAP = 6.0
DAILY_TASK_COUNT_CAP = 6
DAILY_LOW_TASK_WEIGHT_CAP = 1.5
DAILY_CREATED_TASK_LIMIT = 12
DAILY_COMPLETED_TASK_LIMIT = 10
SESSION_IDLE_DAYS = 14
SESSION_ABSOLUTE_DAYS = 30
OAUTH_STATE_MINUTES = 10
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_SCOPES = "openid email profile https://www.googleapis.com/auth/calendar.readonly"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def secure_id(prefix: str, size: int = 18) -> str:
    return f"{prefix}_{secrets.token_urlsafe(size).replace('-', '').replace('_', '')[:24]}"


def secure_join_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def token_hash(token: str) -> str:
    return hmac.new(session_secret().encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def iso_after(**kwargs: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(**kwargs)).isoformat()


def clean_handle(value: str) -> str:
    clean = "".join(char for char in value.lower().strip().replace(" ", "-") if char.isalnum() or char in {"-", "_"})
    return clean[:24] or "orbit-user"


def clean_redirect(value: str) -> str:
    raw = str(value or "/").strip()
    if not raw.startswith("/") or raw.startswith("//") or "\\" in raw or any(ord(char) < 32 for char in raw):
        return "/"
    return raw[:160]


def task_weight(priority: str) -> float:
    priority_key = str(priority or "").lower()
    if priority_key in {"focus", "high"}:
        return 1.5
    if priority_key == "medium":
        return 1.0
    return 0.75


def task_key(title: str) -> str:
    return " ".join(str(title or "").lower().strip().split())


def is_micro_task(title: str, meta: str = "") -> bool:
    clean_title = task_key(title)
    clean_meta = str(meta or "").strip()
    return len(clean_title) < 10 and len(clean_meta) < 8


def parse_date(value: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def parse_datetime(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def post_form_json(url: str, payload: dict[str, str]) -> dict[str, Any]:
    data = urlencode(payload).encode("utf-8")
    request = Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=502, detail="OAuth provider request failed") from error


def get_bearer_json(url: str, token: str) -> dict[str, Any]:
    request = Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=502, detail="OAuth profile request failed") from error


class SqliteStateStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = RLock()
        self._ensure_schema()

    def read(self, user_id: str | None = None) -> OrbitState:
        with self._lock, self._connect() as connection:
            self._ensure_seed(connection)
            user = self.ensure_user(user_id, connection)
            row = connection.execute("SELECT data FROM user_states WHERE user_id = ?", (user["id"],)).fetchone()
            if row:
                return normalize_state(json.loads(row["data"]))

            state = default_state()
            state.profile.handle = user["handle"]
            state.profile.name = user["displayName"]
            state.profile.timezone = user["timezone"]
            self._replace_user_state(connection, user["id"], state)
            connection.commit()
            return state

    def read_legacy_state(self, connection: sqlite3.Connection) -> OrbitState:
        self._ensure_legacy_seed(connection)
        state = {
            "theme": self._preference(connection, "theme", "dark"),
            "activeView": self._preference(connection, "activeView", "Today"),
            "tasks": self._rows(connection, "tasks"),
            "notes": self._rows(connection, "notes"),
            "routines": self._rows(connection, "routines") or [
                model_to_dict(routine) for routine in default_state().routines
            ],
            "events": self._rows(connection, "events"),
            "focus": self._focus(connection),
            "profile": self._profile(connection),
            "integrations": self._rows(connection, "integrations"),
        }
        return normalize_state(state)

    def legacy_read(self) -> OrbitState:
        with self._lock, self._connect() as connection:
            state = {
                "theme": self._preference(connection, "theme", "dark"),
                "activeView": self._preference(connection, "activeView", "Today"),
                "tasks": self._rows(connection, "tasks"),
                "notes": self._rows(connection, "notes"),
                "routines": self._rows(connection, "routines") or [
                    model_to_dict(routine) for routine in default_state().routines
                ],
                "events": self._rows(connection, "events"),
                "focus": self._focus(connection),
                "profile": self._profile(connection),
                "integrations": self._rows(connection, "integrations"),
            }
            return normalize_state(state)

    def write(self, state: OrbitState, user_id: str | None = None) -> OrbitState:
        clean_state = normalize_state(model_to_dict(state))
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            self._replace_user_state(connection, user["id"], clean_state)
            self._sync_user_from_profile(connection, user["id"], clean_state)
            connection.commit()
        return clean_state

    def legacy_write(self, state: OrbitState) -> OrbitState:
        clean_state = normalize_state(model_to_dict(state))
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN")
            self._replace_preferences(connection, clean_state)
            self._replace_table(connection, "tasks", [model_to_dict(task) for task in clean_state.tasks])
            self._replace_table(connection, "notes", [model_to_dict(note) for note in clean_state.notes])
            self._replace_table(connection, "routines", [model_to_dict(routine) for routine in clean_state.routines])
            self._replace_table(connection, "events", [model_to_dict(event) for event in clean_state.events])
            self._replace_table(connection, "integrations", [model_to_dict(item) for item in clean_state.integrations])
            self._replace_single(connection, "focus", "focus", model_to_dict(clean_state.focus))
            self._replace_single(connection, "profile", "profile", model_to_dict(clean_state.profile))
            connection.commit()
        return clean_state

    def update(self, updater: Callable[[OrbitState], OrbitState], user_id: str | None = None) -> OrbitState:
        with self._lock:
            return self.write(updater(self.read(user_id)), user_id)

    def auth_handle(self, handle: str, display_name: str | None = None, timezone_name: str = "Asia/Calcutta") -> dict[str, Any]:
        handle = clean_handle(handle)
        with self._lock, self._connect() as connection:
            self._ensure_seed(connection)
            row = connection.execute("SELECT * FROM users WHERE handle = ?", (handle,)).fetchone()
            if row:
                raise HTTPException(status_code=409, detail="Handle is already taken")
            user_id = secure_id("usr")
            user = {
                "id": user_id,
                "handle": handle,
                "displayName": (display_name or handle).strip() or handle,
                "createdAt": now_iso(),
                "timezone": timezone_name or "Asia/Calcutta",
                "isGuest": False,
            }
            connection.execute(
                "INSERT INTO users(id, handle, display_name, created_at, timezone, is_guest) VALUES(?, ?, ?, ?, ?, ?)",
                (user["id"], user["handle"], user["displayName"], user["createdAt"], user["timezone"], 0),
            )
            state = default_state()
            state.tasks = []
            state.notes = []
            state.events = []
            state.focus.completed = 0
            state.profile.handle = user["handle"]
            state.profile.name = user["displayName"]
            state.profile.timezone = user["timezone"]
            self._replace_user_state(connection, user_id, state)
            connection.commit()
            return user

    def auth_guest(self, timezone_name: str = "Asia/Calcutta") -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            self._ensure_seed(connection)
            handle_seed = f"guest-{secrets.token_urlsafe(5).lower()}"
            handle = self._available_handle(connection, handle_seed)
            user_id = secure_id("usr")
            user = {
                "id": user_id,
                "handle": handle,
                "displayName": "Guest",
                "createdAt": now_iso(),
                "timezone": timezone_name or "Asia/Calcutta",
                "isGuest": True,
            }
            connection.execute(
                "INSERT INTO users(id, handle, display_name, created_at, timezone, is_guest) VALUES(?, ?, ?, ?, ?, ?)",
                (user["id"], user["handle"], user["displayName"], user["createdAt"], user["timezone"], 1),
            )
            state = default_state()
            state.tasks = []
            state.notes = []
            state.events = []
            state.focus.completed = 0
            state.profile.handle = user["handle"]
            state.profile.name = user["displayName"]
            state.profile.role = "Guest session"
            state.profile.timezone = user["timezone"]
            self._replace_user_state(connection, user_id, state)
            self.log_security_event(connection, user_id, "guest_session_created", user_id)
            connection.commit()
            return user

    def user(self, user_id: str | None = None) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            self._ensure_seed(connection)
            return self.ensure_user(user_id, connection)

    def new_id(self, prefix: str) -> str:
        return secure_id(prefix)

    def create_session(self, user_id: str, user_agent: str = "", ip_address: str = "") -> dict[str, Any]:
        token = secrets.token_urlsafe(48)
        csrf_token = secrets.token_urlsafe(32)
        session_id = secure_id("sess")
        now = now_iso()
        idle_expires_at = iso_after(days=SESSION_IDLE_DAYS)
        absolute_expires_at = iso_after(days=SESSION_ABSOLUTE_DAYS)
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            connection.execute(
                """
                INSERT INTO sessions(id, token_hash, user_id, csrf_token, created_at, last_seen_at,
                                     idle_expires_at, absolute_expires_at, revoked_at, user_agent, ip_address)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
                """,
                (session_id, token_hash(token), user["id"], csrf_token, now, now, idle_expires_at, absolute_expires_at, user_agent[:240], ip_address[:80]),
            )
            self.log_security_event(connection, user["id"], "session_created", session_id, {"ip": ip_address})
            connection.commit()
            return {
                "token": token,
                "csrfToken": csrf_token,
                "session": {
                    "id": session_id,
                    "createdAt": now,
                    "expiresAt": absolute_expires_at,
                    "idleExpiresAt": idle_expires_at,
                },
            }

    def session_user(self, token: str | None, user_agent: str = "", ip_address: str = "") -> dict[str, Any] | None:
        if not token:
            return None
        now = datetime.now(timezone.utc)
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM sessions WHERE token_hash = ? AND revoked_at = ''",
                (token_hash(token),),
            ).fetchone()
            if not row:
                return None
            idle_expires = parse_datetime(row["idle_expires_at"])
            absolute_expires = parse_datetime(row["absolute_expires_at"])
            if (idle_expires and idle_expires <= now) or (absolute_expires and absolute_expires <= now):
                connection.execute("UPDATE sessions SET revoked_at = ? WHERE id = ?", (now.isoformat(), row["id"]))
                connection.commit()
                return None
            next_idle = min(now + timedelta(days=SESSION_IDLE_DAYS), absolute_expires or now + timedelta(days=SESSION_IDLE_DAYS))
            connection.execute(
                "UPDATE sessions SET last_seen_at = ?, idle_expires_at = ?, user_agent = ?, ip_address = ? WHERE id = ?",
                (now.isoformat(), next_idle.isoformat(), user_agent[:240], ip_address[:80], row["id"]),
            )
            connection.commit()
            user = self.ensure_user(row["user_id"], connection)
            return {
                "user": user,
                "session": {
                    "id": row["id"],
                    "csrfToken": row["csrf_token"],
                    "createdAt": row["created_at"],
                    "expiresAt": row["absolute_expires_at"],
                    "idleExpiresAt": next_idle.isoformat(),
                },
                "auth": self.auth_status(user["id"], connection),
            }

    def revoke_session(self, token: str | None) -> None:
        if not token:
            return
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM sessions WHERE token_hash = ? AND revoked_at = ''", (token_hash(token),)).fetchone()
            if row:
                revoked_at = now_iso()
                connection.execute("UPDATE sessions SET revoked_at = ? WHERE id = ?", (revoked_at, row["id"]))
                self.log_security_event(connection, row["user_id"], "session_revoked", row["id"])
                connection.commit()

    def auth_status(self, user_id: str, connection: sqlite3.Connection | None = None) -> dict[str, Any]:
        own_connection = connection is None
        connection = connection or self._connect()
        try:
            accounts = [
                {
                    "provider": row["provider"],
                    "email": row["email"],
                    "displayName": row["display_name"],
                    "avatar": row["avatar"],
                    "linkedAt": row["linked_at"],
                    "lastLoginAt": row["last_login_at"],
                }
                for row in connection.execute("SELECT * FROM auth_accounts WHERE user_id = ? ORDER BY linked_at", (user_id,))
            ]
            google = oauth_env("google")
            return {
                "session": {"authenticated": True},
                "providers": {
                    "google": {
                        "configured": bool(google["client_id"] and google["client_secret"]),
                        "connected": any(account["provider"] == "google" for account in accounts),
                        "redirectUri": google["redirect_uri"] or f"{public_base_url()}/api/auth/google/callback",
                    }
                },
                "accounts": accounts,
            }
        finally:
            if own_connection:
                connection.close()

    def begin_google_oauth(self, redirect_to: str = "/", guest_user_id: str = "") -> dict[str, Any]:
        config = oauth_env("google")
        redirect_uri = config["redirect_uri"] or f"{public_base_url()}/api/auth/google/callback"
        configured = bool(config["client_id"] and config["client_secret"])
        if not configured:
            return {"configured": False, "url": "", "message": "Google OAuth is not configured in .env."}
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = b64url(hashlib.sha256(verifier.encode("ascii")).digest())
        nonce = secrets.token_urlsafe(24)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO oauth_states(state, provider, code_verifier, nonce, redirect_to, created_at, expires_at, used_at, guest_user_id)
                VALUES(?, 'google', ?, ?, ?, ?, ?, '', ?)
                """,
                (state, verifier, nonce, clean_redirect(redirect_to), now_iso(), iso_after(minutes=OAUTH_STATE_MINUTES), guest_user_id),
            )
            connection.commit()
        params = {
            "client_id": config["client_id"],
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": GOOGLE_SCOPES,
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
        return {"configured": True, "url": f"{config['auth_url'] or GOOGLE_AUTH_URL}?{urlencode(params)}", "state": state}

    def complete_google_oauth(self, state: str, code: str, user_agent: str = "", ip_address: str = "") -> dict[str, Any]:
        config = oauth_env("google")
        redirect_uri = config["redirect_uri"] or f"{public_base_url()}/api/auth/google/callback"
        if not (config["client_id"] and config["client_secret"]):
            raise HTTPException(status_code=503, detail="Google OAuth is not configured")
        with self._lock, self._connect() as connection:
            state_row = connection.execute(
                "SELECT * FROM oauth_states WHERE state = ? AND provider = 'google' AND used_at = ''",
                (state,),
            ).fetchone()
            if not state_row:
                raise HTTPException(status_code=400, detail="OAuth state is invalid or already used")
            expires_at = parse_datetime(state_row["expires_at"])
            if expires_at and expires_at <= datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="OAuth state expired")
            claimed = connection.execute("UPDATE oauth_states SET used_at = ? WHERE state = ? AND used_at = '' RETURNING state", (now_iso(), state)).fetchone()
            if not claimed:
                raise HTTPException(status_code=400, detail="OAuth state is already used")
            connection.commit()

        token_payload = {
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
            "code": code,
            "code_verifier": state_row["code_verifier"],
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
        tokens = post_form_json(config["token_url"] or GOOGLE_TOKEN_URL, token_payload)
        access_token = tokens.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="Google OAuth token exchange failed")
        profile = get_bearer_json(GOOGLE_USERINFO_URL, access_token)
        subject = str(profile.get("sub") or "").strip()
        email = str(profile.get("email") or "").strip().lower()
        if not subject:
            raise HTTPException(status_code=400, detail="Google profile is missing a subject")
        if not email or profile.get("email_verified") is not True:
            raise HTTPException(status_code=400, detail="A verified Google email is required")
        display_name = str(profile.get("name") or email.split("@")[0] or "Orbit User").strip()
        avatar = str(profile.get("picture") or "").strip()

        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT user_id FROM auth_accounts WHERE provider = 'google' AND provider_subject = ?",
                (subject,),
            ).fetchone()
            if existing:
                user = self.ensure_user(existing["user_id"], connection)
            else:
                account_by_email = connection.execute(
                    "SELECT user_id FROM auth_accounts WHERE email = ? ORDER BY linked_at LIMIT 1",
                    (email,),
                ).fetchone() if email else None
                guest_row = connection.execute("SELECT * FROM users WHERE id = ? AND is_guest = 1", (state_row["guest_user_id"],)).fetchone() if state_row["guest_user_id"] else None
                if account_by_email:
                    user = self.ensure_user(account_by_email["user_id"], connection)
                elif guest_row:
                    user = self.ensure_user(guest_row["id"], connection)
                    connection.execute("UPDATE users SET is_guest = 0, display_name = ? WHERE id = ?", (display_name, user["id"]))
                    guest_state = self._read_user_state(connection, user["id"])
                    guest_state.profile.name = display_name
                    guest_state.profile.role = "Orbit member"
                    self._replace_user_state(connection, user["id"], guest_state)
                else:
                    handle_seed = clean_handle(email.split("@")[0] if email else display_name)
                    handle = self._available_handle(connection, handle_seed)
                    user_id = secure_id("usr")
                    created_at = now_iso()
                    connection.execute(
                        "INSERT INTO users(id, handle, display_name, created_at, timezone, is_guest) VALUES(?, ?, ?, ?, ?, ?)",
                        (user_id, handle, display_name, created_at, "Asia/Calcutta", 0),
                    )
                    state_model = default_state()
                    state_model.tasks = []
                    state_model.notes = []
                    state_model.events = []
                    state_model.profile.handle = handle
                    state_model.profile.name = display_name
                    state_model.profile.email = email
                    state_model.profile.avatar = avatar
                    self._replace_user_state(connection, user_id, state_model)
                    user = self.ensure_user(user_id, connection)
                linked_at = now_iso()
                connection.execute(
                    """
                    INSERT INTO auth_accounts(id, user_id, provider, provider_subject, email, display_name, avatar, linked_at, last_login_at)
                    VALUES(?, ?, 'google', ?, ?, ?, ?, ?, ?)
                    """,
                    (secure_id("acct"), user["id"], subject, email, display_name, avatar, linked_at, linked_at),
                )
            connection.execute(
                "UPDATE auth_accounts SET email = ?, display_name = ?, avatar = ?, last_login_at = ? WHERE provider = 'google' AND provider_subject = ?",
                (email, display_name, avatar, now_iso(), subject),
            )
            state_model = self._read_user_state(connection, user["id"])
            state_model.profile.email = email or state_model.profile.email
            state_model.profile.avatar = avatar or state_model.profile.avatar
            state_model.profile.name = state_model.profile.name or display_name
            self._replace_user_state(connection, user["id"], state_model)
            self.log_security_event(connection, user["id"], "oauth_login", "google", {"email": email, "ip": ip_address})
            connection.commit()
        session = self.create_session(user["id"], user_agent, ip_address)
        return {"user": self.user(user["id"]), "session": session, "redirectTo": clean_redirect(state_row["redirect_to"])}

    def patch_user(self, user_id: str | None, updates: dict[str, Any]) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            handle = clean_handle(updates.get("handle") or user["handle"])
            display_name = str(updates.get("displayName") or user["displayName"]).strip() or user["displayName"]
            timezone_name = str(updates.get("timezone") or user["timezone"]).strip() or user["timezone"]
            self._ensure_handle_available_for_user(connection, handle, user["id"])
            connection.execute(
                "UPDATE users SET handle = ?, display_name = ?, timezone = ? WHERE id = ?",
                (handle, display_name, timezone_name, user["id"]),
            )
            state = self._read_user_state(connection, user["id"])
            state.profile.handle = handle
            state.profile.name = display_name
            state.profile.timezone = timezone_name
            self._replace_user_state(connection, user["id"], state)
            connection.commit()
            return self.ensure_user(user["id"], connection)

    def create_group(self, user_id: str | None, name: str) -> dict[str, Any]:
        clean_name = str(name or "").strip()
        if not clean_name:
            raise ValueError("Group name is required")
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            group_id = secure_id("grp")
            join_code = self._join_code(connection)
            created_at = now_iso()
            connection.execute(
                "INSERT INTO groups(id, name, join_code, owner_user_id, created_at) VALUES(?, ?, ?, ?, ?)",
                (group_id, clean_name, join_code, user["id"], created_at),
            )
            connection.execute(
                "INSERT OR REPLACE INTO group_members(group_id, user_id, role, joined_at) VALUES(?, ?, ?, ?)",
                (group_id, user["id"], "owner", created_at),
            )
            connection.commit()
            self.log_security_event(connection, user["id"], "group_created", group_id)
            return self._group(connection, group_id, user["id"])

    def join_group(self, user_id: str | None, join_code: str) -> dict[str, Any]:
        code = str(join_code or "").strip().upper()
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            row = connection.execute("SELECT id FROM groups WHERE join_code = ?", (code,)).fetchone()
            if not row:
                raise ValueError("Group not found")
            connection.execute(
                "INSERT OR IGNORE INTO group_members(group_id, user_id, role, joined_at) VALUES(?, ?, ?, ?)",
                (row["id"], user["id"], "member", now_iso()),
            )
            self.log_security_event(connection, user["id"], "group_joined", row["id"])
            connection.commit()
            return self._group(connection, row["id"], user["id"])

    def groups_for_user(self, user_id: str | None) -> list[dict[str, Any]]:
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            rows = connection.execute(
                "SELECT group_id FROM group_members WHERE user_id = ? ORDER BY joined_at",
                (user["id"],),
            ).fetchall()
            return [self._group(connection, row["group_id"], user["id"]) for row in rows]

    def leaderboard(self, period: str = "day", group_id: str | None = None, viewer_user_id: str | None = None) -> list[dict[str, Any]]:
        period = period if period in PERIODS else "day"
        with self._lock, self._connect() as connection:
            self._ensure_seed(connection)
            if group_id:
                viewer = self.ensure_user(viewer_user_id, connection)
                if not self._group_role(connection, group_id, viewer["id"]):
                    raise HTTPException(status_code=403, detail="Join the group before viewing its leaderboard")
                rows = connection.execute(
                    """
                    SELECT users.* FROM users
                    JOIN group_members ON group_members.user_id = users.id
                    WHERE group_members.group_id = ?
                      AND users.id <> ?
                      AND COALESCE(users.is_guest, 0) = 0
                    """,
                    (group_id, DEFAULT_USER_ID),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM users WHERE id <> ? AND COALESCE(is_guest, 0) = 0 ORDER BY created_at",
                    (DEFAULT_USER_ID,),
                ).fetchall()
            entries = []
            for row in rows:
                user = dict(row)
                score = self.score_breakdown(user["id"], period, connection)
                entries.append(
                    {
                        "userId": user["id"],
                        "handle": user["handle"],
                        "displayName": user.get("displayName") or user.get("display_name") or user["handle"],
                        "score": score["score"],
                        "validFocusMinutes": score["validFocusMinutes"],
                        "completedTaskWeight": score["completedTaskWeight"],
                        "scoredTaskWeight": score.get("scoredTaskWeight", score["completedTaskWeight"]),
                        "suspiciousCount": score.get("suspiciousCount", 0),
                        "validation": score["validation"],
                        "trustScore": score.get("trustScore", 100),
                    }
                )
            entries.sort(key=lambda item: (-item["score"], -item.get("trustScore", 100), -item["validFocusMinutes"], -item["scoredTaskWeight"], item["suspiciousCount"], item["handle"]))
            for index, entry in enumerate(entries, start=1):
                entry["rank"] = index
            return entries

    def group_members(self, group_id: str, viewer_user_id: str | None) -> list[dict[str, Any]]:
        with self._lock, self._connect() as connection:
            viewer = self.ensure_user(viewer_user_id, connection)
            if not self._group_role(connection, group_id, viewer["id"]):
                raise HTTPException(status_code=403, detail="Join the group before viewing members")
            rows = connection.execute(
                """
                SELECT users.id, users.handle, users.display_name, group_members.role, group_members.joined_at
                FROM group_members
                JOIN users ON users.id = group_members.user_id
                WHERE group_members.group_id = ?
                ORDER BY CASE group_members.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, group_members.joined_at
                """,
                (group_id,),
            ).fetchall()
            return [
                {
                    "userId": row["id"],
                    "handle": row["handle"],
                    "displayName": row["display_name"],
                    "role": row["role"],
                    "joinedAt": row["joined_at"],
                }
                for row in rows
            ]

    def patch_group(self, group_id: str, viewer_user_id: str | None, name: str | None = None) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            viewer = self.ensure_user(viewer_user_id, connection)
            self._require_group_admin(connection, group_id, viewer["id"])
            clean_name = str(name or "").strip()
            if clean_name:
                connection.execute("UPDATE groups SET name = ? WHERE id = ?", (clean_name, group_id))
                self.log_security_event(connection, viewer["id"], "group_updated", group_id)
            connection.commit()
            return self._group(connection, group_id, viewer["id"])

    def delete_group(self, group_id: str, viewer_user_id: str | None) -> None:
        with self._lock, self._connect() as connection:
            viewer = self.ensure_user(viewer_user_id, connection)
            role = self._group_role(connection, group_id, viewer["id"])
            if not role:
                raise HTTPException(status_code=404, detail="Group not found")
            if role != "owner":
                raise HTTPException(status_code=403, detail="Only the owner can delete a group")
            connection.execute("DELETE FROM group_members WHERE group_id = ?", (group_id,))
            connection.execute("DELETE FROM groups WHERE id = ?", (group_id,))
            self.log_security_event(connection, viewer["id"], "group_deleted", group_id)
            connection.commit()

    def regenerate_group_invite(self, group_id: str, viewer_user_id: str | None) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            viewer = self.ensure_user(viewer_user_id, connection)
            self._require_group_admin(connection, group_id, viewer["id"])
            join_code = self._join_code(connection)
            connection.execute("UPDATE groups SET join_code = ? WHERE id = ?", (join_code, group_id))
            self.log_security_event(connection, viewer["id"], "group_invite_regenerated", group_id)
            connection.commit()
            return self._group(connection, group_id, viewer["id"])

    def update_group_member_role(self, group_id: str, viewer_user_id: str | None, member_user_id: str, role: str) -> list[dict[str, Any]]:
        role = role if role in {"admin", "member"} else "member"
        with self._lock, self._connect() as connection:
            viewer = self.ensure_user(viewer_user_id, connection)
            self._require_group_admin(connection, group_id, viewer["id"])
            target_role = self._group_role(connection, group_id, member_user_id)
            if not target_role:
                raise HTTPException(status_code=404, detail="Member not found")
            if target_role == "owner":
                raise HTTPException(status_code=403, detail="Owner role cannot be changed")
            connection.execute("UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?", (role, group_id, member_user_id))
            self.log_security_event(connection, viewer["id"], "group_member_role_updated", member_user_id, {"groupId": group_id, "role": role})
            connection.commit()
            return self.group_members(group_id, viewer["id"])

    def remove_group_member(self, group_id: str, viewer_user_id: str | None, member_user_id: str) -> list[dict[str, Any]]:
        with self._lock, self._connect() as connection:
            viewer = self.ensure_user(viewer_user_id, connection)
            viewer_role = self._group_role(connection, group_id, viewer["id"])
            target_role = self._group_role(connection, group_id, member_user_id)
            if not target_role:
                raise HTTPException(status_code=404, detail="Member not found")
            if member_user_id != viewer["id"] and viewer_role not in {"owner", "admin"}:
                raise HTTPException(status_code=403, detail="Only admins can remove members")
            if target_role == "owner":
                raise HTTPException(status_code=403, detail="Owner cannot be removed")
            connection.execute("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", (group_id, member_user_id))
            self.log_security_event(connection, viewer["id"], "group_member_removed", member_user_id, {"groupId": group_id})
            connection.commit()
            if member_user_id == viewer["id"]:
                return []
            return self.group_members(group_id, viewer["id"])

    def score_summary(self, user_id: str | None) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            return {
                "today": self.score_breakdown(user["id"], "day", connection),
                "week": self.score_breakdown(user["id"], "week", connection),
                "month": self.score_breakdown(user["id"], "month", connection),
                "year": self.score_breakdown(user["id"], "year", connection),
            }

    def score_breakdown(self, user_id: str, period: str = "day", connection: sqlite3.Connection | None = None) -> dict[str, Any]:
        own_connection = connection is None
        connection = connection or self._connect()
        try:
            state = self._read_user_state(connection, user_id)
            start, end = self._period_bounds(period)
            relevant_tasks = []
            completed_ids = set()
            suspicious_count = 0
            for row in connection.execute(
                "SELECT * FROM activity_events WHERE user_id = ? AND created_at >= ? AND created_at < ?",
                (user_id, start.isoformat(), end.isoformat()),
            ):
                if row["suspicious"]:
                    suspicious_count += 1
                if row["type"] == "task_completed" and not row["suspicious"]:
                    completed_ids.add(row["target_id"])
            for task in state.tasks:
                task_date = parse_date(task.date) or parse_date(task.createdAt)
                completed_at = parse_date(task.completedAt)
                if (task_date and start.date() <= task_date < end.date()) or task.id in completed_ids or (completed_at and start.date() <= completed_at < end.date()):
                    relevant_tasks.append(task)
                    if task.done and task.id not in completed_ids and completed_at and start.date() <= completed_at < end.date():
                        completed_ids.add(task.id)
            period_days = max((end.date() - start.date()).days, 1)
            total_task_weight = sum(task_weight(task.priority) for task in relevant_tasks)
            raw_completed_tasks = [task for task in relevant_tasks if task.id in completed_ids or task.done]
            raw_completed_task_weight = sum(task_weight(task.priority) for task in raw_completed_tasks)
            created_task_count = len([
                task for task in relevant_tasks
                if (parse_date(task.createdAt) or parse_date(task.date)) and start.date() <= (parse_date(task.createdAt) or parse_date(task.date)) < end.date()
            ])
            duplicate_titles = 0
            micro_task_count = 0
            seen_task_keys: set[str] = set()
            scored_task_weight = 0.0
            low_task_weight = 0.0
            scored_task_count = 0
            task_goal_weight = DAILY_TASK_GOAL_WEIGHT * period_days
            task_score_cap = DAILY_TASK_SCORE_CAP * period_days
            task_count_cap = DAILY_TASK_COUNT_CAP * period_days
            low_task_cap = DAILY_LOW_TASK_WEIGHT_CAP * period_days

            for task in sorted(raw_completed_tasks, key=lambda item: (task_weight(item.priority), str(item.completedAt or item.date or "")), reverse=True):
                key = task_key(task.title)
                if key and key in seen_task_keys:
                    duplicate_titles += 1
                    continue
                if key:
                    seen_task_keys.add(key)
                if scored_task_count >= task_count_cap or scored_task_weight >= task_score_cap:
                    break

                weight = task_weight(task.priority)
                if str(task.priority or "").lower() in {"low", "new"}:
                    remaining_low_weight = max(low_task_cap - low_task_weight, 0)
                    if remaining_low_weight <= 0:
                        continue
                    weight = min(weight, remaining_low_weight)
                    low_task_weight += weight
                if is_micro_task(task.title, task.meta):
                    micro_task_count += 1
                    weight *= 0.35

                remaining_weight = max(task_score_cap - scored_task_weight, 0)
                scored_task_weight += min(weight, remaining_weight)
                scored_task_count += 1

            task_spam_flags = 0
            if len(raw_completed_tasks) > DAILY_COMPLETED_TASK_LIMIT * period_days:
                task_spam_flags += 1
            if duplicate_titles >= max(2, period_days):
                task_spam_flags += 1
            if micro_task_count >= max(4, 3 * period_days):
                task_spam_flags += 1
            suspicious_count += task_spam_flags
            task_points = round(min(scored_task_weight / task_goal_weight, 1) * TASK_POINT_MAX) if task_goal_weight else 0

            focus_rows = connection.execute(
                """
                SELECT * FROM focus_sessions
                WHERE user_id = ? AND ended_at >= ? AND ended_at < ? AND suspicious = 0 AND status = 'completed'
                """,
                (user_id, start.isoformat(), end.isoformat()),
            ).fetchall()
            invalid_focus_count = connection.execute(
                """
                SELECT COUNT(*) FROM focus_sessions
                WHERE user_id = ? AND ended_at >= ? AND ended_at < ? AND suspicious = 1
                """,
                (user_id, start.isoformat(), end.isoformat()),
            ).fetchone()[0]
            valid_focus_minutes = min(sum(int(row["valid_minutes"] or 0) for row in focus_rows), 8 * 25 * max((end.date() - start.date()).days, 1))
            focus_goal_minutes = max(state.profile.dailyFocusGoal, 1) * 25 * period_days
            focus_points = round(min(valid_focus_minutes / focus_goal_minutes, 1) * FOCUS_POINT_MAX) if focus_goal_minutes else 0
            consistency_points = CONSISTENCY_POINT_MAX if task_points >= 24 and focus_points >= 32 and suspicious_count == 0 else 10 if (task_points >= 24 or focus_points >= 32) and suspicious_count == 0 else 0
            spam_penalty = min(25, suspicious_count * 6)
            score = max(0, min(100, task_points + focus_points + consistency_points - spam_penalty))
            validation_reasons = []
            if scored_task_count >= task_count_cap:
                validation_reasons.append(f"Only the first {task_count_cap} meaningful completed tasks can score in this period.")
            if scored_task_weight >= task_score_cap:
                validation_reasons.append(f"Task weight is capped at {round(task_score_cap, 2)} for this period.")
            if duplicate_titles:
                validation_reasons.append(f"{duplicate_titles} duplicate task title{'s' if duplicate_titles != 1 else ''} excluded.")
            if micro_task_count:
                validation_reasons.append(f"{micro_task_count} micro task{'s' if micro_task_count != 1 else ''} down-weighted.")
            if invalid_focus_count:
                validation_reasons.append(f"{invalid_focus_count} short or suspicious focus session{'s' if invalid_focus_count != 1 else ''} excluded.")
            if task_spam_flags:
                validation_reasons.append("Completed-task pattern looks spammy, so trust was reduced.")
            if created_task_count > DAILY_CREATED_TASK_LIMIT * period_days:
                validation_reasons.append("Planning many tasks is allowed; only completed work affects rank and penalties.")
            if not validation_reasons:
                validation_reasons.append("Clean activity trail. No scoring penalties were applied.")
            trust_score = max(0, min(100, 100 - (spam_penalty * 2) - (invalid_focus_count * 8) - (duplicate_titles * 4) - (micro_task_count * 2)))
            trust_label = "High trust" if trust_score >= 85 else "Needs review" if trust_score >= 60 else "Low trust"
            validation = "Review" if task_spam_flags else "Clean"
            if suspicious_count and not task_spam_flags:
                validation = "Review"
            if task_spam_flags:
                validation = "Spam risk"
            breakdown = {
                "period": period,
                "score": score,
                "taskPoints": task_points,
                "focusPoints": focus_points,
                "consistencyPoints": consistency_points,
                "completedTaskWeight": round(raw_completed_task_weight, 2),
                "totalTaskWeight": round(total_task_weight, 2),
                "scoredTaskWeight": round(scored_task_weight, 2),
                "taskGoalWeight": round(task_goal_weight, 2),
                "taskScoreCap": round(task_score_cap, 2),
                "scoredTaskCount": scored_task_count,
                "completedTaskCount": len(raw_completed_tasks),
                "createdTaskCount": created_task_count,
                "duplicateTaskCount": duplicate_titles,
                "microTaskCount": micro_task_count,
                "invalidFocusCount": invalid_focus_count,
                "spamPenalty": spam_penalty,
                "validFocusMinutes": valid_focus_minutes,
                "focusGoalMinutes": focus_goal_minutes,
                "suspiciousCount": suspicious_count,
                "validation": validation,
                "trustScore": trust_score,
                "trustLabel": trust_label,
                "validationReasons": validation_reasons,
                "whyThisChanged": [
                    f"Tasks contributed {task_points}/{TASK_POINT_MAX} points.",
                    f"Focus contributed {focus_points}/{FOCUS_POINT_MAX} points.",
                    f"Consistency contributed {consistency_points}/{CONSISTENCY_POINT_MAX} points.",
                    f"Penalties removed {spam_penalty} points.",
                ],
            }
            if period == "day":
                connection.execute(
                    "INSERT OR REPLACE INTO score_entries(user_id, day, data) VALUES(?, ?, ?)",
                    (user_id, start.date().isoformat(), json.dumps(breakdown, separators=(",", ":"))),
                )
                if own_connection:
                    connection.commit()
            return breakdown
        finally:
            if own_connection:
                connection.close()

    def start_focus_session(self, user_id: str | None, planned_minutes: int = 25) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            self._lock_focus_user(connection, user["id"])
            active = connection.execute(
                "SELECT * FROM focus_sessions WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1",
                (user["id"],),
            ).fetchone()
            if active:
                state = self._read_user_state(connection, user["id"])
                if not state.focus.running:
                    paused_at = parse_datetime(active["paused_at"])
                    paused = max(int((datetime.now(timezone.utc) - paused_at).total_seconds()), 0) if paused_at else 0
                    connection.execute("UPDATE focus_sessions SET paused_seconds = paused_seconds + ?, paused_at = '' WHERE id = ?", (paused, active["id"]))
                    state.focus.running = True
                    state.focus.deadlineAt = int(datetime.now(timezone.utc).timestamp() * 1000) + state.focus.secondsLeft * 1000
                    self._replace_user_state(connection, user["id"], state)
                    connection.commit()
                return dict(active)
            session_id = secure_id("foc")
            connection.execute(
                "INSERT INTO focus_sessions(id, user_id, started_at, planned_minutes, status, suspicious) VALUES(?, ?, ?, ?, ?, 0)",
                (session_id, user["id"], now_iso(), max(int(planned_minutes or 25), 5), "active"),
            )
            state = self._read_user_state(connection, user["id"])
            state.focus.running = True
            state.focus.activeSessionId = session_id
            if state.focus.secondsLeft <= 0:
                state.focus.secondsLeft = 25 * 60
            state.focus.deadlineAt = int(datetime.now(timezone.utc).timestamp() * 1000) + state.focus.secondsLeft * 1000
            self._replace_user_state(connection, user["id"], state)
            connection.commit()
            return dict(connection.execute("SELECT * FROM focus_sessions WHERE id = ?", (session_id,)).fetchone())

    def complete_focus_session(self, user_id: str | None, session_id: str | None = None) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            self._lock_focus_user(connection, user["id"])
            if session_id:
                row = connection.execute(
                    "SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?",
                    (session_id, user["id"]),
                ).fetchone()
            else:
                row = connection.execute(
                    "SELECT * FROM focus_sessions WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1",
                    (user["id"],),
                ).fetchone()
            if not row:
                return {"session": None, "state": model_to_dict(self._read_user_state(connection, user["id"]))}
            if row["status"] != "active":
                return {"session": dict(row), "state": model_to_dict(self._read_user_state(connection, user["id"]))}
            started = parse_datetime(row["started_at"]) or datetime.now(timezone.utc)
            ended = datetime.now(timezone.utc)
            paused_at = parse_datetime(row["paused_at"])
            paused = int(row["paused_seconds"]) + (max((ended - paused_at).total_seconds(), 0) if paused_at else 0)
            elapsed_minutes = max(round(((ended - started).total_seconds() - paused) / 60), 0)
            suspicious = elapsed_minutes < 10
            valid_minutes = 0 if suspicious else min(elapsed_minutes, int(row["planned_minutes"] or 25), 120)
            status = "flagged" if suspicious else "completed"
            connection.execute(
                "UPDATE focus_sessions SET ended_at = ?, valid_minutes = ?, status = ?, suspicious = ? WHERE id = ?",
                (ended.isoformat(), valid_minutes, status, 1 if suspicious else 0, row["id"]),
            )
            self.log_activity(user["id"], "focus_completed", row["id"], {"validMinutes": valid_minutes}, suspicious, connection)
            state = self._read_user_state(connection, user["id"])
            state.focus.running = False
            state.focus.activeSessionId = ""
            state.focus.deadlineAt = 0
            state.focus.secondsLeft = 0
            if not suspicious:
                state.focus.completed += 1
            self._replace_user_state(connection, user["id"], state)
            self.score_breakdown(user["id"], "day", connection)
            connection.commit()
            return {"session": dict(connection.execute("SELECT * FROM focus_sessions WHERE id = ?", (row["id"],)).fetchone()), "state": model_to_dict(state)}

    def _lock_focus_user(self, connection, user_id: str) -> None:
        # SQLite's process lock is held by the caller. Postgres overrides this.
        pass

    def pause_focus(self, user_id: str | None, updates: dict) -> OrbitState:
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            self._lock_focus_user(connection, user["id"])
            state = self._read_user_state(connection, user["id"])
            connection.execute("UPDATE focus_sessions SET paused_at = ? WHERE user_id = ? AND status = 'active' AND paused_at = ''", (now_iso(), user["id"]))
            from .models import normalize_focus
            state.focus = normalize_focus({**model_to_dict(state.focus), **updates, "running": False, "deadlineAt": 0})
            self._replace_user_state(connection, user["id"], state)
            connection.commit()
            return state

    def reset_focus(self, user_id: str | None) -> OrbitState:
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            self._lock_focus_user(connection, user["id"])
            connection.execute("UPDATE focus_sessions SET status = 'cancelled', ended_at = ? WHERE user_id = ? AND status = 'active'", (now_iso(), user["id"]))
            state = self._read_user_state(connection, user["id"])
            state.focus.running = False
            state.focus.secondsLeft = 25 * 60
            state.focus.activeSessionId = ""
            state.focus.deadlineAt = 0
            self._replace_user_state(connection, user["id"], state)
            connection.commit()
            return state

    def log_activity(self, user_id: str, event_type: str, target_id: str, data: dict[str, Any] | None = None, suspicious: bool = False, connection: sqlite3.Connection | None = None) -> None:
        own_connection = connection is None
        connection = connection or self._connect()
        connection.execute(
            "INSERT INTO activity_events(id, user_id, type, target_id, created_at, suspicious, data) VALUES(?, ?, ?, ?, ?, ?, ?)",
            (secure_id("act"), user_id, event_type, target_id, now_iso(), 1 if suspicious else 0, json.dumps(data or {}, separators=(",", ":"))),
        )
        if own_connection:
            connection.commit()
            connection.close()

    def log_security_event(self, connection: sqlite3.Connection, user_id: str, event_type: str, target_id: str = "", data: dict[str, Any] | None = None) -> None:
        connection.execute(
            "INSERT INTO security_events(id, user_id, type, target_id, created_at, ip_address, data) VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                secure_id("sec"),
                user_id or "",
                event_type,
                target_id or "",
                now_iso(),
                str((data or {}).get("ip") or ""),
                json.dumps(data or {}, separators=(",", ":")),
            ),
        )

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _ensure_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS routines (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS integrations (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS focus (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS profile (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    handle TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    timezone TEXT NOT NULL,
                    is_guest INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS auth_accounts (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    provider_subject TEXT NOT NULL,
                    email TEXT NOT NULL DEFAULT '',
                    display_name TEXT NOT NULL DEFAULT '',
                    avatar TEXT NOT NULL DEFAULT '',
                    linked_at TEXT NOT NULL,
                    last_login_at TEXT NOT NULL,
                    UNIQUE(provider, provider_subject)
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    token_hash TEXT UNIQUE NOT NULL,
                    user_id TEXT NOT NULL,
                    csrf_token TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    idle_expires_at TEXT NOT NULL,
                    absolute_expires_at TEXT NOT NULL,
                    revoked_at TEXT NOT NULL DEFAULT '',
                    user_agent TEXT NOT NULL DEFAULT '',
                    ip_address TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS oauth_states (
                    state TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    code_verifier TEXT NOT NULL,
                    nonce TEXT NOT NULL,
                    redirect_to TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    used_at TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS security_events (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT '',
                    type TEXT NOT NULL,
                    target_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    ip_address TEXT NOT NULL DEFAULT '',
                    data TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS user_states (
                    user_id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    join_code TEXT UNIQUE NOT NULL,
                    owner_user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS group_members (
                    group_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    joined_at TEXT NOT NULL,
                    PRIMARY KEY(group_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS focus_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT NOT NULL DEFAULT '',
                    planned_minutes INTEGER NOT NULL DEFAULT 25,
                    valid_minutes INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active',
                    suspicious INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS activity_events (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    suspicious INTEGER NOT NULL DEFAULT 0,
                    data TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS score_entries (
                    user_id TEXT NOT NULL,
                    day TEXT NOT NULL,
                    data TEXT NOT NULL,
                    PRIMARY KEY(user_id, day)
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
                CREATE INDEX IF NOT EXISTS idx_auth_accounts_user ON auth_accounts(user_id);
                CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
                CREATE INDEX IF NOT EXISTS idx_activity_events_user_time ON activity_events(user_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_time ON focus_sessions(user_id, started_at);
                """
            )
            self._ensure_user_guest_column(connection)
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(oauth_states)")}
            if "guest_user_id" not in columns:
                connection.execute("ALTER TABLE oauth_states ADD COLUMN guest_user_id TEXT NOT NULL DEFAULT ''")
            focus_columns = {row["name"] for row in connection.execute("PRAGMA table_info(focus_sessions)")}
            if "paused_at" not in focus_columns:
                connection.execute("ALTER TABLE focus_sessions ADD COLUMN paused_at TEXT NOT NULL DEFAULT ''")
            if "paused_seconds" not in focus_columns:
                connection.execute("ALTER TABLE focus_sessions ADD COLUMN paused_seconds INTEGER NOT NULL DEFAULT 0")
            self._ensure_seed(connection)

    def _ensure_user_guest_column(self, connection: sqlite3.Connection) -> None:
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()}
        if "is_guest" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0")
        connection.execute(
            """
            UPDATE users
            SET is_guest = 1
            WHERE id <> ?
              AND (LOWER(handle) LIKE 'guest-%' OR LOWER(display_name) = 'guest')
              AND NOT EXISTS (SELECT 1 FROM auth_accounts WHERE auth_accounts.user_id = users.id)
            """,
            (DEFAULT_USER_ID,),
        )
        connection.execute("UPDATE users SET is_guest = 0 WHERE EXISTS (SELECT 1 FROM auth_accounts WHERE auth_accounts.user_id = users.id)")

    def _ensure_seed(self, connection: sqlite3.Connection) -> None:
        user_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if user_count:
            return
        state = self.read_legacy_state(connection)
        created_at = now_iso()
        connection.execute(
            "INSERT INTO users(id, handle, display_name, created_at, timezone, is_guest) VALUES(?, ?, ?, ?, ?, ?)",
            (
                DEFAULT_USER_ID,
                clean_handle(state.profile.handle),
                state.profile.name or state.profile.handle or "Samarth Mishra",
                created_at,
                state.profile.timezone or "Asia/Calcutta",
                0,
            ),
        )
        self._replace_user_state(connection, DEFAULT_USER_ID, state)
        connection.commit()

    def _ensure_legacy_seed(self, connection: sqlite3.Connection) -> None:
        task_count = connection.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        if task_count:
            return
        legacy_path = self.path.with_name("orbit.json")
        if legacy_path.exists():
            try:
                legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
                state = normalize_state({**model_to_dict(default_state()), **legacy})
            except (OSError, json.JSONDecodeError):
                state = default_state()
        else:
            state = default_state()
        self._replace_preferences(connection, state)
        self._replace_table(connection, "tasks", [model_to_dict(task) for task in state.tasks])
        self._replace_table(connection, "notes", [model_to_dict(note) for note in state.notes])
        self._replace_table(connection, "routines", [model_to_dict(routine) for routine in state.routines])
        self._replace_table(connection, "events", [model_to_dict(event) for event in state.events])
        self._replace_table(connection, "integrations", [model_to_dict(item) for item in state.integrations])
        self._replace_single(connection, "focus", "focus", model_to_dict(state.focus))
        self._replace_single(connection, "profile", "profile", model_to_dict(state.profile))
        connection.commit()

    def ensure_user(self, user_id: str | None, connection: sqlite3.Connection) -> dict[str, Any]:
        self._ensure_seed(connection)
        if user_id:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if row:
                return self._user_row(row)
        row = connection.execute("SELECT * FROM users WHERE id = ?", (DEFAULT_USER_ID,)).fetchone()
        if row:
            return self._user_row(row)
        state = default_state()
        created_at = now_iso()
        connection.execute(
            "INSERT INTO users(id, handle, display_name, created_at, timezone, is_guest) VALUES(?, ?, ?, ?, ?, ?)",
            (DEFAULT_USER_ID, state.profile.handle, state.profile.name, created_at, state.profile.timezone, 0),
        )
        self._replace_user_state(connection, DEFAULT_USER_ID, state)
        connection.commit()
        return {
            "id": DEFAULT_USER_ID,
            "handle": state.profile.handle,
            "displayName": state.profile.name,
            "createdAt": created_at,
            "timezone": state.profile.timezone,
        }

    def _user_row(self, row: sqlite3.Row) -> dict[str, Any]:
        columns = set(row.keys()) if hasattr(row, "keys") else set()
        inferred_guest = str(row["handle"]).lower().startswith("guest-") or str(row["display_name"]).lower() == "guest"
        is_guest = bool(row["is_guest"]) if "is_guest" in columns else inferred_guest
        return {
            "id": row["id"],
            "handle": row["handle"],
            "displayName": row["display_name"],
            "createdAt": row["created_at"],
            "timezone": row["timezone"],
            "isGuest": is_guest,
        }

    def _read_user_state(self, connection: sqlite3.Connection, user_id: str) -> OrbitState:
        row = connection.execute("SELECT data FROM user_states WHERE user_id = ?", (user_id,)).fetchone()
        if row:
            return normalize_state(json.loads(row["data"]))
        state = default_state()
        self._replace_user_state(connection, user_id, state)
        return state

    def _replace_user_state(self, connection: sqlite3.Connection, user_id: str, state: OrbitState) -> None:
        connection.execute(
            "INSERT OR REPLACE INTO user_states(user_id, data) VALUES(?, ?)",
            (user_id, json.dumps(model_to_dict(normalize_state(model_to_dict(state))), separators=(",", ":"))),
        )

    def _sync_user_from_profile(self, connection: sqlite3.Connection, user_id: str, state: OrbitState) -> None:
        handle = clean_handle(state.profile.handle)
        self._ensure_handle_available_for_user(connection, handle, user_id)
        connection.execute(
            "UPDATE users SET handle = ?, display_name = ?, timezone = ? WHERE id = ?",
            (
                handle,
                state.profile.name or state.profile.handle,
                state.profile.timezone or "Asia/Calcutta",
                user_id,
            ),
        )

    def _ensure_handle_available_for_user(self, connection: sqlite3.Connection, handle: str, user_id: str) -> None:
        row = connection.execute("SELECT id FROM users WHERE handle = ? AND id <> ?", (handle, user_id)).fetchone()
        if row:
            raise HTTPException(status_code=409, detail="Handle is already taken")

    def _available_handle(self, connection: sqlite3.Connection, seed: str) -> str:
        base = clean_handle(seed)[:20] or "orbit-user"
        handle = base
        index = 2
        while connection.execute("SELECT 1 FROM users WHERE handle = ?", (handle,)).fetchone():
            suffix = f"-{index}"
            handle = f"{base[:24 - len(suffix)]}{suffix}"
            index += 1
        return handle

    def _group(self, connection: sqlite3.Connection, group_id: str, user_id: str) -> dict[str, Any]:
        row = connection.execute(
            """
            SELECT groups.*, group_members.role,
                   (SELECT COUNT(*) FROM group_members WHERE group_members.group_id = groups.id) AS member_count
            FROM groups
            JOIN group_members ON group_members.group_id = groups.id AND group_members.user_id = ?
            WHERE groups.id = ?
            """,
            (user_id, group_id),
        ).fetchone()
        if not row:
            return {}
        return {
            "id": row["id"],
            "name": row["name"],
            "joinCode": row["join_code"],
            "ownerUserId": row["owner_user_id"],
            "createdAt": row["created_at"],
            "role": row["role"],
            "memberCount": row["member_count"],
            "canManage": row["role"] in {"owner", "admin"},
        }

    def _group_role(self, connection: sqlite3.Connection, group_id: str, user_id: str) -> str:
        row = connection.execute(
            "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
            (group_id, user_id),
        ).fetchone()
        return str(row["role"]) if row else ""

    def _require_group_admin(self, connection: sqlite3.Connection, group_id: str, user_id: str) -> None:
        role = self._group_role(connection, group_id, user_id)
        if role not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="Only group owners and admins can do that")

    def _join_code(self, connection: sqlite3.Connection) -> str:
        code = secure_join_code()
        while connection.execute("SELECT 1 FROM groups WHERE join_code = ?", (code,)).fetchone():
            code = secure_join_code()
        return code

    def _period_bounds(self, period: str) -> tuple[datetime, datetime]:
        today = date.today()
        if period == "week":
            start_day = today - timedelta(days=today.weekday())
            end_day = start_day + timedelta(days=7)
        elif period == "month":
            start_day = today.replace(day=1)
            end_day = (start_day.replace(year=start_day.year + 1, month=1) if start_day.month == 12 else start_day.replace(month=start_day.month + 1))
        elif period == "year":
            start_day = today.replace(month=1, day=1)
            end_day = start_day.replace(year=start_day.year + 1)
        else:
            start_day = today
            end_day = today + timedelta(days=1)
        return (
            datetime.combine(start_day, datetime.min.time(), tzinfo=timezone.utc),
            datetime.combine(end_day, datetime.min.time(), tzinfo=timezone.utc),
        )

    def _preference(self, connection: sqlite3.Connection, key: str, fallback: str) -> str:
        row = connection.execute("SELECT value FROM preferences WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else fallback

    def _rows(self, connection: sqlite3.Connection, table: str) -> list[dict]:
        return [
            json.loads(row["data"])
            for row in connection.execute(f"SELECT data FROM {table} ORDER BY rowid")
        ]

    def _focus(self, connection: sqlite3.Connection) -> dict:
        row = connection.execute("SELECT data FROM focus WHERE id = 'focus'").fetchone()
        return json.loads(row["data"]) if row else {}

    def _profile(self, connection: sqlite3.Connection) -> dict:
        row = connection.execute("SELECT data FROM profile WHERE id = 'profile'").fetchone()
        return json.loads(row["data"]) if row else {}

    def _replace_preferences(self, connection: sqlite3.Connection, state: OrbitState) -> None:
        connection.executemany(
            "INSERT OR REPLACE INTO preferences(key, value) VALUES(?, ?)",
            [("theme", state.theme), ("activeView", state.activeView)],
        )

    def _replace_table(self, connection: sqlite3.Connection, table: str, rows: list[dict]) -> None:
        connection.execute(f"DELETE FROM {table}")
        connection.executemany(
            f"INSERT OR REPLACE INTO {table}(id, data) VALUES(?, ?)",
            [(row["id"], json.dumps(row, separators=(",", ":"))) for row in rows],
        )

    def _replace_single(self, connection: sqlite3.Connection, table: str, item_id: str, data: dict) -> None:
        connection.execute(f"DELETE FROM {table}")
        connection.execute(
            f"INSERT OR REPLACE INTO {table}(id, data) VALUES(?, ?)",
            (item_id, json.dumps(data, separators=(",", ":"))),
        )
