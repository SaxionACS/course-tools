"""Superloop blocks: ```` ```superloop ```` blocks with YAML (see docs/superloop.md).

A short C program from a lesson that runs against simulated time::

    ```superloop
    title: The LED follows the button
    inputs:
      BUTTON_PIN: hold button
    outputs:
      LED_PIN: red led
    code: |
      while (true) {
        gpio_put(LED_PIN, gpio_get(BUTTON_PIN));
      }
    ```

In the browser, ``assets/superloop/superloop.js`` compiles and runs the
program from the block's configuration, which filters/superloop.lua passes as
JSON. At build time the same script runs in Quarto's Deno (``quarto run``,
``assets/superloop/print.js``) to check every block and to draw its form for
the PDF: the code, and the timeline of a run with the block's script. That run
is the one exception to "course code is never run": it happens in the
script's own sandboxed interpreter (no compiler, no I/O, a limit of
statements), the same one the browser uses.

Superloop blocks are not widgets, but they are found, keyed, cached and
printed the same way, with the helpers of widgets.py. The results go to
``_course/superloops.json`` in the stage, keyed by the SHA-1 of the block's
text, where filters/superloop.lua looks them up.
"""

from __future__ import annotations

import hashlib
import json
from importlib import resources
from pathlib import Path

import yaml

from . import widgets
from .widgets import Widget, _jsonable, _warn

DATA = "_course/superloops.json"           # in the stage, read by filters/superloop.lua
CACHE = ".course-superloops-cache.json"    # in the stage, not published


def find(body: str, source: str) -> list[Widget]:
    """The superloop blocks of a page, their YAML read (problems are reported later, with the results)."""
    found = []
    for n, text in enumerate(widgets.blocks(body, "superloop"), start=1):
        block = Widget(widgets.key(text), source, n, None, widgets.normalize(text))
        try:
            config = widgets.load_block(text)
            if isinstance(config, dict):
                block.config = _jsonable(config)
            else:
                block.error = "the YAML must be a mapping, with code: (or variants:), inputs: and outputs:"
        except yaml.YAMLError as e:
            mark = getattr(e, "problem_mark", None)
            where = f" (line {mark.line + 1} of the block)" if mark else ""
            block.error = f"the YAML cannot be read: {getattr(e, 'problem', None) or e}{where}"
        found.append(block)
    return found


def _runtime_dir() -> Path:
    return Path(str(resources.files("course_tools") / "assets" / "superloop"))


def runtime_version() -> str:
    """A hash of the scripts: results of another version are not reused."""
    h = hashlib.sha1()
    for name in ("superloop.js", "print.js"):
        h.update((_runtime_dir() / name).read_bytes())
    return h.hexdigest()[:12]


def _print(items: list[dict]) -> dict | None:
    return widgets.run_print(_runtime_dir() / "print.js", items, "superloop blocks")


def data(blocks: list[Widget], cache: Path | None, editable: bool = False) -> bytes:
    """``_course/superloops.json``: per block its configuration (JSON) and its PDF form. Reports problems.

    With `editable` (``course preview`` only), blocks with ``editable: true`` get their YAML too:
    the browser shows it under the block to change and apply. The published site never has it.
    """
    version = runtime_version()
    printed = widgets.results(blocks, cache, version, _print)
    entries: dict[str, dict] = {}
    for b in blocks:
        r = printed.get(b.key, {})
        where = f"{b.source}: superloop {b.number}"
        error = b.error or r.get("error")
        if error:
            _warn(f"{where}: {error}")
        for message in r.get("warnings", []):
            _warn(f"{where}: {message}")
        entry = {"error": error} if error else {}   # no nulls: Lua reads them as userdata
        if b.config is not None:
            entry["config"] = json.dumps(b.config, ensure_ascii=False, separators=(",", ":"))
            if editable and b.config.get("editable") is True:
                entry["yaml"] = b.text
        if not error:
            for k in ("title", "task"):
                if r.get(k) is not None:
                    entry[k] = r[k]
            if r.get("variants"):
                entry["variants"] = [{k: v for k, v in pic.items() if v is not None} for pic in r["variants"]]
            if r.get("exercise"):
                entry["exercise"] = r["exercise"]
        entries[b.key] = entry
    return json.dumps({"version": version, "blocks": entries}, sort_keys=True,
                      ensure_ascii=False, indent=1).encode("utf-8")
