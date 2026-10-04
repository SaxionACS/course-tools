"""Helpers for reading and rewriting the Markdown sources.

Authors write plain (GitHub-flavoured) Markdown. Before Quarto sees a page, it
is adjusted so that GitHub conventions map onto Quarto features:

* a ```` ```mermaid ```` block becomes a Quarto ``{mermaid}`` diagram cell,
  centred unless it sets ``%%| fig-align:`` itself;
* a ```` ```plantuml ```` block becomes a ``{.plantuml}`` block for the
  diagram filter;
* executable-cell syntax such as ```` ```{python} ```` is turned into a plain
  highlighted block, because course code is shown, never run;
* a leading ``# Heading`` becomes the page title when there is no ``title``
  in the front matter.
"""

from __future__ import annotations

import re

import yaml

_FRONT_MATTER = re.compile(
    r"\A---[ \t]*\r?\n(.*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|\Z)", re.S
)
_FENCE = re.compile(r"^(?P<indent>[ \t]{0,3})(?P<fence>`{3,}|~{3,})[ \t]*(?P<info>.*?)[ \t]*$")
_CELL = re.compile(r"\{\s*([A-Za-z][\w+-]*)(.*)\}")
_ATX_H1 = re.compile(r"^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$")
_HEADING_ATTRS = re.compile(r"[ \t]*\{[^}]*\}$")
_MERMAID_ALIGN = re.compile(r"^\s*%%\|\s*fig-align\s*:")

# Diagram cells that Quarto renders itself.
QUARTO_DIAGRAMS = {"mermaid", "dot"}
# Diagram languages rendered by the diagram filter.
FILTER_DIAGRAMS = {"plantuml": "plantuml", "puml": "plantuml"}


def split_front_matter(text: str) -> tuple[dict, str]:
    """Return the YAML front matter (as a dict) and the remaining body."""
    text = text.lstrip("﻿")
    m = _FRONT_MATTER.match(text)
    if not m:
        return {}, text
    meta = yaml.safe_load(m.group(1)) or {}
    if not isinstance(meta, dict):
        return {}, text
    return meta, text[m.end():]


def join_front_matter(meta: dict, body: str) -> str:
    dumped = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=1000)
    return f"---\n{dumped}---\n\n{body.lstrip()}"


def _rewrite_info(info: str) -> str:
    if info == "mermaid":
        return "{mermaid}"
    if info in FILTER_DIAGRAMS:
        return "{." + FILTER_DIAGRAMS[info] + "}"
    m = _CELL.fullmatch(info)
    if not m:
        return info
    lang, rest = m.group(1), m.group(2)
    if lang in QUARTO_DIAGRAMS:
        return info
    return "{." + FILTER_DIAGRAMS.get(lang, lang) + rest + "}"


def rewrite_fences(body: str) -> str:
    """Rewrite the info strings of opening code fences (see module docstring)."""
    out = []
    open_fence = None
    lines = body.splitlines(keepends=True)
    for i, line in enumerate(lines):
        content = line.rstrip("\r\n")
        m = _FENCE.match(content)
        if open_fence is None:
            if m:
                open_fence = m.group("fence")
                info = _rewrite_info(m.group("info"))
                if info != m.group("info"):
                    line = f"{m.group('indent')}{open_fence}{info}{line[len(content):]}"
                if info == "{mermaid}" and not _sets_alignment(lines, i + 1):
                    # Diagrams are centred by default (opt out: %%| fig-align: left).
                    line = line.rstrip("\r\n") + "\n" + f"{m.group('indent')}%%| fig-align: center\n"
        elif (
            m
            and not m.group("info")
            and m.group("fence")[0] == open_fence[0]
            and len(m.group("fence")) >= len(open_fence)
        ):
            open_fence = None
        out.append(line)
    return "".join(out)


def _sets_alignment(lines: list[str], start: int) -> bool:
    """Whether the `%%|` cell options at the start of a Mermaid block set fig-align."""
    for line in lines[start:]:
        if not line.lstrip().startswith("%%|"):
            return False
        if _MERMAID_ALIGN.match(line):
            return True
    return False


def separate_thematic_breaks(body: str) -> str:
    """Put a blank line after a `---` horizontal rule that is followed by text.

    GitHub shows `---` followed by e.g. `## Heading` as a horizontal rule, but
    Pandoc/Quarto read it as the start of a YAML metadata block (and fail).
    A `---` directly below a line of text is a heading underline; it is left
    alone.
    """
    lines = body.splitlines(keepends=True)
    out = []
    open_fence = None
    for i, line in enumerate(lines):
        content = line.rstrip("\r\n")
        m = _FENCE.match(content)
        if open_fence is None and m:
            open_fence = m.group("fence")
        elif open_fence is not None:
            if m and not m.group("info") and m.group("fence")[0] == open_fence[0] \
                    and len(m.group("fence")) >= len(open_fence):
                open_fence = None
        elif (content.strip() == "---"
              and (i == 0 or not lines[i - 1].strip())
              and i + 1 < len(lines) and lines[i + 1].strip()):
            out.append(line if line.endswith("\n") else line + "\n")
            out.append("\n")
            continue
        out.append(line)
    return "".join(out)


def pop_leading_h1(body: str) -> tuple[str | None, str]:
    """If the body starts with a level-1 ATX heading, remove it and return its text."""
    lines = body.splitlines(keepends=True)
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines):
        m = _ATX_H1.match(lines[i].rstrip("\r\n"))
        if m:
            title = _HEADING_ATTRS.sub("", m.group(1)).strip()
            return title, "".join(lines[:i] + lines[i + 1:])
    return None, body


def title_from_name(stem: str) -> str:
    """``lecture1`` -> ``Lecture 1``, ``graph_search`` -> ``Graph search``."""
    words = re.sub(r"[_-]+", " ", stem)
    words = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", words).strip()
    return words[:1].upper() + words[1:]


def natural_key(name: str) -> list:
    """Sort key that orders ``lecture2`` before ``lecture10``."""
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", name)]
