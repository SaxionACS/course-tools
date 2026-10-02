// Saxion styling for the PDF (Typst) version of every page.
// The running header and footer are added per page by filters/course.lua.
// Note: Markdown `##` headings are level-1 headings in Typst (the page title
// is rendered separately).

#let saxion-green = rgb("#009c82")
#let saxion-grey = rgb("#494c4e")
#let saxion-blue = rgb("#006fbf")

#show heading: set text(fill: saxion-grey)
#show heading.where(level: 1): set text(fill: saxion-green)
#show link: set text(fill: saxion-blue)
#show table: set par(justify: false)
