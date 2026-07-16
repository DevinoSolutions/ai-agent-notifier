#!/usr/bin/env python3
# scripts/lib/wpn-readback.py — read the Windows push-notification platform store
# and report whether a nonce landed in a recorded toast.
#
# This is the Windows analog of reading a delivered notification back out of
# macOS Notification Center's SQLite DB. It resolves
#   %LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db
# copies the DB and its -wal/-shm sidecars to a temp dir, opens the copy, and
# searches the Notification table's Payload (toast XML) for the nonce, reporting
# whether it appears in the title and body <text> elements plus the recording
# app identity (AUMID).
#
# WAL-AWARENESS IS LOAD-BEARING. A freshly fired toast lives entirely in the
# -wal sidecar for a short window. Opening the DB with `immutable=1` SKIPS the
# WAL and returns a FALSE NEGATIVE — proven on a live windows-latest runner where
# an immutable open saw 0 hits while the copy-with-WAL open saw the toast. So we
# NEVER open with immutable=1: we copy the WAL alongside the DB (primary) or open
# read-only WITHOUT immutable (fallback). See docs/research/2026-07-15-layer3-render-proof.md.
#
# stdlib only (sqlite3, shutil, json, re) — Python is preinstalled on
# windows-latest, no pip install. Prints one line of JSON to stdout.

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile


def db_path():
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        return None
    return os.path.join(base, "Microsoft", "Windows", "Notifications", "wpndatabase.db")


def open_db(src):
    """Open the store WAL-awarely. Returns (conn, strategy) or (None, None).

    Strategy order: copy db + -wal + -shm to temp and open the copy (checkpoints
    the WAL into the copy); then plain read-only WITHOUT immutable. Never immutable=1.
    """
    tmpdir = tempfile.mkdtemp(prefix="wpn_")
    dst = os.path.join(tmpdir, "wpndatabase.db")
    try:
        shutil.copy2(src, dst)
        for ext in ("-wal", "-shm"):
            side = src + ext
            if os.path.exists(side):
                shutil.copy2(side, dst + ext)
        return sqlite3.connect(dst), "copy_and_open"
    except Exception:  # noqa: BLE001
        pass
    try:
        return sqlite3.connect(f"file:{src}?mode=ro", uri=True), "ro_direct"
    except Exception:  # noqa: BLE001
        return None, None


def decode_blob(value):
    """Best-effort decode of a cell that may be str/bytes/None to text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        b = bytes(value)
        for enc in ("utf-8", "utf-16-le", "utf-16-be", "latin-1"):
            try:
                return b.decode(enc)
            except Exception:  # noqa: BLE001
                continue
    return ""


def find_toast(conn, nonce):
    """Return the first Notification whose Payload contains the nonce, decoded."""
    try:
        cur = conn.execute("SELECT HandlerId, Payload FROM Notification")
    except sqlite3.Error:
        return None
    for handler_id, payload in cur.fetchall():
        text = decode_blob(payload)
        if nonce in text:
            texts = re.findall(r"<text[^>]*>(.*?)</text>", text, re.DOTALL)
            return {"handler_id": handler_id, "payload": text, "texts": texts}
    return None


def aumid_for(conn, handler_id):
    try:
        cur = conn.execute(
            "SELECT PrimaryId FROM NotificationHandler WHERE RecordId = ?",
            (handler_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None
    except sqlite3.Error:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nonce", required=True)
    args = ap.parse_args()

    src = db_path()
    out = {
        "db_path": src,
        "db_exists": bool(src and os.path.exists(src)),
        "wal_exists": bool(src and os.path.exists(src + "-wal")),
        "found": False,
        "title_has_nonce": False,
        "body_has_nonce": False,
        "texts": [],
        "payload_excerpt": None,
        "aumid": None,
        "strategy": None,
    }

    if not out["db_exists"]:
        print(json.dumps(out))
        return 0

    conn, strategy = open_db(src)
    if conn is None:
        out["error"] = "could not open wpndatabase.db"
        print(json.dumps(out))
        return 0
    out["strategy"] = strategy

    hit = find_toast(conn, args.nonce)
    if hit:
        texts = hit["texts"]
        out["found"] = True
        out["texts"] = texts
        out["title_has_nonce"] = bool(texts) and args.nonce in texts[0]
        out["body_has_nonce"] = len(texts) > 1 and args.nonce in texts[1]
        idx = hit["payload"].find(args.nonce)
        out["payload_excerpt"] = hit["payload"][max(0, idx - 80): idx + len(args.nonce) + 120]
        out["aumid"] = aumid_for(conn, hit["handler_id"])
    conn.close()

    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
