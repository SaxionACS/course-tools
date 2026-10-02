"""Render ``info/general.yaml`` and ``info/assessment.yaml`` as Markdown pages.

See ``docs/course-info.md`` for the schema of both files.
"""

from __future__ import annotations

import html
import sys

from .models import BLOOM, BLOOM_ALIASES, GRADED, LEVEL_ALIASES, LEVELS, PILLARS, level_model_problems


def _cell(value) -> str:
    """Format a value for a pipe-table cell."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return " ".join(str(value).split()).replace("|", "\\|")


def _person(p) -> str:
    if isinstance(p, str):
        return p
    name = p.get("name", "")
    email = p.get("email")
    role = p.get("role")
    text = f"[{name}](mailto:{email})" if email else name
    return f"{text} ({role})" if role else text


def _separator(spec: list[tuple[str, int]]) -> str:
    """Pipe-table separator; Pandoc uses the dash counts as relative column widths."""
    cells = []
    for align, width in spec:
        dashes = "-" * max(width, 3)
        cells.append({"l": ":" + dashes, "r": dashes + ":", "c": ":" + dashes + ":"}[align])
    return "|" + "|".join(cells) + "|"


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def learning_outcomes(general: dict) -> list[dict]:
    result = []
    for i, lo in enumerate(general.get("learning_outcomes") or [], start=1):
        if isinstance(lo, str):
            lo = {"id": f"LO{i}", "text": lo}
        result.append({"id": str(lo.get("id", f"LO{i}")), "text": str(lo.get("text", "")).strip()})
    return result


def general_page(general: dict, has_assessment: bool, has_genai: bool = False) -> str:
    rows = [
        ("Course code", general.get("code")),
        ("Academic year", general.get("academic_year")),
        ("Period", general.get("period")),
        ("Credits", f"{general['credits']} EC" if general.get("credits") is not None else None),
        ("Language", general.get("language")),
        ("Programme", general.get("programme")),
    ]
    coordinator = general.get("coordinator")
    if coordinator:
        rows.append(("Coordinator", _person(coordinator)))
    lecturers = general.get("lecturers") or []
    if lecturers:
        rows.append(("Lecturers", ", ".join(_person(p) for p in lecturers)))

    out = ["---", "title: Course information", "---", ""]
    table = [(k, v) for k, v in rows if v not in (None, "")]
    if table:
        out += ["| | |", _separator([("l", 22), ("l", 78)])]
        out += [f"| **{k}** | {_cell(v)} |" for k, v in table]
        out.append("")

    for key, heading in (("description", "Description"), ("prerequisites", "Prerequisites")):
        if general.get(key):
            out += [f"## {heading}", "", str(general[key]).strip(), ""]

    los = learning_outcomes(general)
    if los:
        out += ["## Learning outcomes", "", "After successfully completing this course, you can:", ""]
        out += [f"- **{lo['id']}** – {lo['text']}" for lo in los]
        out.append("")

    out += _levels_section(general.get("levels"))

    if general.get("literature"):
        out += ["## Literature", ""]
        out += [f"- {item}" for item in general["literature"]]
        out.append("")

    links = general.get("links") or []
    if links or has_assessment or has_genai:
        out += ["## More information", ""]
        if has_assessment:
            out.append("- [Assessment](assessment.qmd)")
        if has_genai:
            out.append("- [Generative AI and academic integrity](genai.qmd)")
        out += [f"- [{link['title']}]({link['url']})" for link in links]
        out.append("")
    return "\n".join(out)


# --------------------------------------------------------------------------
# Course level (Saxion level model)
# --------------------------------------------------------------------------

def _mix_white(color: str, amount: float) -> str:
    """Lighten a #rrggbb colour by mixing in `amount` (0..1) of white."""
    rgb = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(c + (255 - c) * amount):02x}" for c in rgb)


def parse_levels(raw) -> tuple[dict[str, int], dict[str, str]]:
    """Read the `levels` mapping of general.yaml: pillar -> level (and notes)."""
    levels: dict[str, int] = {}
    notes: dict[str, str] = {}
    if not isinstance(raw, dict):
        _warn("general.yaml: `levels` must be a mapping (independence, complexity, interdisciplinarity)")
        return levels, notes
    keys = {p["key"] for p in PILLARS}
    for key in raw:
        if key not in keys:
            _warn(f"general.yaml: unknown pillar `{key}` in `levels` (use {', '.join(sorted(keys))})")
    for pillar in PILLARS:
        value = raw.get(pillar["key"])
        if isinstance(value, dict):
            if value.get("note"):
                notes[pillar["key"]] = str(value["note"]).strip()
            value = value.get("level")
        if value is None:
            _warn(f"general.yaml: no level for `{pillar['key']}` in `levels`")
            continue
        index = LEVEL_ALIASES.get(str(value).strip().lower())
        if index is None:
            _warn(f"general.yaml: level `{value}` for `{pillar['key']}` is not low, middle or high")
            continue
        levels[pillar["key"]] = index
    for problem in level_model_problems(levels):
        _warn(f"general.yaml: `levels`: {problem} (Saxion level model)")
    return levels, notes


def _levels_html(levels: dict[str, int]) -> str:
    summary = ", ".join(f"{p['name']} {LEVELS[levels[p['key']]]}" for p in PILLARS if p["key"] in levels)
    parts = [f'<div class="course-levels" role="img" aria-label="Course level: {html.escape(summary)}">']
    for pillar in PILLARS:
        selected = levels.get(pillar["key"])
        parts.append('<div class="course-levels-pillar">')
        parts.append(f'<div class="course-levels-name">{pillar["name"]}</div>')
        for index in reversed(range(len(LEVELS))):
            color = pillar["colors"][index]
            label = LEVELS[index].capitalize()
            if index == selected:
                parts.append(f'<div class="course-levels-tile selected" style="background:{color}">✓ {label}</div>')
            else:
                parts.append(f'<div class="course-levels-tile" style="background:{_mix_white(color, .55)}">{label}</div>')
        parts.append("</div>")
    parts.append("</div>")
    return "\n".join(parts)


def _levels_typst(levels: dict[str, int]) -> str:
    columns = []
    for pillar in PILLARS:
        selected = levels.get(pillar["key"])
        tiles = [f'align(center, text(size: 9.5pt, weight: "bold", "{pillar["name"]}"))']
        for index in reversed(range(len(LEVELS))):
            label = LEVELS[index].capitalize()
            if index == selected:
                tiles.append(f'tile("✓ {label}", rgb("{pillar["colors"][index]}"), true)')
            else:
                tiles.append(f'tile("{label}", rgb("{_mix_white(pillar["colors"][index], .55)}"), false)')
        columns.append("stack(spacing: 3pt, " + ", ".join(tiles) + ")")
    return "\n".join([
        "#{",
        "  let tile(label, fill, selected) = block(width: 100%, inset: (y: 6pt), radius: 2pt, fill: fill,",
        '    stroke: if selected { 1.2pt + rgb("#494c4e") } else { none },',
        "    align(center, text(size: 9pt, label,",
        '      weight: if selected { "bold" } else { "regular" },',
        '      fill: if selected { rgb("#262829") } else { rgb("#8a9095") })))',
        "  align(center, block(width: 85%, breakable: false, grid(",
        "    columns: (1fr, 1fr, 1fr), column-gutter: 10pt,",
        "    " + ",\n    ".join(columns) + ",",
        "  )))",
        "}",
    ])


def _levels_section(raw) -> list[str]:
    if not raw:
        return []
    levels, notes = parse_levels(raw)
    if not levels:
        return []
    out = [
        "## Course level", "",
        "The level of this course in the three pillars of the Saxion level model (ZelCom-i model):", "",
        "```{=html}", _levels_html(levels), "```", "",
        "```{=typst}", _levels_typst(levels), "```", "",
    ]
    for pillar in PILLARS:
        if pillar["key"] in levels:
            index = levels[pillar["key"]]
            text = pillar["descriptions"][index]
            if pillar["key"] in notes:
                text += f" *{notes[pillar['key']]}*"
            out.append(f"- **{pillar['name']}: {LEVELS[index]}.** {text}")
    out.append("")
    return out


# --------------------------------------------------------------------------
# Assessment
# --------------------------------------------------------------------------

def _num(value) -> str:
    return f"{value:g}" if isinstance(value, (int, float)) else _cell(value)


def _component_title(c: dict) -> str:
    return str(c.get("name") or c.get("id") or "Component")


def assessment_page(assessment: dict, general: dict) -> str:
    components = assessment.get("components") or []
    los = learning_outcomes(general)
    out = ["---", "title: Assessment", "---", ""]
    if assessment.get("introduction"):
        out += [str(assessment["introduction"]).strip(), ""]

    if components:
        out += ["## Components", ""]
        out += ["| Component | Form | Weight | Minimum grade | When | Resit |",
                _separator([("l", 20), ("l", 34), ("r", 10), ("r", 12), ("l", 13), ("l", 9)])]
        total = 0
        for c in components:
            weight = c.get("weight")
            if isinstance(weight, (int, float)):
                total += weight
            out.append(
                f"| **{_cell(_component_title(c))}** | {_cell(c.get('form'))} "
                f"| {_cell(f'{weight}%' if weight is not None else None)} | {_cell(c.get('minimum'))} "
                f"| {_cell(c.get('when'))} | {_cell(c.get('resit'))} |"
            )
        out.append("")
        if total and total != 100:
            _warn(f"assessment.yaml: component weights add up to {total}, not 100")

    if assessment.get("final_grade"):
        out += ["## Final grade", "", str(assessment["final_grade"]).strip(), ""]

    has_matrices = any(c.get("matrix") for c in components)
    if has_matrices:
        out += [
            "## Assessment matrices", "",
            "For every component, the matrix shows which learning outcomes it assesses, how much "
            "each one counts (as a percentage of the component), at which levels of "
            "[Bloom's taxonomy](#blooms-taxonomy), and whether it is graded individually or as a group.", "",
            "Learning outcomes:", "",
        ]
        out += [f"- **{lo['id']}** – {lo['text']}" for lo in los]
        out.append("")
    for c in components:
        if c.get("description") or c.get("matrix"):
            weight = c.get("weight")
            suffix = f" ({weight}%)" if has_matrices and weight is not None else ""
            out += [f"### {_component_title(c)}{suffix}", ""]
            if c.get("description"):
                out += [str(c["description"]).strip(), ""]
            if c.get("matrix"):
                out += _component_matrix(c, los)

    if has_matrices:
        assessed = {str(lo) for c in components for lo in (c.get("matrix") or {})}
        for lo in los:
            if lo["id"] not in assessed:
                _warn(f"assessment.yaml: learning outcome {lo['id']} is not assessed by any component")
        out += _bloom_legend(assessment.get("bloom_verbs") or {})
    return "\n".join(out)


def _component_matrix(component: dict, los: list[dict]) -> list[str]:
    """Matrix of one component: learning outcomes x Bloom levels, plus grading."""
    name = _component_title(component)
    matrix = {str(k): (v or {}) for k, v in (component.get("matrix") or {}).items()}
    known = [lo["id"] for lo in los]
    for lo_id in matrix:
        if lo_id not in known:
            _warn(f"assessment.yaml: {name}: {lo_id} is not a learning outcome in general.yaml")
    rows = [lo_id for lo_id in known if lo_id in matrix] + [k for k in matrix if k not in known]

    default_graded = component.get("graded")
    bloom_keys = [b["key"] for b in BLOOM]
    column_totals = dict.fromkeys(bloom_keys, 0)
    lines = [
        "::: {.assessment-matrix}", "",
        # PDF: the page is narrower than the screen; smaller text, and let long
        # Bloom level names in the header break (scoped to this matrix).
        "```{=typst}",
        "#set text(size: 8.5pt)",
        "#show table.cell.where(y: 0): set text(hyphenate: true)",
        "```", "",
        "| LO | " + " | ".join(b["name"] for b in BLOOM) + " | Total | Graded |",
        _separator([("l", 9)] + [("c", 13)] * len(BLOOM) + [("c", 9), ("l", 13)]),
    ]
    for lo_id in rows:
        row = matrix[lo_id]
        if not isinstance(row, dict):
            _warn(f"assessment.yaml: {name}: matrix row {lo_id} must be a mapping")
            continue
        values: dict[str, float] = {}
        graded = row.get("graded", default_graded)
        for key, value in row.items():
            if key == "graded":
                continue
            bloom = BLOOM_ALIASES.get(str(key).lower())
            if bloom is None:
                _warn(f"assessment.yaml: {name}, {lo_id}: `{key}` is not a Bloom level")
            elif not isinstance(value, (int, float)):
                _warn(f"assessment.yaml: {name}, {lo_id}: `{key}` must be a number")
            else:
                values[bloom] = values.get(bloom, 0) + value
                column_totals[bloom] += value
        graded_text = GRADED.get(str(graded).lower()) if graded is not None else None
        if graded is None:
            _warn(f"assessment.yaml: {name}, {lo_id}: not specified whether it is graded individually or as a group")
        elif graded_text is None:
            _warn(f"assessment.yaml: {name}, {lo_id}: graded `{graded}` is not individual or group")
            graded_text = _cell(graded)
        cells = [_num(values[k]) if k in values else "" for k in bloom_keys]
        lines.append(f"| **{_cell(lo_id)}** | " + " | ".join(cells)
                     + f" | **{_num(sum(values.values()))}** | {graded_text or ''} |")

    total = sum(column_totals.values())
    if total != 100:
        _warn(f"assessment.yaml: the matrix of {name} adds up to {total:g}%, not 100%")
    lines.append("| **Total** | " + " | ".join(f"**{_num(column_totals[k])}**" if column_totals[k] else "" for k in bloom_keys)
                 + f" | **{_num(total)}** | |")
    return lines + ["", ":::", ""]


def _bloom_legend(custom_verbs: dict) -> list[str]:
    verbs = {BLOOM_ALIASES.get(str(k).lower(), str(k)): v for k, v in custom_verbs.items()}
    out = [
        "## Bloom's taxonomy", "",
        "The levels of Bloom's taxonomy, from simple to complex, with examples of verbs that "
        "describe what students do at each level.", "",
        "| Level | Students can … | Example verbs |",
        _separator([("l", 16), ("l", 30), ("l", 54)]),
    ]
    for b in BLOOM:
        example = verbs.get(b["key"], b["verbs"])
        if isinstance(example, str):
            example = [example]
        out.append(f"| **{b['name']}** | {b['description']} | {_cell(', '.join(str(v) for v in example))} |")
    out.append("")
    return out


def default_home(general: dict) -> str:
    out = ["---", f"title: {_yaml_str(general.get('title', 'Course'))}", "---", ""]
    if general.get("description"):
        out += [str(general["description"]).strip(), ""]
    out += ["See the [course information](info/index.qmd) for details.", ""]
    return "\n".join(out)


def _yaml_str(s) -> str:
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'
