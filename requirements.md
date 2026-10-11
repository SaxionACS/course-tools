# Requirements

Tools needed to build and preview courses locally. [`install.sh`](install.sh)
installs all of them on Ubuntu 24.04 LTS (also in WSL) and on macOS with
[Homebrew](https://brew.sh). The GitHub Actions workflow installs the same
versions in CI (on Ubuntu).

| Tool | Version | Used for | Ubuntu: installed by `install.sh` as | macOS: installed by `install.sh` as |
|:--|:--|:--|:--|:--|
| Python | ≥ 3.10 | runs `course-tools` | `python3` (apt) | dependency of `pipx` (Homebrew) |
| pipx | any | installs the `course` command in its own environment | `pipx` (apt) | `pipx` (Homebrew) |
| PyYAML | ≥ 6 | reads the course YAML files | dependency of course-tools (pipx) | dependency of course-tools (pipx) |
| [Quarto](https://quarto.org) | 1.10.18 | renders the website (HTML) and the PDFs; includes Pandoc and Typst | `.deb` from the Quarto GitHub releases | `.pkg` from the Quarto GitHub releases (`/Applications/quarto`, linked from `/usr/local/bin`) |
| Chrome Headless Shell | latest | renders Mermaid diagrams for PDFs | `quarto install chrome-headless-shell` | `quarto install chrome-headless-shell` |
| Java (JRE) | ≥ 11 | runs PlantUML | `default-jre-headless` (apt) | `openjdk` (Homebrew) |
| [PlantUML](https://plantuml.com) | 1.2026.8 | renders PlantUML diagrams | jar in `/usr/local/lib/plantuml`, wrapper `/usr/local/bin/plantuml` | jar in `/usr/local/lib/plantuml`, wrapper `/usr/local/bin/plantuml` |
| [Graphviz](https://graphviz.org) | any | layout engine PlantUML needs for all diagram types except sequence diagrams | `graphviz` (apt) | `graphviz` (Homebrew) |
| Lato font | any | body font of the PDFs | `fonts-lato` (apt) | `font-lato` (Homebrew cask), unless Lato is already installed |
| git, git-lfs | any | version control; LFS is optional (e.g. for large slide files) | apt | git: Xcode Command Line Tools (needed by Homebrew); git-lfs: Homebrew |
| zip, unzip, curl | any | downloads and archives | apt | included in macOS |

Notes:

- Mermaid diagrams on the website are drawn in the browser; Chrome is only
  needed for the PDFs.
- The Ubuntu `plantuml` package (version 2020) is too old; `install.sh`
  installs a current version that takes precedence on `PATH`. Alternatively,
  set `PLANTUML_JAR` to the path of a PlantUML jar.
- Check your installation with `course doctor`.

On macOS:

- Install [Homebrew](https://brew.sh) first; `install.sh` does not install it.
  `install.sh` asks for your password (sudo) to install Quarto and PlantUML in
  `/usr/local`, as on Ubuntu.
- Homebrew's Java is not on `PATH` (`/usr/bin/java` is a stub that only says
  that Java is missing), so the `plantuml` wrapper runs it directly. A
  `PLANTUML_JAR` therefore only works if `java` on `PATH` works.
- If Homebrew's own `plantuml` is installed, it comes first on `PATH`;
  `install.sh` warns about it. Uninstall it (`brew uninstall plantuml`) to use
  the pinned version.
- Homebrew's Graphviz is much newer than Ubuntu's (2.43), which CI uses. PlantUML
  diagrams other than sequence diagrams may be laid out slightly differently in
  a local build than on the published site.
