"""Learning outcomes of pages, and the outcome map.

A page names the learning outcomes it works towards in its front matter::

    ---
    outcomes: [LO1, LO3]
    ---

The ids are those of ``learning_outcomes`` in ``info/general.yaml``. The page
then shows the outcomes at the top (filters/course.lua), with their `title`.
The outcome map (``info/outcomes.qmd``) shows, for every outcome, the pages
that work towards it and the assessment components that assess it.
"""

from __future__ import annotations

import posixpath
import sys

MAP = "info/outcomes.qmd"


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def anchor(lo_id: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in lo_id.lower())


def label(lo: dict) -> str:
    """'LO1: Superloops', or 'LO1' without a title."""
    return f"{lo['id']}: {lo['title']}" if lo.get("title") else lo["id"]


def of_page(value, los: list[dict], where: str) -> list[dict]:
    """The learning outcomes named in a page's front matter (unknown ids are reported)."""
    if value is None:
        return []
    names = value if isinstance(value, list) else [value]
    by_id = {lo["id"].lower(): lo for lo in los}
    result = []
    for name in names:
        lo = by_id.get(str(name).strip().lower())
        if lo is None:
            _warn(f"{where}: outcomes: {name} is not a learning outcome in general.yaml")
        elif lo not in result:
            result.append(lo)
    return result


def badges(page_rel, outcomes: list[dict]) -> list[dict]:
    """Metadata for filters/course.lua: what the badges show and where they link."""
    href = posixpath.relpath("info/outcomes.html", posixpath.dirname(str(page_rel)) or ".")
    return [{"id": lo["id"], "title": lo.get("title") or "", "text": lo["text"], "href": f"{href}#{anchor(lo['id'])}"}
            for lo in outcomes]


def _assessed(assessment: dict | None) -> dict[str, list[str]]:
    """Learning outcome id -> names of the components whose matrix includes it."""
    if not assessment:
        return {}
    components = assessment.get("components") or {}
    items = components.get("items", []) if isinstance(components, dict) else components
    result: dict[str, list[str]] = {}
    for c in items or []:
        if isinstance(c, dict):
            for lo_id in c.get("matrix") or {}:
                result.setdefault(str(lo_id), []).append(str(c.get("name") or c.get("id") or "Component"))
    return result


def map_page(los: list[dict], covered: list[tuple], weeks: list, assessment: dict | None) -> str:
    """Markdown of the outcome map.

    ``covered``: (page, outcomes) for every page that names outcomes, in course
    order. ``weeks``: (number, label) of the course's weeks.
    """
    assessed = _assessed(assessment)
    pages_of: dict[str, list] = {lo["id"]: [] for lo in los}
    for page, outcomes in covered:
        for lo in outcomes:
            pages_of[lo["id"]].append(page)
    for lo in los:
        if not pages_of[lo["id"]]:
            _warn(f"general.yaml: learning outcome {lo['id']} is not covered by any page "
                  "(`outcomes` in the front matter of a page)")

    def link(page) -> str:
        return f"[{page.title}]({posixpath.relpath(str(page.rel), posixpath.dirname(MAP))})"

    other = any(p.week is None for p, _ in covered)
    columns = [str(n) for n, _ in weeks] + (["Other"] if other else [])
    out = ["---", "title: Outcome map", "---", "",
           "Which pages work towards each learning outcome, and where it is assessed. "
           "The columns are the weeks of the course"
           + (" (*Other*: pages outside the weeks, such as exams)" if other else "") + ".", "",
           "::: {.outcome-map}", "",
           "```{=typst}", "#set text(size: 8.5pt)", "```", "",
           "| Learning outcome | " + " | ".join(columns) + " | Assessed in |",
           "|:--|" + ":-:|" * len(columns) + ":--|"]
    for lo in los:
        weeks_of = {str(p.week) if p.week is not None else "Other" for p in pages_of[lo["id"]]}
        cells = ["●" if c in weeks_of else "" for c in columns]
        title = f"[**{lo['id']}**](#{anchor(lo['id'])})" + (f" {lo['title']}" if lo.get("title") else "")
        out.append(f"| {title} | " + " | ".join(cells) + f" | {', '.join(assessed.get(lo['id'], [])) or '–'} |")
    out += ["", ":::", ""]

    for lo in los:
        out += [f"## {label(lo)} {{#{anchor(lo['id'])}}}", "", lo["text"], ""]
        pages = pages_of[lo["id"]]
        groups = [("Lessons", [p for p in pages if p.kind in ("lecture", "week")]),
                  ("Assignments", [p for p in pages if p.kind in ("assignment", "assignments", "logbook")])]
        groups.append(("Other pages", [p for p in pages if p not in groups[0][1] + groups[1][1]]))
        for name, group in groups:
            if group:
                items = ", ".join(link(p) + (f" (week {p.week})" if p.week is not None else "") for p in group)
                out += [f"**{name}:** {items}", ""]
        if not pages:
            out += ["*No pages work towards this outcome yet.*", ""]
        if assessment is not None:
            out += [f"**Assessed in:** {', '.join(assessed.get(lo['id'], [])) or 'no component'}", ""]
    return "\n".join(out)
