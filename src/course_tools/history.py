"""When course files were added and last changed, according to git.

One `git log` over the course gives, per file, the date it was first added
(following renames) and the date, time and author of its last change. The
result is cached per commit, so `course preview` does not run git on every
change.
"""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime
from pathlib import Path

TIMEZONE = "Europe/Amsterdam"
MONTHS = ("January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December")

_cache: dict[tuple[str, str], dict[str, dict]] = {}


def _git(root: Path, *args: str) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(["git", "-C", str(root), *args], capture_output=True,
                              encoding="utf-8", errors="replace", timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None


def _local(stamp: str) -> datetime:
    when = datetime.fromisoformat(stamp)
    try:
        from zoneinfo import ZoneInfo
        return when.astimezone(ZoneInfo(TIMEZONE))
    except Exception:   # no time zone data: keep the committer's offset
        return when


def _parse(log: str, prefix: str) -> dict[str, dict]:
    """Walk the history from new to old; see file_history()."""
    alias: dict[str, str] = {}      # older path -> current path (renames)
    closed: set[str] = set()        # files whose history start has been seen
    info: dict[str, dict] = {}
    for chunk in log.split("\x01")[1:]:
        tokens = chunk.split("\x00")
        if len(tokens) < 2:
            continue
        date, author, rest = tokens[0], tokens[1], tokens[2:]
        i = 0
        while i < len(rest):
            status = rest[i].strip()
            if not status:
                i += 1
                continue
            if status[0] in "RC":   # rename/copy: old path, new path
                if i + 2 >= len(rest):
                    break
                old, path = rest[i + 1], rest[i + 2]
                i += 3
            else:
                if i + 1 >= len(rest):
                    break
                old, path = None, rest[i + 1]
                i += 2
            key = alias.get(path, path)
            if key in closed:
                continue
            record = info.setdefault(key, {})
            if "changed" not in record:
                record["changed"] = date
                record["author"] = author
            record["added"] = date
            if status[0] == "R":
                alias[old] = key
            elif status[0] in "ACD":
                closed.add(key)     # the history of this file starts here
    return {path[len(prefix):]: record for path, record in info.items() if path.startswith(prefix)}


def file_history(root: Path) -> dict[str, dict]:
    """{path relative to the course: {"added", "changed": ISO date, "author"}}.

    Empty when the course is not in a git repository (or has no commits).
    """
    head = _git(root, "rev-parse", "HEAD")
    if head is None or head.returncode != 0:
        return {}
    key = (str(root), head.stdout.strip())
    if key not in _cache:
        shallow = _git(root, "rev-parse", "--is-shallow-repository")
        if shallow is not None and shallow.stdout.strip() == "true":
            print("warning: the git history is incomplete (shallow clone); page dates may be wrong",
                  file=sys.stderr)
        # Paths in the log are relative to the repository; the course may be a subdirectory.
        found = _git(root, "rev-parse", "--show-prefix")
        prefix = found.stdout.strip() if found is not None and found.returncode == 0 else ""
        log = _git(root, "-c", "core.quotepath=false", "log", "-M", "--name-status", "-z",
                   "--format=%x01%aI%x00%an", "--", ".")
        _cache[key] = _parse(log.stdout, prefix) if log is not None and log.returncode == 0 else {}
    return _cache[key]


def footer(record: dict | None) -> dict | None:
    """Texts for the page footer, e.g. {"added": "23 February 2026", ...}."""
    if not record:
        return None
    added, changed = _local(record["added"]), _local(record["changed"])
    return {
        "added": f"{added.day} {MONTHS[added.month - 1]} {added.year}",
        "changed": f"{changed.day} {MONTHS[changed.month - 1]} {changed.year} at {changed:%H:%M}",
        "author": record["author"],
    }
