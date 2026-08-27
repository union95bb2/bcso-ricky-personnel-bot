#!/usr/bin/env python3
"""Apply the audited live BCSO role colors to the disposable sandbox only.

The role layout migration and this style migration are deliberately separate:
the layout script creates/removes/reorders role objects, while this script only
changes the color field for names present in the audited style manifest.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


GUILD_ID = "1539383172536467516"
MANIFEST = os.path.join(os.path.dirname(__file__), "role-style-manifest.json")


def request(token: str, method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"https://discord.com/api/v10{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "RickyBot/1.0 sandbox-role-style",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Discord {method} {path}: HTTP {exc.code}: {detail}") from exc


def color_value(value: str) -> int:
    normalized = value.strip().lstrip("#")
    if len(normalized) != 6:
        raise ValueError(f"Invalid color in manifest: {value}")
    return int(normalized, 16)


def main():
    configured_guild = os.environ.get("DISCORD_GUILD_ID", "")
    if configured_guild != GUILD_ID:
        raise SystemExit("Refusing to run: DISCORD_GUILD_ID must be the sandbox guild 1539383172536467516")
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    if not token:
        raise SystemExit("DISCORD_TOKEN is required")

    with open(MANIFEST, encoding="utf-8") as handle:
        expected = json.load(handle)["roles"]
    _, roles = request(token, "GET", f"/guilds/{GUILD_ID}/roles")
    by_name = {}
    for role in roles:
        by_name.setdefault(role["name"], []).append(role)

    changes = []
    missing = []
    for item in expected:
        candidates = by_name.get(item["name"], [])
        if not candidates:
            missing.append(item["name"])
            continue
        wanted = color_value(item["color"])
        for role in candidates:
            actual = int(role.get("color") or 0)
            if actual == wanted:
                continue
            changes.append({"id": role["id"], "name": role["name"], "from": f"#{actual:06X}", "to": item["color"].upper()})
            if "--apply" in sys.argv:
                request(token, "PATCH", f"/guilds/{GUILD_ID}/roles/{role['id']}", {"color": wanted})

    result = {
        "guild": GUILD_ID,
        "mode": "apply" if "--apply" in sys.argv else "dry-run",
        "changes": changes,
        "change_count": len(changes),
        "missing": missing,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
