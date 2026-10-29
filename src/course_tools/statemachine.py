"""State machines: interactive ```` ```statemachine ```` blocks with YAML (see docs/statemachines.md).

A machine in a page::

    ```statemachine
    inputs:
      pressed: button
    outputs:
      LED: amber led
    states:
      LIGHT_OFF:
        on:
          pressed: LIGHT_ON / LED on
      LIGHT_ON:
        on:
          pressed: LIGHT_OFF / LED off
    ```

In the browser, ``assets/statemachine/statemachine.js`` draws and runs the
machine from its configuration, which filters/statemachine.lua passes as JSON;
dagre (``dagre.min.js``) places the states. At build time the same scripts run
in Quarto's Deno (``quarto run``, ``assets/statemachine/print.js``) to check
every machine and to draw its form for the PDF: a picture and a transition
table per machine.

State machines are not widgets, but they are found, keyed, cached and printed
the same way, with the helpers of widgets.py. The results go to
``_course/statemachines.json`` in the stage, keyed by the SHA-1 of the block's
text, where filters/statemachine.lua looks them up.
"""

from __future__ import annotations

import hashlib
import json
import re
from importlib import resources
from pathlib import Path

import yaml

from . import widgets
from .widgets import Widget, _jsonable, _warn

DATA = "_course/statemachines.json"           # in the stage, read by filters/statemachine.lua
CACHE = ".course-statemachines-cache.json"    # in the stage, not published


class _Loader(yaml.SafeLoader):
    """YAML as the browser reads it (js-yaml): only true and false are booleans, and keys are unique.

    PyYAML follows YAML 1.1, which reads on, off, yes and no as booleans: the
    key ``on:`` of every state, and states or outputs named ON and OFF. And it
    keeps the last of two equal keys, where two arrows for one event are a mistake.
    """

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            k = self.construct_object(key_node, deep=deep)
            if isinstance(k, (str, int, float, bool)) and k in seen:
                raise yaml.constructor.ConstructorError(None, None, f"{k} appears twice", key_node.start_mark)
            seen.add(k)
        return super().construct_mapping(node, deep)


_Loader.yaml_implicit_resolvers = {
    first: [(tag, regexp) for tag, regexp in resolvers if tag != "tag:yaml.org,2002:bool"]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
_Loader.add_implicit_resolver("tag:yaml.org,2002:bool", re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF"))


def load(text: str):
    """A block's YAML, read as the browser reads it (only true and false are booleans)."""
    return yaml.load(text, Loader=_Loader)  # noqa: S506 (a SafeLoader)


def find(body: str, source: str) -> list[Widget]:
    """The state machines of a page, their YAML read (problems are reported later, with the results)."""
    found = []
    for n, text in enumerate(widgets.blocks(body, "statemachine"), start=1):
        machine = Widget(widgets.key(text), source, n, None, widgets.normalize(text))
        try:
            config = load(text)
            if isinstance(config, dict):
                machine.config = _jsonable(config)
            else:
                machine.error = "the YAML must be a mapping, with inputs:, outputs: and states:"
        except yaml.YAMLError as e:
            mark = getattr(e, "problem_mark", None)
            where = f" (line {mark.line + 1} of the state machine)" if mark else ""
            machine.error = f"the YAML cannot be read: {getattr(e, 'problem', None) or e}{where}"
        found.append(machine)
    return found


def _runtime_dir() -> Path:
    return Path(str(resources.files("course_tools") / "assets" / "statemachine"))


def runtime_version() -> str:
    """A hash of the scripts: results of another version are not reused."""
    h = hashlib.sha1()
    for name in ("dagre.min.js", "statemachine.js", "print.js"):
        h.update((_runtime_dir() / name).read_bytes())
    return h.hexdigest()[:12]


def _print(items: list[dict]) -> dict | None:
    return widgets.run_print(_runtime_dir() / "print.js", items, "state machines")


def data(machines: list[Widget], cache: Path | None, editable: bool = False) -> bytes:
    """``_course/statemachines.json``: per block its configuration (JSON) and its PDF form. Reports problems.

    With `editable` (``course preview`` only), blocks with ``editable: true`` get their YAML too:
    the browser shows it under the machine to change and apply. The published site never has it.
    """
    version = runtime_version()
    printed = widgets.results(machines, cache, version, _print)
    entries: dict[str, dict] = {}
    for m in machines:
        r = printed.get(m.key, {})
        where = f"{m.source}: state machine {m.number}"
        error = m.error or r.get("error")
        if error:
            _warn(f"{where}: {error}")
        for message in r.get("warnings", []):
            _warn(f"{where}: {message}")
        entry = {"error": error} if error else {}   # no nulls: Lua reads them as userdata
        if m.config is not None:
            entry["config"] = json.dumps(m.config, ensure_ascii=False, separators=(",", ":"))
            if editable and m.config.get("editable") is True:
                entry["yaml"] = m.text
        if not error:
            for k in ("title", "task"):
                if r.get(k) is not None:
                    entry[k] = r[k]
            if r.get("machines"):
                entry["machines"] = [{k: v for k, v in pic.items() if v is not None} for pic in r["machines"]]
        entries[m.key] = entry
    return json.dumps({"version": version, "machines": entries}, sort_keys=True,
                      ensure_ascii=False, indent=1).encode("utf-8")
