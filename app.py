"""Vercel's ASGI entrypoint. Local development uses the same application."""

from backend.app.main import app

__all__ = ["app"]
