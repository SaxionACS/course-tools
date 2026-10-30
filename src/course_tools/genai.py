"""The generative-AI policy of a course (``info/genAI.yaml``).

The policy page is the template ``genAI/<level>.md`` (the levels are in
``models.GENAI_LEVELS``), and the box at the top of an assignment the template
``genAI/assignment-<use>.md``: the built-in ones, or the course's own in its
``templates/genAI/`` (see templates.py). Assignments can deviate from the
course default with ``genai: allowed``, ``genai: tutor`` or
``genai: not-allowed`` in their front matter, where the level permits it.
"""

from __future__ import annotations

import sys
from pathlib import Path

from . import templates
from .models import GENAI_ALIASES, GENAI_LEVELS, GENAI_USES

# Front matter values accepted for an assignment's `genai` (besides GENAI_USES).
USE_ALIASES = {
    "true": "allowed", "yes": "allowed",
    "explain": "tutor", "explain-only": "tutor",
    "false": "not-allowed", "no": "not-allowed", "not allowed": "not-allowed",
}


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def level(policy: dict, root: Path | None = None) -> str | None:
    """The policy level of a genAI.yaml mapping, or None if it is invalid."""
    raw = str(policy.get("level", "")).strip().lower()
    key = GENAI_ALIASES.get(raw, raw)
    if key not in GENAI_LEVELS:
        _warn(f"genAI.yaml: level `{policy.get('level')}` is not one of {', '.join(GENAI_LEVELS)}")
        return None
    if policy.get("description"):
        _warn(f"genAI.yaml: `description` is no longer used: write the course's rules in its own copy of "
              f"the policy page (`course template copy genAI/{key}.md`)")
    if key == "custom" and (root is None or templates.course_file(root, "genAI/custom.md") is None):
        _warn("genAI.yaml: level `custom` needs the course's rules: write them in templates/genAI/custom.md "
              "(`course template copy genAI/custom.md`)")
    return key


def policy_file(key: str | None, root: Path | None) -> Path | None:
    """The course's own policy page (templates/genAI/<level>.md), if it has one."""
    return templates.course_file(root, f"genAI/{key}.md") if key and root is not None else None


def policy_page(key: str | None, root: Path | None = None) -> str:
    """The policy page; ``key`` is the result of ``level(policy)``."""
    out = ["---", "title: Generative AI and academic integrity", "---", ""]
    if key is None:
        out += ["The generative-AI policy of this course is not available.", ""]
        return "\n".join(out)
    out += [templates.text(f"genAI/{key}.md", root), ""]
    return "\n".join(out)


def assignment_rule(key: str | None, value, where: str, root: Path | None = None) -> dict | None:
    """GenAI rule for one assignment: ``{"use": ..., "note": ..., "title": ..., "text": ...}``.

    ``key`` is the course's policy level (None: no valid policy). ``value`` is
    the ``genai`` front matter of the assignment: ``allowed``, ``tutor`` or
    ``not-allowed``, or ``{use: ..., note: ...}``. ``use`` is one of
    ``GENAI_USES``; without it, the course rules decide (level ``custom``).
    ``title`` and ``text`` are the box's, from ``genAI/assignment-<use>.md``;
    ``{policy}`` in the text is for the link to the policy page.
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
    # the box: its title is the heading on the first line
    name = f"genAI/assignment-{use or 'custom'}.md"
    first, _, rest = templates.text(name, root).partition("\n")
    if first.startswith("#"):
        rule["title"], rule["text"] = first.lstrip("#").strip(), rest.strip()
    else:
        _warn(f"{name}: the first line must be the box's title, as a heading (## Generative AI: ...)")
        rule["title"], rule["text"] = "Generative AI", f"{first}\n{rest}".strip()
    return rule
