#!/usr/bin/env bash
# Install everything needed to build and preview Saxion ACS courses locally.
# Tested on Ubuntu 24.04 LTS (also works in WSL). See requirements.md.
#
# Usage:
#   ./install.sh            install course-tools from GitHub (tag $TOOLS_REF)
#   ./install.sh --local    install course-tools from this directory (editable,
#                           for working on course-tools itself)
#
# Versions can be overridden with environment variables, e.g.
#   QUARTO_VERSION=1.10.18 PLANTUML_VERSION=1.2026.8 ./install.sh

set -euo pipefail

QUARTO_VERSION="${QUARTO_VERSION:-1.10.18}"
PLANTUML_VERSION="${PLANTUML_VERSION:-1.2026.8}"
TOOLS_REF="${TOOLS_REF:-v1}"
TOOLS_REPO="https://github.com/SaxionACS/course-tools"
PLANTUML_DIR=/usr/local/lib/plantuml

LOCAL=0
if [[ "${1:-}" == "--local" ]]; then
  LOCAL=1
elif [[ $# -gt 0 ]]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

if [[ $EUID -eq 0 ]]; then
  echo "Run this script as your normal user; it uses sudo where needed." >&2
  exit 1
fi

step() { printf '\n==> %s\n' "$*"; }

step "System packages (Python, pipx, Java and Graphviz for PlantUML, Lato font, git-lfs)"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates curl git git-lfs python3 python3-venv pipx \
  default-jre-headless graphviz fonts-lato zip unzip

step "Quarto ${QUARTO_VERSION}"
if command -v quarto >/dev/null && [[ "$(quarto --version)" == "${QUARTO_VERSION}" ]]; then
  echo "Quarto ${QUARTO_VERSION} is already installed."
else
  tmp="$(mktemp -d)"
  curl -fsSL -o "${tmp}/quarto.deb" \
    "https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/quarto-${QUARTO_VERSION}-linux-amd64.deb"
  sudo apt-get install -y "${tmp}/quarto.deb"
  rm -rf "${tmp}"
fi

step "Chrome Headless Shell (renders Mermaid diagrams for PDFs)"
quarto install chrome-headless-shell --no-prompt

step "PlantUML ${PLANTUML_VERSION}"
jar="${PLANTUML_DIR}/plantuml-${PLANTUML_VERSION}.jar"
if [[ ! -f "${jar}" ]]; then
  sudo mkdir -p "${PLANTUML_DIR}"
  sudo curl -fsSL -o "${jar}" \
    "https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml-${PLANTUML_VERSION}.jar"
fi
# /usr/local/bin comes before /usr/bin, so this wrapper takes precedence over
# the (much older) plantuml package from Ubuntu.
sudo tee /usr/local/bin/plantuml >/dev/null <<EOF
#!/bin/sh
exec java -Djava.awt.headless=true -jar "${jar}" "\$@"
EOF
sudo chmod +x /usr/local/bin/plantuml

step "course-tools"
if [[ ${LOCAL} -eq 1 ]]; then
  pipx install --force --editable "$(cd "$(dirname "$0")" && pwd)"
else
  pipx install --force "git+${TOOLS_REPO}@${TOOLS_REF}"
fi
pipx ensurepath >/dev/null

step "Check"
export PATH="${HOME}/.local/bin:${PATH}"
course doctor

echo
echo "Done. Open a new terminal (so PATH is updated), go to a course repository and run:"
echo "  course preview    # live preview at http://localhost:4200"
echo "  course build      # website + PDFs in dist/"
