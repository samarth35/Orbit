from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.models import EventCreate, TaskCreate
from backend.app.services import OrbitService
from backend.app.sqlite_store import SqliteStateStore, clean_redirect


@pytest.fixture
def store(tmp_path):
    return SqliteStateStore(tmp_path / "orbit.sqlite3")


@pytest.fixture
def client(store, monkeypatch):
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(main, "service", OrbitService(store))
    monkeypatch.setenv("ORBIT_PUBLIC_BASE_URL", "http://testserver")
    monkeypatch.setenv("ORBIT_SESSION_SECRET", "test-session-secret-with-more-than-32-characters")
    return TestClient(main.app)


def guest(client):
    response = client.post("/api/auth/guest")
    assert response.status_code == 200
    client.headers["X-Orbit-CSRF"] = client.cookies["orbit_csrf"]
    return response.json()["user"]


def test_login_csrf_logout_and_isolation(client):
    first_user = guest(client)
    assert client.post("/api/tasks", json={"title": "Ship the revised Orbit dashboard"}).status_code == 201
    client.headers.pop("X-Orbit-CSRF")
    assert client.patch("/api/preferences", json={"theme": "light"}).status_code == 403
    client.headers["X-Orbit-CSRF"] = client.cookies["orbit_csrf"]
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/users/me").status_code == 401
    assert guest(client)["id"] != first_user["id"]
    assert client.get("/api/tasks").json()["tasks"] == []


def test_google_not_configured_stays_in_app(client, monkeypatch):
    monkeypatch.delenv("ORBIT_GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("ORBIT_GOOGLE_CLIENT_SECRET", raising=False)
    assert client.get("/api/auth/google/status").json() == {"configured": False}
    response = client.get("/api/auth/google/start", follow_redirects=False)
    assert response.headers["location"] == "/?auth_error=unavailable"


def test_google_callback_requires_browser_binding(client):
    response = client.get("/api/auth/google/callback?state=other-browser&code=fake", follow_redirects=False)
    assert response.headers["location"] == "/?auth_error=expired"
    assert "orbit_session" not in response.cookies


def test_new_google_identity_upgrades_guest_without_losing_work(client, store, monkeypatch):
    from backend.app import sqlite_store
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_ID", "test-google-client")
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_SECRET", "test-google-secret")
    user = guest(client)
    client.post("/api/tasks", json={"title": "Keep my guest work"})
    monkeypatch.setattr(sqlite_store, "post_form_json", lambda *_: {"access_token": "fake"})
    monkeypatch.setattr(sqlite_store, "get_bearer_json", lambda *_: {"sub": "google-123", "email": "orbit@example.com", "email_verified": True, "name": "Orbit Member"})
    start = client.get("/api/auth/google/start?redirect=/tasks", follow_redirects=False)
    assert start.status_code == 307
    state = client.cookies["orbit_oauth_state"]
    result = client.get(f"/api/auth/google/callback?state={state}&code=authorized", follow_redirects=False)
    assert result.status_code == 303
    assert result.headers["location"] == "/tasks"
    me = client.get("/api/users/me").json()
    assert me["user"]["id"] == user["id"]
    assert me["user"]["isGuest"] is False
    assert me["state"]["tasks"][0]["title"] == "Keep my guest work"
    assert SqliteStateStore(store.path).user(user["id"])["isGuest"] is False
    with pytest.raises(Exception):
        store.complete_google_oauth(state, "replay")


def test_unverified_google_email_is_rejected(store, monkeypatch):
    from backend.app import sqlite_store
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_ID", "test")
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_SECRET", "test")
    monkeypatch.setattr(sqlite_store, "post_form_json", lambda *_: {"access_token": "fake"})
    monkeypatch.setattr(sqlite_store, "get_bearer_json", lambda *_: {"sub": "unverified", "email": "orbit@example.com", "email_verified": False})
    state = store.begin_google_oauth()["state"]
    with pytest.raises(Exception, match="verified Google email"):
        store.complete_google_oauth(state, "fake")


def test_focus_pause_resume_reset_and_replay(client, store):
    user = guest(client)
    first = client.post("/api/focus/sessions/start").json()
    session_id = first["session"]["id"]
    assert first["state"]["focus"]["deadlineAt"] > 0
    client.patch("/api/focus", json={"running": False, "secondsLeft": 1300})
    resumed = client.post("/api/focus/sessions/start").json()
    assert resumed["session"]["id"] == session_id
    assert resumed["state"]["focus"]["running"] is True
    with store._connect() as connection:
        started = (datetime.now(timezone.utc) - timedelta(minutes=26)).isoformat()
        connection.execute("UPDATE focus_sessions SET started_at = ? WHERE id = ?", (started, session_id))
        connection.commit()
    first_complete = client.post(f"/api/focus/sessions/complete?session_id={session_id}").json()
    second_complete = client.post(f"/api/focus/sessions/complete?session_id={session_id}").json()
    assert first_complete["state"]["focus"]["completed"] == second_complete["state"]["focus"]["completed"] == 1
    client.post("/api/focus/sessions/start")
    assert client.post("/api/focus/reset").json()["state"]["focus"]["activeSessionId"] == ""
    with store._connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM focus_sessions WHERE user_id = ? AND status = 'active'", (user["id"],)).fetchone()[0] == 0


def test_group_membership_and_owner_controls(client, store):
    owner = guest(client)
    group = client.post("/api/groups", json={"name": "Orbit builders"}).json()["group"]
    outsider = TestClient(main.app)
    guest(outsider)
    assert outsider.get(f"/api/groups/{group['id']}/members").status_code == 403
    assert outsider.post("/api/groups/join", json={"joinCode": group["joinCode"]}).status_code == 200
    assert outsider.patch(f"/api/groups/{group['id']}", json={"name": "Hijack"}).status_code == 403
    assert owner["id"] in [item["userId"] for item in client.get(f"/api/groups/{group['id']}/members").json()["members"]]


def test_api_misses_are_json_and_handle_signup_is_retired(client):
    assert client.get("/api/does-not-exist").status_code == 404
    assert client.post("/api/auth/handle", json={"handle": "no-recovery"}).status_code == 410


def test_app_html_does_not_reuse_build_archive_etags(client, tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text('<html><script src="/assets/current.js"></script></html>')
    monkeypatch.setattr(main, "DIST_ROOT", dist)
    response = client.get("/tasks", headers={"If-None-Match": '"old-build"', "If-Modified-Since": "Sat, 20 Oct 2018 01:46:40 GMT"})
    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]
    assert "etag" not in response.headers
    assert "last-modified" not in response.headers
    assert "/assets/current.js" in response.text
    assert client.get("/index.html").headers["cache-control"] == response.headers["cache-control"]
    assert client.get("/missing-old-bundle.js").status_code == 404


def test_calendar_validates_time_and_saves_future_days(client):
    guest(client)
    event = {"title": "Future focus block", "date": "2026-12-02", "start": "10:00", "end": "09:00"}
    assert client.post("/api/calendar/events", json=event).status_code == 400
    event["end"] = "11:00"
    response = client.post("/api/calendar/events", json=event)
    assert response.status_code == 201
    created = response.json()["state"]["events"][0]
    assert created["date"] == "2026-12-02"
    assert client.patch(f"/api/calendar/events/{created['id']}", json={"end": "09:00"}).status_code == 400


def test_paused_time_does_not_earn_focus_score(store):
    user = store.auth_guest()
    session = store.start_focus_session(user["id"])
    with store._connect() as connection:
        started = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
        connection.execute("UPDATE focus_sessions SET started_at = ?, paused_seconds = 1500 WHERE id = ?", (started, session["id"]))
        connection.commit()
    result = store.complete_focus_session(user["id"], session["id"])
    assert result["session"]["valid_minutes"] == 0
    assert result["state"]["focus"]["completed"] == 0


@pytest.mark.parametrize("value", ["//external.com", "/\\external.com", "https://external.com", "/\nexternal"])
def test_redirect_remains_local(value):
    assert clean_redirect(value) == "/"
