"""Pluggable store abstraction.

Two backends:
  - LocalStore: JSON-on-disk + filesystem markdown. Zero-cloud, demo-ready.
  - FirestoreStore: real Firestore + Cloud Storage. Production path.

Both speak the same collection-shaped API. The frontend reads Firestore directly
when STORE_BACKEND=firestore; in local mode the frontend polls /events instead
(see main.py).
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from nanoid import generate as _nanoid


def new_id(prefix: str = "") -> str:
    suffix = _nanoid(size=10)
    return f"{prefix}_{suffix}" if prefix else suffix


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


COLLECTIONS = (
    "users",
    "friendships",
    "calendar_events",
    "notes",
    "agent_events",
    "chat_messages",
    "agent_inbox",
)


class Store:
    """Minimal collection-oriented interface."""

    def add(self, collection: str, doc: dict) -> str: ...
    def upsert(self, collection: str, doc_id: str, doc: dict) -> None: ...
    def get(self, collection: str, doc_id: str) -> dict | None: ...
    def update(self, collection: str, doc_id: str, patch: dict) -> None: ...
    def delete(self, collection: str, doc_id: str) -> None: ...
    def query(
        self,
        collection: str,
        *,
        where: list[tuple[str, str, Any]] | None = None,
        order_by: tuple[str, str] | None = None,
        limit: int | None = None,
    ) -> list[dict]: ...
    def wipe(self) -> None: ...
    def read_note(self, user_id: str, note_id: str) -> str: ...
    def write_note(self, user_id: str, note_id: str, markdown: str) -> str: ...


# ---------------------------------------------------------------------------
# LocalStore
# ---------------------------------------------------------------------------


class LocalStore(Store):
    def __init__(self, path: str, notes_root: str):
        self.path = Path(path)
        self.notes_root = Path(notes_root)
        self.notes_root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._data: dict[str, dict[str, dict]] = {c: {} for c in COLLECTIONS}
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text() or "{}")
                for c in COLLECTIONS:
                    self._data[c] = raw.get(c, {})
            except json.JSONDecodeError:
                pass

    def _flush(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, indent=2, default=str))
        tmp.replace(self.path)

    # ------- collection ops -------

    def add(self, collection: str, doc: dict) -> str:
        with self._lock:
            doc_id = doc.get("id") or new_id()
            doc = {**doc, "id": doc_id}
            doc.setdefault("created_at", utcnow_iso())
            self._data.setdefault(collection, {})[doc_id] = doc
            self._flush()
            return doc_id

    def upsert(self, collection: str, doc_id: str, doc: dict) -> None:
        with self._lock:
            doc = {**doc, "id": doc_id}
            doc.setdefault("created_at", utcnow_iso())
            self._data.setdefault(collection, {})[doc_id] = doc
            self._flush()

    def get(self, collection: str, doc_id: str) -> dict | None:
        with self._lock:
            return self._data.get(collection, {}).get(doc_id)

    def update(self, collection: str, doc_id: str, patch: dict) -> None:
        with self._lock:
            current = self._data.get(collection, {}).get(doc_id)
            if not current:
                raise KeyError(f"{collection}/{doc_id} not found")
            current.update(patch)
            self._flush()

    def delete(self, collection: str, doc_id: str) -> None:
        with self._lock:
            self._data.get(collection, {}).pop(doc_id, None)
            self._flush()

    def query(
        self,
        collection: str,
        *,
        where: list[tuple[str, str, Any]] | None = None,
        order_by: tuple[str, str] | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        with self._lock:
            rows: Iterable[dict] = list(self._data.get(collection, {}).values())
            if where:
                for field, op, value in where:
                    rows = [r for r in rows if _match(r.get(field), op, value)]
            rows = list(rows)
            if order_by:
                field, direction = order_by
                rows.sort(key=lambda r: r.get(field) or "", reverse=direction == "desc")
            if limit is not None:
                rows = rows[:limit]
            return rows

    def wipe(self) -> None:
        with self._lock:
            self._data = {c: {} for c in COLLECTIONS}
            self._flush()

    # ------- notes (markdown lives on disk) -------

    def _note_path(self, user_id: str, note_id: str) -> Path:
        return self.notes_root / user_id / f"{note_id}.md"

    def read_note(self, user_id: str, note_id: str) -> str:
        p = self._note_path(user_id, note_id)
        if not p.exists():
            return ""
        return p.read_text()

    def write_note(self, user_id: str, note_id: str, markdown: str) -> str:
        p = self._note_path(user_id, note_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(markdown)
        return f"local://{p}"


def _match(value: Any, op: str, target: Any) -> bool:
    if op == "==":
        return value == target
    if op == "!=":
        return value != target
    if op == "in":
        return value in (target or [])
    if op == "array-contains":
        return isinstance(value, list) and target in value
    if op == ">=":
        return value is not None and value >= target
    if op == "<=":
        return value is not None and value <= target
    if op == ">":
        return value is not None and value > target
    if op == "<":
        return value is not None and value < target
    raise ValueError(f"Unsupported op: {op}")


# ---------------------------------------------------------------------------
# FirestoreStore
# ---------------------------------------------------------------------------


class FirestoreStore(Store):
    def __init__(self, project_id: str, bucket: str | None):
        from google.cloud import firestore  # type: ignore
        from google.cloud import storage  # type: ignore

        self._fs = firestore.Client(project=project_id)
        self._bucket_name = bucket
        self._gcs = storage.Client(project=project_id) if bucket else None
        self._bucket = self._gcs.bucket(bucket) if (self._gcs and bucket) else None

    def add(self, collection: str, doc: dict) -> str:
        doc_id = doc.get("id") or new_id()
        doc = {**doc, "id": doc_id}
        doc.setdefault("created_at", _firestore_server_ts())
        self._fs.collection(collection).document(doc_id).set(doc)
        return doc_id

    def upsert(self, collection: str, doc_id: str, doc: dict) -> None:
        doc = {**doc, "id": doc_id}
        doc.setdefault("created_at", _firestore_server_ts())
        self._fs.collection(collection).document(doc_id).set(doc)

    def get(self, collection: str, doc_id: str) -> dict | None:
        snap = self._fs.collection(collection).document(doc_id).get()
        return snap.to_dict() if snap.exists else None

    def update(self, collection: str, doc_id: str, patch: dict) -> None:
        self._fs.collection(collection).document(doc_id).update(patch)

    def delete(self, collection: str, doc_id: str) -> None:
        self._fs.collection(collection).document(doc_id).delete()

    def query(
        self,
        collection: str,
        *,
        where: list[tuple[str, str, Any]] | None = None,
        order_by: tuple[str, str] | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        from google.cloud.firestore_v1.base_query import FieldFilter  # type: ignore

        # We deliberately do NOT pass order_by to Firestore: any (where + order_by)
        # combo would require a composite index, which is overkill for our tiny
        # demo collections. Sort and limit client-side instead.
        q = self._fs.collection(collection)
        if where:
            for field, op, value in where:
                q = q.where(filter=FieldFilter(field, op, value))
        rows = [d.to_dict() for d in q.stream()]
        if order_by:
            field, direction = order_by
            rows.sort(key=lambda r: r.get(field) or "", reverse=direction == "desc")
        if limit is not None:
            rows = rows[:limit]
        return rows

    def wipe(self) -> None:
        for c in COLLECTIONS:
            for d in self._fs.collection(c).stream():
                d.reference.delete()

    def read_note(self, user_id: str, note_id: str) -> str:
        if not self._bucket:
            return ""
        blob = self._bucket.blob(f"notes/{user_id}/{note_id}.md")
        if not blob.exists():
            return ""
        return blob.download_as_text()

    def write_note(self, user_id: str, note_id: str, markdown: str) -> str:
        if not self._bucket:
            raise RuntimeError("GCS bucket not configured")
        blob = self._bucket.blob(f"notes/{user_id}/{note_id}.md")
        blob.upload_from_string(markdown, content_type="text/markdown")
        return f"gs://{self._bucket_name}/notes/{user_id}/{note_id}.md"


def _firestore_server_ts():
    from google.cloud.firestore import SERVER_TIMESTAMP  # type: ignore

    return SERVER_TIMESTAMP


# ---------------------------------------------------------------------------
# factory
# ---------------------------------------------------------------------------

_singleton: Store | None = None


def get_store() -> Store:
    global _singleton
    if _singleton is not None:
        return _singleton
    backend = os.environ.get("STORE_BACKEND", "local").lower()
    if backend == "firestore":
        _singleton = FirestoreStore(
            project_id=os.environ["GCP_PROJECT_ID"],
            bucket=os.environ.get("GCS_BUCKET"),
        )
    else:
        _singleton = LocalStore(
            path=os.environ.get("LOCAL_STORE_PATH", "./local_store.json"),
            notes_root=os.environ.get("LOCAL_NOTES_PATH", "./seed/notes"),
        )
    return _singleton
