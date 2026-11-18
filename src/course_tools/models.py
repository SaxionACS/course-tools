"""Reference data: the Saxion level model, Bloom's and Krathwohl's taxonomies."""

from __future__ import annotations

# --------------------------------------------------------------------------
# Saxion level model (Saxion Niveaumodel 2.0, "ZelCom-i model"): three
# pillars, each with the levels low, middle and high. The descriptions are
# short English summaries of the model document; the colours are the ones
# used there.
# --------------------------------------------------------------------------

LEVELS = ("low", "middle", "high")
LEVEL_ALIASES = {
    "low": 0, "laag": 0,
    "middle": 1, "medium": 1, "midden": 1,
    "high": 2, "hoog": 2,
}

PILLARS = (
    {
        "key": "independence",
        "name": "Independence",
        "colors": ("#dae3f3", "#b4c7e7", "#8faadc"),
        "descriptions": (
            "Students work with instruction, guidance and supervision; their "
            "intermediate results are checked regularly.",
            "Students get guidance at set moments or on request, take most steps "
            "on their own and ask for help when needed.",
            "Students get little guidance, steer their own learning, make "
            "decisions independently and share responsibility for the work of others.",
        ),
    },
    {
        "key": "complexity",
        "name": "Complexity",
        "colors": ("#e2f0d9", "#c5e0b4", "#a9d18e"),
        "descriptions": (
            "Known problems with existing solutions, solved with standard "
            "procedures and basic knowledge and skills.",
            "Partly known problems; solutions come from combining insights and "
            "adapting standard procedures, using advanced knowledge.",
            "New problems without a standard approach; innovative solutions and "
            "new procedures are needed, under strict quality, ethical or legal requirements.",
        ),
    },
    {
        "key": "interdisciplinarity",
        "name": "Interdisciplinarity",
        "colors": ("#fff2cc", "#ffe699", "#ffd966"),
        "descriptions": (
            "The knowledge and skills of the own discipline are sufficient; few "
            "parties are involved.",
            "Knowledge and skills of other disciplines within the domain are "
            "needed, with several parties involved.",
            "Knowledge from other domains and collaboration across domains, with "
            "many stakeholders and experts, are needed.",
        ),
    },
)


def level_model_problems(levels: dict[str, int]) -> list[str]:
    """Combinations that do not occur in the ZelCom-i model."""
    problems = []
    inter = levels.get("interdisciplinarity")
    if inter is not None and inter > 0 and levels.get("complexity") == 0:
        problems.append("middle or high interdisciplinarity requires at least middle complexity")
    if inter == 2 and levels.get("independence") == 0:
        problems.append("high interdisciplinarity requires at least middle independence")
    return problems


# --------------------------------------------------------------------------
# Bloom's taxonomy (revised). The example verbs are the technical verbs used
# at ACS; a course can replace them in assessment.yaml (`bloom_verbs`).
# --------------------------------------------------------------------------

BLOOM = (
    {
        "key": "remembering",
        "name": "Remembering",
        "description": "recall facts and basic concepts",
        "verbs": ["cite", "enumerate", "quote", "repeat"],
    },
    {
        "key": "understanding",
        "name": "Understanding",
        "description": "explain ideas and concepts",
        "verbs": ["annotate", "comment", "follow", "rephrase"],
    },
    {
        "key": "applying",
        "name": "Applying",
        "description": "use knowledge and skills in a new situation",
        "verbs": [
            "backup", "build", "chart", "compile", "compute", "configure", "connect",
            "decrypt", "delete", "deploy", "document", "encourage", "encrypt",
            "experiment", "hash", "install", "interview", "iterate", "measure", "patch",
            "randomize", "recover", "relate", "restore", "schedule", "store", "teach",
            "test", "virtualize",
        ],
    },
    {
        "key": "analyzing",
        "name": "Analyzing",
        "description": "break information into parts and find relations",
        "verbs": [
            "articulate", "automate", "break down", "contextualize", "correlate", "detect",
            "facilitate", "generalize", "integrate", "maintain", "model", "monitor",
            "parallelize", "predict", "promote", "simulate", "transform", "translate", "update",
        ],
    },
    {
        "key": "evaluating",
        "name": "Evaluating",
        "description": "justify a decision or a course of action",
        "verbs": [
            "abstract", "adapt", "administer", "balance", "debug", "decide", "defend",
            "delegate", "derive", "experiment", "hack", "moderate", "optimize",
            "prioritize", "protect", "prove", "reflect", "validate",
        ],
    },
    {
        "key": "creating",
        "name": "Creating",
        "description": "produce new or original work",
        "verbs": [
            "code", "collaborate", "compose", "generate", "program", "propose",
            "reengineer", "refactor", "script", "secure", "visualize",
        ],
    },
)

BLOOM_ALIASES = {
    "remember": "remembering", "remembering": "remembering",
    "understand": "understanding", "understanding": "understanding",
    "apply": "applying", "applying": "applying",
    "analyze": "analyzing", "analyse": "analyzing", "analyzing": "analyzing", "analysing": "analyzing",
    "evaluate": "evaluating", "evaluating": "evaluating",
    "create": "creating", "creating": "creating",
}

# --------------------------------------------------------------------------
# Krathwohl's taxonomy of the affective domain (Krathwohl, Bloom & Masia,
# 1964): attitudes and values, by how far a student has made them their own.
# The example verbs avoid the ACS verbs of Bloom's levels; a course can
# replace them in assessment.yaml (`krathwohl_verbs`).
# --------------------------------------------------------------------------

KRATHWOHL = (
    {
        "key": "receiving",
        "name": "Receiving",
        "description": "pay attention to ideas, practices and the views of others",
        "verbs": ["accept", "acknowledge", "ask", "attend", "listen", "notice", "observe"],
    },
    {
        "key": "responding",
        "name": "Responding",
        "description": "take part actively and respond willingly",
        "verbs": ["answer", "assist", "comply", "contribute", "discuss", "help", "participate", "present", "report"],
    },
    {
        "key": "valuing",
        "name": "Valuing",
        "description": "attach worth to an idea or practice and commit to it",
        "verbs": ["advocate", "appreciate", "commit", "initiate", "justify", "share", "support", "value"],
    },
    {
        "key": "organizing",
        "name": "Organizing",
        "description": "combine different values into a consistent whole, resolving conflicts between them",
        "verbs": ["combine", "formulate", "harmonize", "order", "organize", "reconcile", "systematize", "weigh"],
    },
    {
        "key": "characterizing",
        "name": "Characterizing",
        "description": "act consistently on their own values, as part of who they are",
        "verbs": ["act", "champion", "display", "exemplify", "influence", "internalize", "practice", "question", "uphold"],
    },
)

KRATHWOHL_ALIASES = {
    "receive": "receiving", "receiving": "receiving",
    "respond": "responding", "responding": "responding",
    "value": "valuing", "valuing": "valuing",
    "organize": "organizing", "organise": "organizing", "organizing": "organizing", "organising": "organizing",
    "organization": "organizing", "organisation": "organizing",
    "characterize": "characterizing", "characterise": "characterizing", "characterizing": "characterizing",
    "characterising": "characterizing", "characterization": "characterizing", "characterisation": "characterizing",
    "internalize": "characterizing", "internalise": "characterizing", "internalizing": "characterizing",
    "internalising": "characterizing",
}

# The two taxonomies of the assessment matrices, in the order of the page.
# `domain` names the kind of learning outcome; `verbs` is the key in
# assessment.yaml that replaces example verbs; `anchor` is the id of the legend.
TAXONOMIES = (
    {"key": "bloom", "name": "Bloom's taxonomy", "domain": "cognitive", "scope": "knowledge and thinking skills",
     "levels": BLOOM, "aliases": BLOOM_ALIASES, "verbs": "bloom_verbs", "anchor": "blooms-taxonomy"},
    {"key": "krathwohl", "name": "Krathwohl's taxonomy", "domain": "affective", "scope": "attitudes and values",
     "levels": KRATHWOHL, "aliases": KRATHWOHL_ALIASES, "verbs": "krathwohl_verbs", "anchor": "krathwohls-taxonomy"},
)

GRADED = {"individual": "Individual", "individually": "Individual", "group": "Group"}


# --------------------------------------------------------------------------
# Generative-AI policy levels for the assignments of a course (genAI.yaml),
# in order. `default` is what applies to an assignment unless it says
# otherwise; `override` says whether an assignment may deviate from it (front
# matter `genai: allowed | tutor | not-allowed`). The texts are templates:
# the policy page genAI/<level>.md, the box of an assignment
# genAI/assignment-<use>.md (assets/templates/, templates.py).
# --------------------------------------------------------------------------

# What an assignment allows: GenAI may be used (with citation), only as a
# tutor (to explain; nothing generated is handed in), or not at all.
GENAI_USES = ("allowed", "tutor", "not-allowed")

GENAI_LEVELS = {
    "not-allowed": {"default": "not-allowed", "override": False},
    "tutor": {"default": "tutor", "override": True},
    "not-allowed-unless-stated": {"default": "not-allowed", "override": True},
    "allowed-with-citation": {"default": "allowed", "override": True},
    "custom": {"default": None, "override": True},
}

GENAI_ALIASES = {str(i): key for i, key in enumerate(GENAI_LEVELS, start=1)}
