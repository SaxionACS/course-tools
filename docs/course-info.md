# Course information files

Three YAML files in `info/` describe the course. They are rendered as the
pages *Course information*, *Assessment* and *Generative AI and academic
integrity*. All text fields may contain Markdown. See the template course for
a complete example.

## `info/general.yaml`

| Field | Description |
|:--|:--|
| `title` | **Required.** Course name; also the website title. |
| `code` | Course code. |
| `academic_year` | E.g. `2026-2027`. |
| `period` | E.g. `Quartile 1`. |
| `credits` | Number of EC. |
| `language` | Language of instruction. |
| `programme` | E.g. `Applied Computer Science`. |
| `coordinator` | `{name, email}`. |
| `lecturers` | List of `{name, email, role}`. |
| `description` | Course description (Markdown). |
| `prerequisites` | Required prior knowledge (Markdown). |
| `learning_outcomes` | List of `{id, text}`. The `id` (e.g. `LO1`) is used in the assessment matrices. |
| `levels` | Level of the course in the Saxion level model (see below). |
| `literature` | List of strings (Markdown). |
| `links` | List of `{title, url}`, e.g. the module manual. |

### Course level (Saxion level model)

The Saxion level model (*Saxion Niveaumodel 2.0*, ZelCom-i model) describes
the level of a course in three pillars, each `low`, `middle` or `high`
(`laag`, `midden`, `hoog` also work):

```yaml
levels:
  independence: low
  complexity: middle
  interdisciplinarity: low
```

The course information page shows the three pillars as columns of tiles, in
the colours of the model, with the course's levels highlighted. Below them is
a short description of each of those levels. To add an explanation for this
course, use the long form:

```yaml
levels:
  independence: low
  complexity: { level: middle, note: "You adapt known algorithms to new problems." }
  interdisciplinarity: low
```

The build warns about combinations that don't occur in the model. Middle or
high interdisciplinarity requires at least middle complexity. High
interdisciplinarity requires at least middle independence.

## `info/assessment.yaml`

| Field | Description |
|:--|:--|
| `introduction` | Text at the top of the page. |
| `components` | List of assessment components (see below). |
| `final_grade` | How the final grade is determined. |
| `bloom_verbs` | Optional: other example verbs for the Bloom legend (see below). |

Each component has:

| Field | Description |
|:--|:--|
| `id` | Short id, e.g. `EXAM`. |
| `name` | E.g. `Written exam`. |
| `form` | Form of the assessment. |
| `weight` | Percentage of the final grade. |
| `when` | E.g. `Week 9`. |
| `graded` | `individual` or `group`: default for the learning outcomes in the matrix. |
| `description` | Longer description (Markdown), shown above the matrix. |
| `matrix` | The assessment matrix of this component (see below). |
| `rubric` | Optional: rough grading criteria of this component (see below). |

### Assessment matrices

Every component has its own matrix. It lists the learning outcomes that the
component assesses; leave out the outcomes it doesn't assess. For each
learning outcome, give the weight per level of Bloom's taxonomy, as a
percentage of the component. All numbers in one matrix add up to 100.

```yaml
components:
  - id: PORT
    name: Portfolio
    weight: 40
    graded: group                  # default for this component
    matrix:
      LO2: { analyzing: 10, graded: individual }    # override per learning outcome
      LO3: { applying: 40, evaluating: 20, creating: 30 }
```

The Bloom levels are `remembering`, `understanding`, `applying`, `analyzing`,
`evaluating` and `creating`. The short forms (`remember`, `apply`, …) and the
British spellings (`analyse`, `analysing`) also work.

The page starts with a *Learning outcomes* section listing all learning
outcomes of `general.yaml`. Then it shows a table for each component. Each row
is a learning outcome, with columns for the six Bloom levels, a total, and
whether it is graded individually or as a group. A *Total* row closes the
table. Below all matrices is a legend of Bloom's taxonomy with example verbs.

The build warns:

- when a matrix doesn't add up to 100;
- when the component weights don't add up to 100;
- when an id doesn't match a learning outcome in `general.yaml`;
- when a key is not a Bloom level;
- when `graded` is missing or is not `individual` / `group`;
- when a learning outcome isn't assessed by any component.

### Grading criteria (rubric)

A component can have rough grading criteria, for example for a project. This
is optional and meant for the few cases where the criteria should be on the
website; the detailed rubric stays in Brightspace.

```yaml
components:
  - id: CAP
    name: Capstone project
    weight: 40
    matrix:
      LO5: { applying: 30, analyzing: 20, evaluating: 20, creating: 30 }
    rubric:
      learning_outcomes: [LO5]      # optional; default: the learning outcomes in the matrix
      description: |                # optional; shown above the table (Markdown)
        The project is graded at the demonstration in week 10.
      criteria:
        - name: Working functionality
          points: 30                # a maximum: 0 to 30
          description: The project meets the specified requirements and functions correctly.
        - name: Teamwork
          points: [-20, 0]          # a range, e.g. for deductions
          description: Points are deducted for students not contributing to the project.
      grading: |
        How the points become a grade (Markdown).
```

The Assessment page shows the criteria below the matrix of the component,
under the heading *Grading criteria (LO5)*: first the `description`, then a
table (criterion, points, description), then the `grading` text. Nothing is calculated: you
describe in `grading` how the points lead to a grade.

The build warns when a criterion has no `name` or no valid `points`, or when a
learning outcome of the rubric is not in `general.yaml` or not in the matrix of
the component.

### Bloom legend

The legend uses the ACS list of technical verbs. To use other examples for
some levels, add for example:

```yaml
bloom_verbs:
  applying: [implement, test, measure]
```

## `info/genAI.yaml`

The generative-AI (GenAI) policy for the assignments of the course. It is
rendered as the page *Generative AI and academic integrity*, which contains:

- the policy, with examples of what is and isn't allowed;
- how to cite GenAI: a comment with tool, date and prompt for a short piece of
  code, and a `GENAI.md` file for more (following the Saxion GenAI Student
  Guide and the APA guidelines for GenAI);
- Saxion's rules for responsible use (personal and confidential data, Copilot);
- the rules against plagiarism (*Your own work*) and their consequences;
- that examiners may always hold an extra oral check of a student's work.

| Field | Description |
|:--|:--|
| `level` | **Required.** One of the five levels below. |
| `description` | Rules specific to the course (Markdown). Required for `custom`; for the other levels it is added as "Additional rules for this course". |

| `level` | Meaning | Assignment default | Assignment can deviate? |
|:--|:--|:--|:--|
| `not-allowed` | GenAI is not allowed in any assignment. | not allowed | no |
| `tutor` | GenAI may only be used as a tutor, to explain things; nothing it generates may be handed in. | tutor | yes |
| `not-allowed-unless-stated` | Not allowed, unless an assignment explicitly allows it. | not allowed | yes |
| `allowed-with-citation` | Allowed, if every use is cited. This is Saxion's default when a module guide says nothing. | allowed | yes |
| `custom` | The course's own rules, in `description`. | see the rules | yes |

The numbers `1` to `5` also work as levels, in the order of the table.

Every assignment page gets a box at the top that says what is allowed in it
— *allowed, with citation*, *as a tutor only* or *not allowed* — with a link
to the policy page. An assignment deviates from the course default in its
front matter:

```yaml
---
genai: allowed               # or: tutor, not-allowed
---
```

or, with a note shown in the box:

```yaml
---
genai:
  use: allowed
  note: Use it for the tests only; write `is_balanced` yourself.
---
```

The texts of the policy page are in `src/course_tools/assets/texts/genai/` in
course-tools. Changes there apply to all courses.

Without `info/genAI.yaml`, the build warns, and there is no policy page and
no boxes on the assignments. Saxion's general rule then applies: GenAI is
allowed, with citation.
