"""Settings for Compiler Explorer links on code blocks.

A course sets the default compiler in ``info/general.yaml``; a page can
override it in its front matter, a code block with attributes (see
``assets/filters/compiler-explorer.lua``)::

    compiler_explorer:
      target: ARM Cortex-M0+          # shown next to the link
      compiler: carmug1520            # Compiler Explorer compiler id
      options: -O2 -mcpu=cortex-m0plus -mthumb
      run:                            # for ce=run and ce=exe (optional)
        target: x86-64
        compiler: cg152
        options: -O2

The settings reach the Lua filter as base64-encoded JSON, so that Pandoc does
not read them as Markdown (it would turn ``--`` in compiler flags into a dash).
"""

from __future__ import annotations

import base64
import json
import sys

KEYS = ("target", "compiler", "options")


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def _section(value, where: str, allowed: tuple[str, ...]) -> dict:
    if not isinstance(value, dict):
        _warn(f"{where}: must be a mapping with {', '.join(allowed)}")
        return {}
    result = {}
    for key, item in value.items():
        if key not in allowed:
            _warn(f"{where}: unknown key `{key}` (use {', '.join(allowed)})")
        elif key == "run":
            continue
        elif item is None or isinstance(item, (dict, list)):
            _warn(f"{where}: `{key}` must be text")
        else:
            result[key] = str(item).strip()
    return result


def settings(value, where: str) -> dict | None:
    """Validated settings ({target, compiler, options, run: {...}}); None if not set."""
    if value is None:
        return None
    result = _section(value, f"{where}: compiler_explorer", KEYS + ("run",))
    if isinstance(value, dict) and value.get("run") is not None:
        run = _section(value["run"], f"{where}: compiler_explorer.run", KEYS)
        if run:
            result["run"] = run
    return result


def encode(value: dict) -> str:
    """The settings as metadata for the Lua filter."""
    return base64.b64encode(json.dumps(value).encode("utf-8")).decode("ascii")
