from __future__ import annotations

import json
from threading import RLock
from typing import Any

from fastapi import HTTPException

from .models import default_state, model_to_dict, normalize_state
from .sqlite_store import DEFAULT_USER_ID, SqliteStateStore, clean_handle, now_iso


class PgRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PgResult:
    def __init__(self, rows: list[PgRow] | None = None):
        self._rows = rows or []

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows

    def __iter__(self):
        return iter(self._rows)


class PgConnection:
    def __init__(self, raw_connection):
        self.raw_connection = raw_connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        if exc_type:
            self.raw_connection.rollback()
        else:
            self.raw_connection.commit()
        self.close()

    def close(self):
        self.raw_connection.close()

    def commit(self):
        self.raw_connection.commit()

    def execute(self, sql: str, params: tuple | list = ()):
        translated = translate_sql(sql)
        with self.raw_connection.cursor() as cursor:
            cursor.execute(translated, tuple(params or ()))
            if cursor.description is None:
                return PgResult()
            columns = [column.name for column in cursor.description]
            return PgResult([PgRow(zip(columns, row)) for row in cursor.fetchall()])

    def executemany(self, sql: str, params_list: list[tuple] | tuple[tuple, ...]):
        translated = translate_sql(sql)
        with self.raw_connection.cursor() as cursor:
            cursor.executemany(translated, params_list)
        return PgResult()


def normalize_database_url(value: str) -> str:
    if value.startswith("postgres://"):
        return f"postgresql://{value[len('postgres://'):]}"
    return value


def translate_sql(sql: str) -> str:
    clean = " ".join(sql.strip().split())
    translated = sql.replace("%", "%%").replace("?", "%s")

    if clean.startswith("INSERT OR IGNORE INTO group_members"):
        return translated.replace("INSERT OR IGNORE INTO", "INSERT INTO", 1) + " ON CONFLICT(group_id, user_id) DO NOTHING"

    if clean.startswith("INSERT OR REPLACE INTO group_members"):
        return translated.replace("INSERT OR REPLACE INTO", "INSERT INTO", 1) + " ON CONFLICT(group_id, user_id) DO UPDATE SET role = EXCLUDED.role, joined_at = EXCLUDED.joined_at"

    if clean.startswith("INSERT OR REPLACE INTO user_states"):
        return translated.replace("INSERT OR REPLACE INTO", "INSERT INTO", 1) + " ON CONFLICT(user_id) DO UPDATE SET data = EXCLUDED.data"

    if clean.startswith("INSERT OR REPLACE INTO score_entries"):
        return translated.replace("INSERT OR REPLACE INTO", "INSERT INTO", 1) + " ON CONFLICT(user_id, day) DO UPDATE SET data = EXCLUDED.data"

    if clean.startswith("INSERT OR REPLACE INTO preferences"):
        return translated.replace("INSERT OR REPLACE INTO", "INSERT INTO", 1) + " ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value"

    if clean.startswith("INSERT OR REPLACE INTO") and "(id, data)" in clean:
        return translated.replace("INSERT OR REPLACE INTO", "INSERT INTO", 1) + " ON CONFLICT(id) DO UPDATE SET data = EXCLUDED.data"

    return translated


class PostgresStateStore(SqliteStateStore):
    def __init__(self, url: str):
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError("Postgres support requires psycopg. Install requirements.txt first.") from error

        self.url = normalize_database_url(url)
        self._psycopg = psycopg
        self._lock = RLock()
        self._ensure_schema()

    def _connect(self) -> PgConnection:
        return PgConnection(self._psycopg.connect(self.url, connect_timeout=10, prepare_threshold=None))

    def update(self, updater, user_id=None):
        # A process-local lock cannot protect state across Vercel instances.
        with self._lock, self._connect() as connection:
            user = self.ensure_user(user_id, connection)
            self._lock_focus_user(connection, user["id"])
            connection.execute("SELECT user_id FROM user_states WHERE user_id = ? FOR UPDATE", (user["id"],)).fetchone()
            state = self._read_user_state(connection, user["id"])
            clean_state = normalize_state(model_to_dict(updater(state)))
            self._replace_user_state(connection, user["id"], clean_state)
            self._sync_user_from_profile(connection, user["id"], clean_state)
            return clean_state

    def _lock_focus_user(self, connection, user_id: str) -> None:
        # Allow foreign-key checks in activity logging while serializing state writers.
        connection.execute("SELECT id FROM users WHERE id = ? FOR NO KEY UPDATE", (user_id,)).fetchone()

    def _ensure_schema(self) -> None:
        with self._connect() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(56721167)")
            statements = [
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    handle TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    timezone TEXT NOT NULL,
                    is_guest INTEGER NOT NULL DEFAULT 0
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS auth_accounts (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    provider TEXT NOT NULL,
                    provider_subject TEXT NOT NULL,
                    email TEXT NOT NULL DEFAULT '',
                    display_name TEXT NOT NULL DEFAULT '',
                    avatar TEXT NOT NULL DEFAULT '',
                    linked_at TEXT NOT NULL,
                    last_login_at TEXT NOT NULL,
                    UNIQUE(provider, provider_subject)
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    token_hash TEXT UNIQUE NOT NULL,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    csrf_token TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    idle_expires_at TEXT NOT NULL,
                    absolute_expires_at TEXT NOT NULL,
                    revoked_at TEXT NOT NULL DEFAULT '',
                    user_agent TEXT NOT NULL DEFAULT '',
                    ip_address TEXT NOT NULL DEFAULT ''
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS oauth_states (
                    state TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    code_verifier TEXT NOT NULL,
                    nonce TEXT NOT NULL,
                    redirect_to TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    used_at TEXT NOT NULL DEFAULT ''
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS security_events (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT '',
                    type TEXT NOT NULL,
                    target_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    ip_address TEXT NOT NULL DEFAULT '',
                    data TEXT NOT NULL DEFAULT '{}'
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS user_states (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    data TEXT NOT NULL
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    join_code TEXT UNIQUE NOT NULL,
                    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS group_members (
                    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    joined_at TEXT NOT NULL,
                    PRIMARY KEY(group_id, user_id)
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS focus_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    started_at TEXT NOT NULL,
                    ended_at TEXT NOT NULL DEFAULT '',
                    planned_minutes INTEGER NOT NULL DEFAULT 25,
                    valid_minutes INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active',
                    suspicious INTEGER NOT NULL DEFAULT 0
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS activity_events (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    suspicious INTEGER NOT NULL DEFAULT 0,
                    data TEXT NOT NULL DEFAULT '{}'
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS score_entries (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    day TEXT NOT NULL,
                    data TEXT NOT NULL,
                    PRIMARY KEY(user_id, day)
                )
                """,
                "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
                "CREATE INDEX IF NOT EXISTS idx_sessions_token_active ON sessions(token_hash) WHERE revoked_at = ''",
                "CREATE INDEX IF NOT EXISTS idx_auth_accounts_user ON auth_accounts(user_id)",
                "CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id)",
                "CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id)",
                "CREATE INDEX IF NOT EXISTS idx_activity_events_user_time ON activity_events(user_id, created_at)",
                "CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_time ON focus_sessions(user_id, started_at)",
                "CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_ended ON focus_sessions(user_id, ended_at)",
            ]
            for statement in statements:
                connection.execute(statement)
            connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest INTEGER NOT NULL DEFAULT 0")
            connection.execute("ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS guest_user_id TEXT NOT NULL DEFAULT ''")
            connection.execute("ALTER TABLE focus_sessions ADD COLUMN IF NOT EXISTS paused_at TEXT NOT NULL DEFAULT ''")
            connection.execute("ALTER TABLE focus_sessions ADD COLUMN IF NOT EXISTS paused_seconds INTEGER NOT NULL DEFAULT 0")
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
            self._ensure_seed(connection)

    def _ensure_seed(self, connection) -> None:
        user_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if user_count:
            return
        state = default_state()
        created_at = now_iso()
        handle = clean_handle(state.profile.handle)
        connection.execute(
            "INSERT INTO users(id, handle, display_name, created_at, timezone, is_guest) VALUES(?, ?, ?, ?, ?, ?)",
            (
                DEFAULT_USER_ID,
                handle,
                state.profile.name or state.profile.handle or "Orbit User",
                created_at,
                state.profile.timezone or "Asia/Calcutta",
                0,
            ),
        )
        state.profile.handle = handle
        self._replace_user_state(connection, DEFAULT_USER_ID, state)
        connection.commit()

    def read_legacy_state(self, connection):
        return default_state()

    def _replace_user_state(self, connection, user_id: str, state) -> None:
        connection.execute(
            "INSERT OR REPLACE INTO user_states(user_id, data) VALUES(?, ?)",
            (user_id, json.dumps(model_to_dict(normalize_state(model_to_dict(state))), separators=(",", ":"))),
        )

    def _replace_preferences(self, connection, state) -> None:
        connection.executemany(
            "INSERT OR REPLACE INTO preferences(key, value) VALUES(?, ?)",
            [("theme", state.theme), ("activeView", state.activeView)],
        )

    def _replace_table(self, connection, table: str, rows: list[dict]) -> None:
        allowed = {"tasks", "notes", "routines", "events", "integrations"}
        if table not in allowed:
            raise HTTPException(status_code=500, detail="Invalid table")
        connection.execute(f"DELETE FROM {table}")
        connection.executemany(
            f"INSERT OR REPLACE INTO {table}(id, data) VALUES(?, ?)",
            [(row["id"], json.dumps(row, separators=(",", ":"))) for row in rows],
        )

    def _replace_single(self, connection, table: str, item_id: str, data: dict) -> None:
        allowed = {"focus", "profile"}
        if table not in allowed:
            raise HTTPException(status_code=500, detail="Invalid table")
        connection.execute(f"DELETE FROM {table}")
        connection.execute(
            f"INSERT OR REPLACE INTO {table}(id, data) VALUES(?, ?)",
            (item_id, json.dumps(data, separators=(",", ":"))),
        )
