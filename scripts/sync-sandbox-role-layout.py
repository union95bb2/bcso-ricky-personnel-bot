#!/usr/bin/env python3
"""Align the disposable sandbox role picker with the audited live BCSO layout.

This script is intentionally sandbox-scoped. It never targets the live guild and
only removes duplicate role objects or recreates roles observed in the live
picker audit. Run on the Pi with the sandbox runtime environment.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request


GUILD_ID = "1539383172536467516"
MANIFEST = os.path.join(os.path.dirname(__file__), "role-layout-manifest.json")
SEPARATOR_PREFIX = "━"

# These are present in the live picker but were not in the original audit
# manifest. Keep this list explicit so a later run is deterministic.
LIVE_PICKER_ADDITIONS = [
    "S.E.B. - Rapid Tactical Response Unit",
    "SAR - Director",
    "IA Commander",
    "IA Captain",
    "IA Command",
    "IA Lead Investigator",
    "IA Senior Investigator",
    "IA Investigator",
    "IA Trainee",
    "DOJ Judge",
    "IRL LEO",
    "IRL Fire/Medical",
    "IRL Service Member",
    "IRL Dispatch",
    "new role",
    "Deputy of the Week",
]


def env_token() -> str:
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    if not token:
        raise SystemExit("DISCORD_TOKEN is required")
    return token


def request(token: str, method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"https://discord.com/api/v10{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "RickyBot/1.0 role-layout-sync",
            "Content-Type": "application/json",
        },
    )
    while True:
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = response.read()
                return response.status, json.loads(payload) if payload else None
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                retry = json.loads(exc.read() or b"{}").get("retry_after", 1.5)
                time.sleep(float(retry) + 0.2)
                continue
            detail = exc.read().decode(errors="replace")
            raise RuntimeError(f"Discord {method} {path}: HTTP {exc.code}: {detail}")


def unique_preserving_separators(names):
    seen = set()
    result = []
    for name in names:
        # Divider role objects are intentionally duplicated in the live layout.
        if name.startswith(SEPARATOR_PREFIX):
            result.append(name)
        elif name not in seen:
            seen.add(name)
            result.append(name)
    return result


def build_order():
    with open(MANIFEST, encoding="utf-8") as handle:
        raw = json.load(handle)["orderedRoles"]
    # Keep the live server's exact spelling (including its two spaces after
    # the hyphen). Older sandbox runs used the single-space spelling; the
    # migration below renames that object to the live spelling.
    raw = [
        "S.E.B. -  (K.9) Canine Unit" if name == "S.E.B. - (K.9) Canine Unit" else name
        for name in raw
    ]
    order = unique_preserving_separators(raw)
    for name in LIVE_PICKER_ADDITIONS:
        if name not in order:
            order.append(name)

    def move_before(name, anchor):
        if name in order:
            order.remove(name)
        order.insert(order.index(anchor), name)

    # The manifest is already the audited live top-to-bottom sequence. Keep it
    # authoritative; older revisions performed ad-hoc division moves that
    # reversed SAR/DOC and displaced the visual divider roles.
    return order


def main():
    if os.environ.get("DISCORD_GUILD_ID", GUILD_ID) != GUILD_ID:
        raise SystemExit("Refusing to run: runtime is not the sandbox guild")
    token = env_token()
    desired = build_order()
    _, roles = request(token, "GET", f"/guilds/{GUILD_ID}/roles")
    _, members = request(token, "GET", f"/guilds/{GUILD_ID}/members?limit=1000")
    usage = {role["id"]: 0 for role in roles}
    for member in members:
        for role_id in member.get("roles", []):
            if role_id in usage:
                usage[role_id] += 1

    by_name = {}
    for role in roles:
        by_name.setdefault(role["name"], []).append(role)

    # Correct the one known spelling drift without creating a duplicate.
    typo = by_name.get("S.E.B. - (K.9) Canine Unit", [])
    if typo:
        request(token, "PATCH", f"/guilds/{GUILD_ID}/roles/{typo[0]['id']}", {"name": "S.E.B. -  (K.9) Canine Unit"})
        typo[0]["name"] = "S.E.B. -  (K.9) Canine Unit"
        by_name.setdefault(typo[0]["name"], []).append(typo[0])
        by_name.pop("S.E.B. - (K.9) Canine Unit", None)

    # Remove duplicate non-divider roles, retaining the assigned/highest one.
    for name, candidates in list(by_name.items()):
        if len(candidates) < 2 or name.startswith(SEPARATOR_PREFIX) or any(r.get("managed") for r in candidates):
            continue
        keeper = max(candidates, key=lambda role: (usage.get(role["id"], 0), role["position"]))
        for role in candidates:
            if role["id"] == keeper["id"] or role.get("managed"):
                continue
            request(token, "DELETE", f"/guilds/{GUILD_ID}/roles/{role['id']}")

    # Divider roles are intentionally unassigned and only provide the visual
    # category breaks in Discord's picker. Remove stale divider lengths and
    # surplus instances so the sandbox has exactly the live divider sequence.
    desired_divider_counts = {}
    for name in desired:
        if name.startswith(SEPARATOR_PREFIX):
            desired_divider_counts[name] = desired_divider_counts.get(name, 0) + 1
    for name, candidates in list(by_name.items()):
        if not name.startswith(SEPARATOR_PREFIX):
            continue
        keep = desired_divider_counts.get(name, 0)
        # Prefer the highest-position instances when trimming; all dividers
        # should be unassigned, but never delete one that a member uses.
        ranked = sorted(candidates, key=lambda role: (usage.get(role["id"], 0) > 0, role["position"]), reverse=True)
        for role in ranked[keep:]:
            if usage.get(role["id"], 0) == 0 and not role.get("managed"):
                request(token, "DELETE", f"/guilds/{GUILD_ID}/roles/{role['id']}")

    # Re-fetch after deletes/rename and create only names observed in the live layout.
    _, roles = request(token, "GET", f"/guilds/{GUILD_ID}/roles")
    existing = {}
    for role in roles:
        existing.setdefault(role["name"], []).append(role)
    for name in desired:
        if existing.get(name):
            existing[name].pop(0)
            continue
        _, created = request(token, "POST", f"/guilds/{GUILD_ID}/roles", {"name": name, "permissions": "0", "color": 0, "hoist": False, "mentionable": False})
        existing.setdefault(name, []).append(created)

    # Arrange managed/non-managed roles in the audited top-to-bottom order. Discord
    # preserves managed bot roles; the list still gives all ordinary roles the right
    # relative order around them.
    _, roles = request(token, "GET", f"/guilds/{GUILD_ID}/roles")
    by_name = {}
    for role in roles:
        by_name.setdefault(role["name"], []).append(role)
    role_queues = {
        name: sorted(candidates, key=lambda role: role["position"], reverse=True)
        for name, candidates in by_name.items()
    }
    ordered_ids = []
    for name in desired:
        candidates = role_queues.get(name, [])
        if candidates:
            ordered_ids.append(candidates.pop(0))
    max_position = max((role["position"] for role in roles), default=len(ordered_ids))
    payload = []
    for index, role in enumerate(ordered_ids):
        if role.get("managed"):
            continue
        payload.append({"id": role["id"], "position": max_position - index})
    if payload:
        request(token, "PATCH", f"/guilds/{GUILD_ID}/roles", payload)

    _, final_roles = request(token, "GET", f"/guilds/{GUILD_ID}/roles")
    final_assignable = [r for r in final_roles if r["id"] != GUILD_ID and not r.get("managed")]
    final_names = [r["name"] for r in final_roles if r["id"] != GUILD_ID]
    divider_counts = {}
    for role in final_assignable:
        if role["name"].startswith(SEPARATOR_PREFIX):
            divider_counts[role["name"]] = divider_counts.get(role["name"], 0) + 1
    print(json.dumps({
        "guild": GUILD_ID,
        "assignable_roles": len(final_names),
        "desired_names": len(desired),
        "missing": [name for name in desired if name not in final_names],
        "divider_counts": divider_counts,
        "managed_roles": [r["name"] for r in final_roles if r.get("managed")],
    }, indent=2))


if __name__ == "__main__":
    main()
