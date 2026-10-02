# Requirements

Tools needed to build and preview courses locally. [`install.sh`](install.sh)
installs all of them on Ubuntu 24.04 LTS (also in WSL). The GitHub Actions
workflow installs the same versions in CI.

| Tool | Version | Used for | Installed by `install.sh` as |
|:--|:--|:--|:--|
| Python | ≥ 3.10 | runs `course-tools` | `python3` (apt) |
| pipx | any | installs the `course` command in its own environment | `pipx` (apt) |
| PyYAML | ≥ 6 | reads the course YAML files | dependency of course-tools (pipx) |
| [Quarto](https://quarto.org) | 1.10.18 | renders the website (HTML) and the PDFs; includes Pandoc and Typst | `.deb` from the Quarto GitHub releases |
| Chrome Headless Shell | latest | renders Mermaid diagrams for PDFs | `quarto install chrome-headless-shell` |
| Java (JRE) | ≥ 11 | runs PlantUML | `default-jre-headless` (apt) |
| [PlantUML](https://plantuml.com) | 1.2026.8 | renders PlantUML diagrams | jar in `/usr/local/lib/plantuml`, wrapper `/usr/local/bin/plantuml` |
| [Graphviz](https://graphviz.org) | any | layout engine PlantUML needs for all diagram types except sequence diagrams | `graphviz` (apt) |
| Lato font | any | body font of the PDFs | `fonts-lato` (apt) |
| git, git-lfs | any | version control; LFS is optional (e.g. for large slide files) | apt |
| zip, unzip, curl | any | downloads and archives | apt |

Notes:

- Mermaid diagrams on the website are drawn in the browser; Chrome is only
  needed for the PDFs.
- The Ubuntu `plantuml` package (version 2020) is too old; `install.sh`
  installs a current version that takes precedence on `PATH`. Alternatively,
  set `PLANTUML_JAR` to the path of a PlantUML jar.
- Check your installation with `course doctor`.
