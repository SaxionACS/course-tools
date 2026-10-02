"""The generative-AI policy of a course (``info/genAI.yaml``).

The policy page is assembled from the Markdown texts in
``assets/texts/genai/``, depending on the chosen level (see
``models.GENAI_LEVELS``). Assignments can deviate from the course default with
``genai: allowed``, ``genai: tutor`` or ``genai: not-allowed`` in their front
matter, where the level permits it.
"""

from __future__ import annotations

import sys
from importlib import resources

from .models import GENAI_ALIASES, GENAI_LEVELS, GENAI_USES

# Front matter values accepted for an assignment's `genai` (besides GENAI_USES).
USE_ALIASES = {
    "true": "allowed", "yes": "allowed",
    "explain": "tutor", "explain-only": "tutor",
    "false": "not-allowed", "no": "not-allowed", "not allowed": "not-allowed",
}

TEXTS = resources.files("course_tools") / "assets" / "texts" / "genai"


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def _text(name: str) -> str:
    return (TEXTS / f"{name}.md").read_text(encoding="utf-8").strip()


def level(policy: dict) -> str | None:
    """The policy level of a genAI.yaml mapping, or None if it is invalid."""
    raw = str(policy.get("level", "")).strip().lower()
    key = GENAI_ALIASES.get(raw, raw)
    if key not in GENAI_LEVELS:
        _warn(f"genAI.yaml: level `{policy.get('level')}` is not one of {', '.join(GENAI_LEVELS)}")
        return None
    if key == "custom" and not policy.get("description"):
        _warn("genAI.yaml: level `custom` needs a `description` of the rules")
    return key


def policy_page(policy: dict, key: str | None) -> str:
    """The policy page; ``key`` is the result of ``level(policy)``."""
    out = ["---", "title: Generative AI and academic integrity", "---", ""]
    if key is None:
        out += ["The generative-AI policy of this course is not available.", ""]
        return "\n".join(out)
    spec = GENAI_LEVELS[key]
    description = str(policy.get("description") or "").strip()

    out += [f"::: {{.callout-{spec['callout']} appearance=\"simple\" icon=false}}",
            f"**In short:** {spec['summary']} Whatever you hand in, you must be able to explain it.",
            ":::", ""]

    out += ["## Generative AI in this course", "", _text(f"level-{key}"), ""]
    if description:
        if key != "custom":
            out += ["Additional rules for this course:", ""]
        out += [description, ""]
    out += [_text("scope"), ""]
    if key in ("not-allowed", "not-allowed-unless-stated"):
        out += [_text("not-allowed-examples"), ""]
    if key == "tutor":
        out += [_text("tutor-examples"), ""]
    if key != "not-allowed":
        out += [_text("citing"), "", _text("responsible-use"), ""]
    out += [_text("integrity"), "", _text("oral-check"), ""]
    return "\n".join(out)


def assignment_rule(key: str | None, value, where: str) -> dict | None:
    """GenAI rule for one assignment: ``{"use": ..., "note": ...}``.

    ``key`` is the course's policy level (None: no valid policy). ``value`` is
    the ``genai`` front matter of the assignment: ``allowed``, ``tutor`` or
    ``not-allowed``, or ``{use: ..., note: ...}``. ``use`` is one of
    ``GENAI_USES``; without it, the course rules decide (level ``custom``).
    """
    if key is None:
        if value is not None:
            _warn(f"{where}: `genai` is set, but the course has no valid info/genAI.yaml")
        return None
    spec = GENAI_LEVELS[key]

    note = None
    if isinstance(value, dict):
        note = value.get("note")
        value = value.get("use")
    wanted = None
    if value is not None:
        text = str(value).strip().lower()
        wanted = USE_ALIASES.get(text, text)
        if wanted not in GENAI_USES:
            _warn(f"{where}: `genai: {value}` is not one of {', '.join(GENAI_USES)}")
            wanted = None

    use = spec["default"]
    if wanted is not None and wanted != use:
        if spec["override"]:
            use = wanted
        else:
            _warn(f"{where}: `genai: {value}` is ignored; the course policy ({key}) allows no exceptions")
    rule: dict = {}
    if use is not None:
        rule["use"] = use
    if note:
        rule["note"] = str(note).strip()
    return rule
