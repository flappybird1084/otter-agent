"""ActionLayer (api.actionlayer.io) REST client.

ActionLayer is a "describe a goal, ActionLayer executes it" service.
The user supplies a natural-language goal; ActionLayer's operator + skill
system handles the rest (filling forms, sending emails, booking things).

We use it as a delegation backend for the agent: when the agent needs to
take action outside its own toolset (send a real email, fill a form,
book a flight), it creates an ActionLayer task and reports the ticket
back to the user.

Auth: `Authorization: Bearer <api_key>` against `https://api.actionlayer.io`.
Get a key at https://actionlayer.io/app → Settings → API Keys.

When `ACTIONLAYER_API_KEY` is unset, `is_enabled()` is False and the
agent tools short-circuit with a graceful actionlayer_disabled result.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx


log = logging.getLogger("actionlayer")

DEFAULT_BASE_URL = "https://api.actionlayer.io"
DEFAULT_TIMEOUT = 20.0


class ActionLayerError(RuntimeError):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"actionlayer {status}: {body[:300]}")
        self.status = status
        self.body = body


class ActionLayerClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self._api_key = (api_key or os.environ.get("ACTIONLAYER_API_KEY", "")).strip()
        self._base_url = (base_url or os.environ.get("ACTIONLAYER_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")

    def is_enabled(self) -> bool:
        return bool(self._api_key)

    # ---- workspace / quota -------------------------------------------

    async def whoami(self) -> dict:
        """Returns {user_id, email, name, workspace_name, plan, tasks_remaining,
        tasks_purchased, ...}. Useful for surfacing remaining quota."""
        return await self._get("/v1/me")

    # ---- tasks (the headline action) ---------------------------------

    async def start_task(
        self,
        *,
        goal: str,
        target_url: str | None = None,
        max_budget_usd: float | None = None,
        webhook_url: str | None = None,
        credentials_source: str | None = None,
    ) -> dict:
        payload: dict[str, Any] = {"goal": goal}
        if target_url:
            payload["target_url"] = target_url
        if max_budget_usd is not None:
            payload["max_budget_usd"] = max_budget_usd
        if webhook_url:
            payload["webhook_url"] = webhook_url
        if credentials_source:
            payload["credentials_source"] = credentials_source
        return await self._post("/tasks", json=payload)

    async def get_task(self, ticket_id: str) -> dict:
        return await self._get(f"/tasks/{ticket_id}")

    async def cancel_task(self, ticket_id: str) -> dict:
        return await self._post(f"/tasks/{ticket_id}/cancel")

    async def reply_to_task(self, ticket_id: str, message: str) -> dict:
        # The operator may ask follow-up questions; this is how we answer.
        return await self._post(f"/tasks/{ticket_id}/reply", json={"message": message})

    # ---- actions / skills (read-only catalog) -------------------------

    async def list_actions(self) -> Any:
        return await self._get("/v1/actions")

    async def list_skills(self) -> Any:
        return await self._get("/skills")

    # ---- low-level ----------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def _get(self, path: str, params: dict | None = None) -> Any:
        async with httpx.AsyncClient(base_url=self._base_url, timeout=DEFAULT_TIMEOUT) as c:
            r = await c.get(path, params=params or {}, headers=self._headers())
        return self._unwrap(r)

    async def _post(self, path: str, json: dict | None = None) -> Any:
        async with httpx.AsyncClient(base_url=self._base_url, timeout=DEFAULT_TIMEOUT) as c:
            r = await c.post(path, json=json if json is not None else {}, headers=self._headers())
        return self._unwrap(r)

    @staticmethod
    def _unwrap(r: httpx.Response) -> Any:
        if r.status_code >= 400:
            log.warning("actionlayer %s %s -> %s %s",
                        r.request.method, r.request.url.path, r.status_code, r.text[:200])
            raise ActionLayerError(r.status_code, r.text)
        if not r.content:
            return None
        try:
            return r.json()
        except Exception:
            return r.text


_client: ActionLayerClient | None = None


def get_client() -> ActionLayerClient:
    global _client
    if _client is None:
        _client = ActionLayerClient()
    return _client
