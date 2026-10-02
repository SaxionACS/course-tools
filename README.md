# course-tools

Shared tooling for Saxion ACS courses. Course content is written in Markdown
in a course repository; course-tools turns it into:

- a **website** on GitHub Pages, with a sidebar organised by week;
- **pages for Brightspace**: the same pages, embedded with a Brightspace web
  link. When a page is shown inside Brightspace (in an iframe), the sidebar,
  header and footer are hidden automatically;
- a **PDF of every page**, linked from a PDF button on the page.

Courses don't contain any build logic. They call the reusable workflow in this
repository, so fixes and improvements here reach all courses.

- [Requirements](requirements.md) and [`install.sh`](install.sh): local tools
- [Authoring guide](docs/authoring.md): how to write course content
- [Course information files](docs/course-info.md): `general.yaml`, `assessment.yaml` and `genAI.yaml`
- [Template course](https://github.com/SaxionACS/course_template): start a new course from it

## How it works

```
course repository ──► course stage ──► .build/ (Quarto project) ──► quarto render ──► dist/
  Markdown, YAML,      (Python)          pages as .qmd, generated                      website + PDFs
  slides PDFs,                           pages, starter zips,
  starter files                          _quarto.yml, theme, filters
```

1. `course` (Python, this repository) scans the course repository: weeks,
   lectures, assignments, slides, exams, references. Everything inside a
   `private` directory is skipped.
2. It generates a [Quarto](https://quarto.org) website project in `.build/`:
   - Markdown pages become `.qmd` files. A leading `# Title` becomes the page
     title, and ```` ```mermaid ```` / ```` ```plantuml ```` blocks become diagrams.
   - The course information, assessment and generative-AI policy pages are
     generated from `info/*.yaml`.
   - Starter files are zipped.
   - The sidebar is generated, organised by week.
3. Quarto renders every page to HTML and, with Typst, to PDF. The Lua filters
   in `src/course_tools/assets/filters` add the PDF button, the slides box
   and the starter-files box, and make links absolute in PDFs.
4. The result in `dist/` is a static website, which the workflow publishes to
   GitHub Pages.

## Local use

Install the tools once (see [requirements](requirements.md)):

```bash
git clone https://github.com/SaxionACS/course-tools.git
course-tools/install.sh
```

Then, in a course repository:

```bash
course preview      # live preview on http://localhost:4200 (HTML only)
course build        # website + PDFs in dist/
course doctor       # check the installed tools
course clean        # remove .build/ and dist/
```

## One-time setup on GitHub

These steps need an organisation owner, or someone with admin rights on the
repositories.

1. **Create this repository** as `SaxionACS/course-tools` and push it.
   - Make it **public** (recommended: it contains no course content). Then
     every course repository can use the workflow, and authors can install
     the tools without credentials.
   - If it has to be private: go to *Settings → Actions → General → Access*
     and choose "Accessible from repositories in the SaxionACS
     organization". Authors then install with `./install.sh --local` from a
     clone.
2. **Tag a release.** Courses refer to the major version tag `v1`:

   ```bash
   git tag v1.0.0 && git tag -f v1 && git push origin v1.0.0 && git push -f origin v1
   ```

   For a compatible fix, tag `v1.0.1` and move `v1` to it. All courses pick
   up the fix on their next build. For an incompatible change, release `v2`;
   courses switch by changing `@v1` (and `tools-ref`) in their workflow.
3. **Create the template repository** from `course_template` and mark it as a
   template (*Settings → General → Template repository*).

### For every new course

1. On GitHub, click *Use this template* on the template repository and create
   the course repository (private or public).
2. In the new repository, go to *Settings → Pages → Build and deployment →
   Source* and choose **GitHub Actions**.
3. Edit `info/general.yaml`, `README.md` and the content, then push to
   `main`. The *Publish* workflow builds the course and publishes it at
   `https://saxionacs.github.io/<repository>/`.

> **Visibility:** a GitHub Pages site is public, even when the repository is
> private. Only the `private` directories stay out of the site. They are
> still in the repository, so keep the repository private if it contains
> solutions or exams.

### Linking pages in Brightspace

In Brightspace, add a **link** (web link) topic with the URL of the page, and
make sure it is *not* set to open as an external resource or in a new window.
Brightspace then shows the page embedded, without the website sidebar. (The
exact menu names differ between the classic Content tool and Lessons.)

To check how a page looks when embedded, add `?embed=1` to its URL.

## Versions

The Quarto and PlantUML versions are pinned in
[`install.sh`](install.sh) and in the workflow inputs, so local builds and CI
builds are the same. To upgrade, change both, test with a course, and release
a new tag.
