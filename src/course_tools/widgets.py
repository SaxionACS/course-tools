"""Widgets: interactive ```` ```widget ```` blocks with YAML (see docs/authoring.md).

A widget in a page::

    ```widget
    type: number
    width: 8
    value: 0b11010010
    ```

In the browser, ``assets/widgets/widgets.js`` builds the widget from its
configuration, which filters/widgets.lua passes as JSON. At build time the
same script runs in Quarto's Deno (``quarto run``, ``assets/widgets/print.js``)
to check every widget and to draw its form for the PDF: a picture and, for a
challenge (a widget with a ``goal``), an exercise with its answer.

The results go to ``_course/widgets.json`` in the stage, keyed by the SHA-1 of
the block's text, where filters/widgets.lua looks them up. They are cached in
the stage, so the script only runs for new or changed widgets.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from importlib import resources
from pathlib import Path

import yaml

from . import tools

DATA = "_course/widgets.json"           # in the stage, read by filters/widgets.lua
CACHE = ".course-widgets-cache.json"    # in the stage, not published

_FENCE = re.compile(r"^(?P<indent>[ \t]*)(?P<fence>`{3,}|~{3,})[ \t]*(?P<info>.*?)[ \t]*$")
# ```widget, or ```{.widget} with other attributes (an id: ```{#id .widget})
_WIDGET = re.compile(r"widget|\{[^}]*(?<![\w-])\.widget(?![\w-])[^}]*\}")
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_MAX_SAFE = 2 ** 53 - 1   # larger integers lose precision as JSON numbers in JavaScript


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


@dataclass
class Widget:
    key: str            # SHA-1 of the normalized text (filters/widgets.lua computes the same)
    source: str         # e.g. lessons/week_02/lesson3.md
    number: int         # 1, 2, ... on the page
    config: dict | None
    text: str = ""      # the YAML, normalized (shown under the widget with editable: true)
    error: str | None = None


def normalize(text: str) -> str:
    """A block's text without trailing spaces, blank lines at the start and end, and common indentation."""
    lines = [line.expandtabs(4).rstrip(" \t\r") for line in text.split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    indent = min((len(line) - len(line.lstrip(" ")) for line in lines if line), default=0)
    return "\n".join(line[indent:] for line in lines)


def key(text: str) -> str:
    """The key of a block: SHA-1 of its normalized text (filters/widgets.lua computes the same)."""
    return hashlib.sha1(normalize(text).encode("utf-8")).hexdigest()


def blocks(body: str) -> list[str]:
    """The texts of the widget blocks of a page (other code blocks are skipped)."""
    found, current, fence = [], None, None
    for line in body.splitlines():
        m = _FENCE.match(line)
        if fence is None:
            if m:
                fence = m.group("fence")
                current = [] if _WIDGET.fullmatch(m.group("info")) else None
        elif m and not m.group("info") and m.group("fence")[0] == fence[0] and len(m.group("fence")) >= len(fence):
            if current is not None:
                found.append("\n".join(current))
            fence, current = None, None
        elif current is not None:
            current.append(line)
    return found


def _jsonable(value):
    """YAML values as JSON that JavaScript reads without losing anything."""
    if isinstance(value, bool) or value is None or isinstance(value, (str, float)):
        return value
    if isinstance(value, int):
        return value if abs(value) <= _MAX_SAFE else str(value)
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    return str(value)


def find(body: str, source: str) -> list[Widget]:
    """The widgets of a page, their YAML read (problems are reported later, with the results)."""
    found = []
    for n, text in enumerate(blocks(body), start=1):
        widget = Widget(key(text), source, n, None, normalize(text))
        try:
            config = yaml.safe_load(text)
            if isinstance(config, dict):
                widget.config = _jsonable(config)
            else:
                widget.error = "the YAML must be a mapping, starting with type: …"
        except yaml.YAMLError as e:
            mark = getattr(e, "problem_mark", None)
            where = f" (line {mark.line + 1} of the widget)" if mark else ""
            widget.error = f"the YAML cannot be read: {getattr(e, 'problem', None) or e}{where}"
        found.append(widget)
    return found


def _runtime_dir() -> Path:
    return Path(str(resources.files("course_tools") / "assets" / "widgets"))


def runtime_version() -> str:
    """A hash of the widget scripts: results of another version are not reused."""
    h = hashlib.sha1()
    for name in ("widgets.js", "print.js"):
        h.update((_runtime_dir() / name).read_bytes())
    return h.hexdigest()[:12]


def _print(items: list[dict]) -> dict | None:
    """Run print.js on the widgets (one Deno process for all); None if that fails."""
    try:
        quarto = tools.quarto()
    except tools.ToolError as e:
        _warn(f"widgets are not checked and have no PDF form: {e}")
        return None
    with tempfile.TemporaryDirectory(prefix="course-widgets-") as tmp:
        inp, out = Path(tmp) / "in.json", Path(tmp) / "out.json"
        inp.write_text(json.dumps(items), encoding="utf-8")
        try:
            result = subprocess.run([quarto, "run", str(_runtime_dir() / "print.js"), str(inp), str(out)],
                                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        except (OSError, subprocess.TimeoutExpired) as e:
            _warn(f"widgets could not be checked: {e}")
            return None
        if result.returncode != 0 or not out.is_file():
            last = _ANSI.sub("", result.stderr).strip().splitlines()[-3:]
            _warn("widgets could not be checked: " + (" ".join(line.strip() for line in last) or "quarto run failed"))
            return None
        return json.loads(out.read_text(encoding="utf-8"))


def results(widgets: list[Widget], cache: Path | None) -> dict[str, dict]:
    """Check and draw the widgets (key -> result of Widget.print), reusing earlier results."""
    version = runtime_version()
    known: dict[str, dict] = {}
    if cache is not None and cache.is_file():
        try:
            saved = json.loads(cache.read_text(encoding="utf-8"))
            if saved.get("version") == version:
                known = saved.get("results", {})
        except (json.JSONDecodeError, OSError):
            pass
    todo = {w.key: w.config for w in widgets if w.config is not None and w.key not in known}
    if todo:
        printed = _print([{"id": k, "config": c} for k, c in todo.items()])
        if printed is not None:
            known.update(printed)
            if cache is not None:
                cache.parent.mkdir(parents=True, exist_ok=True)
                used = {w.key for w in widgets}
                cache.write_text(json.dumps({"version": version, "results": {k: v for k, v in known.items() if k in used}}),
                                 encoding="utf-8")
    return known


def data(widgets: list[Widget], cache: Path | None, editable: bool = False) -> bytes:
    """``_course/widgets.json``: per widget its configuration (JSON) and its PDF form. Reports problems.

    With `editable` (``course preview`` only), widgets with ``editable: true`` get their YAML too:
    the browser shows it under the widget to change and apply. The published site never has it.
    """
    printed = results(widgets, cache)
    entries: dict[str, dict] = {}
    for w in widgets:
        r = printed.get(w.key, {})
        kind = (w.config or {}).get("type")
        where = f"{w.source}: widget {w.number}" + (f" ({kind})" if isinstance(kind, str) else "")
        error = w.error or r.get("error")
        if error:
            _warn(f"{where}: {error}")
        for message in r.get("warnings", []):
            _warn(f"{where}: {message}")
        entry = {"error": error} if error else {}   # no nulls: Lua reads them as userdata
        if w.config is not None:
            entry["config"] = json.dumps(w.config, ensure_ascii=False, separators=(",", ":"))
            if editable and w.config.get("editable") is True:
                entry["yaml"] = w.text
        for k in ("svg", "width", "height", "caption", "title", "task", "exercise"):
            if r.get(k) is not None and not error:
                entry[k] = r[k]
        entries[w.key] = entry
    return json.dumps({"version": runtime_version(), "widgets": entries}, sort_keys=True,
                      ensure_ascii=False, indent=1).encode("utf-8")
