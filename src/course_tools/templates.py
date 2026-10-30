"""Templates: Markdown texts of course-tools that a course can replace.

The built-in templates are in ``assets/templates/<group>/<name>.md``, for
example ``genAI/not-allowed.md`` (``course template list`` shows them all). A
course replaces one with a file of the same name in its own ``templates/``
directory; ``course template copy genAI/not-allowed.md`` puts a copy there to
change. HTML comments (``<!-- ... -->``) are left out of the text: the
templates explain themselves in one.
"""

from __future__ import annotations

import re
import sys
from importlib import resources
from pathlib import Path

from .course import CourseError

DIR = "templates"      # a course's own templates, at the top of the course
BUILTIN = resources.files("course_tools") / "assets" / "templates"
_COMMENT = re.compile(r"<!--.*?-->\n?", re.S)


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def _builtin(name: str):
    return BUILTIN.joinpath(*name.split("/"))


def names() -> list[str]:
    """The built-in templates, as ``group/name.md``."""
    found = []
    for group in BUILTIN.iterdir():
        if group.is_dir():
            found += [f"{group.name}/{f.name}" for f in group.iterdir() if f.is_file() and f.name.endswith(".md")]
    return sorted(found, key=str.lower)


def resolve(name: str) -> str | None:
    """A template's name as ``names()`` has it; the case does not matter and ``.md`` may be left out."""
    want = name.strip().replace("\\", "/").strip("/").lower()
    if want.startswith(f"{DIR}/"):
        want = want[len(DIR) + 1:]
    if not want.endswith(".md"):
        want += ".md"
    return next((n for n in names() if n.lower() == want), None)


def course_file(root: Path, name: str) -> Path | None:
    """The course's own copy of template ``name`` (in any case), or None."""
    base = root / DIR
    if not base.is_dir():
        return None
    return next((p for p in base.rglob("*.md") if p.relative_to(base).as_posix().lower() == name.lower()), None)


def text(name: str, root: Path | None) -> str:
    """The text of template ``name``: the course's own or the built-in one, without comments."""
    own = course_file(root, name) if root is not None else None
    raw = own.read_text(encoding="utf-8") if own else _builtin(name).read_text(encoding="utf-8")
    return _COMMENT.sub("", raw).strip()


def check(root: Path) -> None:
    """Warn about files in the course's ``templates/`` that replace no template (a typo in the name)."""
    base = root / DIR
    if not base.is_dir():
        return
    known = {n.lower() for n in names()}
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base).as_posix()
        if p.is_file() and not p.name.startswith(".") and rel.lower() not in known:
            _warn(f"{DIR}/{rel} replaces no template of course-tools, so it is not used (see `course template list`)")


def copy(name: str, root: Path, force: bool = False) -> Path:
    """Copy built-in template ``name`` into the course, to change there. Returns the new file."""
    found = resolve(name)
    if found is None:
        raise CourseError(f"there is no template {name}: `course template list` shows them")
    target = course_file(root, found) or root / DIR / found
    if target.exists() and not force:
        raise CourseError(f"{target.relative_to(root).as_posix()} is there already (--force replaces it)")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(_builtin(found).read_bytes())
    return target
