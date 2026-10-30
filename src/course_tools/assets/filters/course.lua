--[[
Course page decorations and link handling.

* HTML: a "PDF" download button at the top of every page.
* Lectures: a "Slides" box with the slides PDF, or "No presentation yet".
* Assignments: whether generative AI is allowed (from the course's GenAI
  policy), and a box with the starter-files zip if there are starter files.
* Logbooks (Markdown files students fill in): a download/preview box on the
  assignment, and a note on the preview page.
* Every page: a footer with the dates from version control (added, last
  changed and by whom).
* Diagrams (Mermaid, PlantUML) are centred unless they set `fig-align`.
* Code annotations (`// <1>` + a numbered list after the code block): C
  markers are converted to the form Quarto expects; in PDFs the markers become
  circled numbers.
* Links to other course pages may be written as `page.md` / `README.md`.
* PDF (Typst): relative links become absolute links to the published site,
  and every page gets a running header and footer.

The stager provides the data as metadata: `course-site` (project-wide) and
`course-page` (per page).
]]

local is_html = quarto.doc.is_format('html')
local is_typst = quarto.doc.is_format('typst')

local site = {}
local page = {}

local function str(v)
  if v == nil then return nil end
  return pandoc.utils.stringify(v)
end

local function input_dir()
  return pandoc.path.directory(quarto.doc.input_file)
end

local function input_stem()
  return (pandoc.path.split_extension(pandoc.path.filename(quarto.doc.input_file)))
end

local function normalize(path)
  local parts = {}
  for seg in path:gmatch('[^/]+') do
    if seg == '..' then
      if #parts > 0 then table.remove(parts) end
    elseif seg ~= '.' then
      table.insert(parts, seg)
    end
  end
  return table.concat(parts, '/')
end

local function site_url(path)
  local base = str(site.url) or ''
  if base == '' then return nil end
  local dir = str(page.dir) or ''
  if dir ~= '' then path = dir .. '/' .. path end
  return base .. '/' .. normalize(path)
end

local function typst_string(s)
  s = (s or ''):gsub('\\', '\\\\'):gsub('"', '\\"')
  return '"' .. s .. '"'
end

local function callout(kind, title, blocks)
  local node = quarto.Callout({type = kind, title = title, content = blocks, appearance = 'simple'})
  return node
end

-- Decorations -----------------------------------------------------------

-- Link to a file to download as-is (not rewritten to a page link).
local function download_link(href)
  local name = href:match('([^/]+)$')
  return pandoc.Link(pandoc.Code(name), href, '', pandoc.Attr('', {'course-download'}, {{'download', ''}}))
end

-- Box at the top of an assignment with its logbook(s).
local function logbooks_box(logbooks)
  local T = pandoc.Inlines
  local lines = pandoc.List()
  for _, lb in ipairs(logbooks) do
    lines:insert(T('Download ') .. {download_link(str(lb.download))}
      .. T(' and fill it in, or ') .. {pandoc.Link('preview it online', str(lb.preview))} .. T('.'))
  end
  local content
  if #lines == 1 then
    content = {pandoc.Para(lines[1])}
  else
    content = {pandoc.BulletList(lines:map(function(l) return {pandoc.Plain(l)} end))}
  end
  return callout('note', #lines == 1 and 'Logbook' or 'Logbooks', content)
end

-- Footer: when the source was added and last changed (from git).
local function history_footer(h)
  local lines = {}
  if h.added ~= nil then
    table.insert(lines, 'Added on ' .. str(h.added) .. '.')
  end
  if h.changed ~= nil then
    table.insert(lines, 'Last changed on ' .. str(h.changed) .. ' by ' .. str(h.author) .. '.')
  end
  if is_typst then
    local text = {}
    for _, line in ipairs(lines) do table.insert(text, '#' .. typst_string(line)) end
    return pandoc.RawBlock('typst', '#v(1.5em)\n#line(length: 100%, stroke: 0.5pt + luma(190))\n'
      .. '#text(size: 8.5pt, fill: luma(110))[' .. table.concat(text, ' \\ ') .. ']')
  end
  local blocks = {pandoc.HorizontalRule()}
  for _, line in ipairs(lines) do table.insert(blocks, pandoc.Para(pandoc.Inlines(line))) end
  return pandoc.Div(blocks, pandoc.Attr('', {'course-history'}))
end

-- Markdown from the metadata, already parsed by Pandoc: one paragraph is Inlines.
local function meta_blocks(v)
  if pandoc.utils.type(v) == 'Inlines' then return pandoc.Blocks({pandoc.Para(v)}) end
  if pandoc.utils.type(v) == 'Blocks' then return v end
  if v ~= nil then return pandoc.Blocks({pandoc.Para(pandoc.Inlines(str(v)))}) end
  return pandoc.Blocks({})
end

-- Box at the top of an assignment: is generative AI allowed in it? Its title
-- and text come from the template genAI/assignment-<use>.md (genai.py).
local KINDS = {allowed = 'tip', tutor = 'note', ['not-allowed'] = 'warning'}
local function genai_box(rule)
  local blocks = meta_blocks(rule.text)
  blocks:extend(meta_blocks(rule.note))
  return callout(KINDS[str(rule.use)] or 'note', rule.title, blocks)
end

local function html_escape(s)
  s = s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')
  return (s:gsub('"', '&quot;'))
end

-- Reading time in minutes: about 200 words and 20 lines of code a minute.
local function reading_minutes(blocks)
  local words, lines = 0, 0
  blocks:walk({
    Str = function() words = words + 1 end,
    CodeBlock = function(cb) lines = lines + select(2, cb.text:gsub('\n', '')) + 1 end,
  })
  return math.max(1, math.floor(words / 200 + lines / 20 + 0.5))
end

-- The learning outcomes of the page (`outcomes` in its front matter): their
-- titles (or ids), linking to the outcome map; the full outcome on hover
-- (head.html). With the reading time.
local function outcomes_banner(outcomes, minutes)
  if is_html then
    local badges = {}
    for _, lo in ipairs(outcomes) do
      local id, title = str(lo.id), str(lo.title) or ''
      table.insert(badges, '<a class="course-outcome" href="' .. html_escape(str(lo.href)) .. '" data-text="'
        .. html_escape(id .. ': ' .. str(lo.text)) .. '">'
        .. (title ~= '' and ('<span class="course-outcome-id">' .. html_escape(id) .. '</span>' .. html_escape(title))
            or html_escape(id)) .. '</a>')
    end
    return pandoc.RawBlock('html', '<div class="course-outcomes"><span class="course-outcomes-label">Learning outcomes</span>'
      .. table.concat(badges) .. '<span class="course-reading-time">about ' .. minutes .. ' min read</span></div>')
  end
  local inlines = pandoc.Inlines({pandoc.Strong(pandoc.Inlines('Learning outcomes:')), pandoc.Space()})
  for i, lo in ipairs(outcomes) do
    if i > 1 then inlines:extend({pandoc.Str(','), pandoc.Space()}) end
    local id, title = str(lo.id), str(lo.title) or ''
    inlines:insert(pandoc.Link(pandoc.Inlines(title ~= '' and (title .. ' (' .. id .. ')') or id), str(lo.href)))
  end
  inlines:extend(pandoc.Inlines(' · about ' .. minutes .. ' min read'))
  -- The Div is a Typst block, which scopes the `set` rule to this line.
  return pandoc.Div({pandoc.RawBlock('typst', '#set text(size: 9pt)'), pandoc.Para(inlines)},
                    pandoc.Attr('', {'course-outcomes'}))
end

local function decorate(doc)
  site = doc.meta['course-site'] or {}
  page = doc.meta['course-page'] or {}
  local top = pandoc.List()
  local minutes = reading_minutes(doc.blocks)

  -- Logbook previews and the review deck are web pages only.
  if is_html and site.pdf == true and str(page.kind) ~= 'logbook' and str(page.kind) ~= 'review' then
    top:insert(pandoc.RawBlock('html',
      '<div class="course-pdf"><a class="btn btn-sm btn-outline-primary" href="'
      .. input_stem() .. '.pdf" target="_blank" rel="noopener"><i class="bi bi-file-earmark-pdf"></i> PDF</a></div>'))
  end

  if page.outcomes ~= nil then
    top:insert(outcomes_banner(page.outcomes, minutes))
  end

  if page.slides ~= nil then
    local content
    if page.slides == false then
      content = pandoc.Para(pandoc.Inlines('No presentation yet.'))
    else
      content = pandoc.Para({pandoc.Link('Open the slides (PDF)', str(page.slides))})
    end
    top:insert(callout('note', 'Slides', {content}))
  end

  if page.genai ~= nil then
    top:insert(genai_box(page.genai))
  end

  if page.logbooks ~= nil then
    top:insert(logbooks_box(page.logbooks))
  end

  if str(page.kind) == 'logbook' then
    top:insert(callout('note', 'Logbook', {pandoc.Para(
      pandoc.Inlines('This is a preview of the logbook for ')
      .. {pandoc.Link(str(page.assignment.title), str(page.assignment.href))}
      .. pandoc.Inlines('. Download ') .. {download_link(str(page.download))}
      .. pandoc.Inlines(' and fill it in.'))}))
  end

  if page.starter ~= nil then
    local zip = str(page.starter)
    top:insert(callout('tip', 'Starter files', {pandoc.Para({
      pandoc.Str('Download'), pandoc.Space(), pandoc.Link(pandoc.Code(zip), zip),
      pandoc.Space(), pandoc.Str('and unzip it to get started.')})}))
  end

  doc.blocks = top .. doc.blocks
  if page.history ~= nil then
    doc.blocks:insert(history_footer(page.history))
  end

  if is_typst then
    local url = site_url(input_stem() .. '.html') or ''
    quarto.doc.include_text('in-header', table.concat({
      '#set page(',
      '  header: context { if here().page() > 1 {',
      '    set text(size: 8pt, fill: luma(110))',
      '    ' .. typst_string(str(site.title)) .. '; h(1fr); ' .. typst_string(str(page.week)),
      '  } },',
      '  footer: context {',
      '    set text(size: 8pt, fill: luma(110))',
      url ~= '' and ('    link(' .. typst_string(url) .. '); h(1fr)') or '    h(1fr)',
      '    counter(page).display("1 / 1", both: true)',
      '  },',
      ')',
    }, '\n'))
  end
  return doc
end

-- Links -----------------------------------------------------------------

local function is_relative(target)
  return target ~= '' and not target:match('^%a[%w+.-]*:')
    and not target:match('^#') and not target:match('^/')
end

local function is_readme(name)
  local lower = name:lower()
  return lower == 'readme.md' or lower == 'index.md' or lower == 'index.qmd'
end

local function exists(path)
  local f = io.open(path, 'r')
  if f then f:close() return true end
  return false
end

-- The course information pages are generated from info/*.yaml; links to
-- those files lead to the generated pages.
local GENERATED = {
  ['general.yaml'] = 'index.qmd', ['assessment.yaml'] = 'assessment.qmd', ['genai.yaml'] = 'genai.qmd',
}

local function generated(name)
  return GENERATED[name:lower()]
end

local function staged_name(name)
  if is_readme(name) then return 'index.qmd' end
  if generated(name) then return generated(name) end
  return (name:gsub('%.md$', '.qmd'))
end

-- PDF files open in a new tab, in the browser's PDF viewer (also when the page
-- is embedded in Brightspace). See also head.html, for links Quarto makes.
local function is_pdf(target)
  return (target:match('^([^#?]*)') or ''):lower():match('%.pdf$') ~= nil
end

local function link(l)
  if is_html and is_pdf(l.target) then
    l.attributes['target'] = '_blank'
    l.attributes['rel'] = 'noopener'
    return l
  end
  if not is_relative(l.target) then return nil end
  if l.classes:includes('course-download') then
    -- Files to download keep their name; in a PDF they link to the website.
    local url = not is_html and site_url(l.target)
    if url then l.target = url; return l end
    return nil
  end
  local path, frag = l.target:match('^([^#]*)(#?.*)$')
  local dir, name = path:match('^(.-)([^/]*)$')
  if not (name:match('%.q?md$') or generated(name)) and not is_typst then return nil end

  if is_html then
    -- Point at the staged .qmd source; Quarto turns it into the .html link.
    local staged = dir .. staged_name(name)
    if staged ~= path and exists(pandoc.path.join({input_dir(), staged})) then
      l.target = staged .. frag
      return l
    end
    return nil
  end

  -- PDF and other formats: link to the published page.
  if name:match('%.q?md$') or generated(name) then
    name = (staged_name(name):gsub('%.qmd$', '.html'))
  end
  local url = site_url(dir .. name)
  if url then
    l.target = url .. frag
    return l
  end
end

-- Diagrams -----------------------------------------------------------------
-- Diagrams are centred unless they say otherwise (`fig-align: left`).
-- Mermaid: the stager adds `%%| fig-align: center`; Quarto turns it into the
-- `layout-align` attribute of the cell and centres it on the website, but not
-- in the PDF. PlantUML: the diagram filter (which runs after this one) drops
-- the alignment, so the code block is wrapped here.

-- Typst: `#align(...)[ <blocks> ]`, around the diagram (a Div would become a
-- `#block`, which is only as wide as its content, so centring inside it has
-- no effect).
local function typst_aligned(blocks, align)
  local result = pandoc.Blocks({pandoc.RawBlock('typst', '#align(' .. align .. ')[')})
  result:extend(blocks)
  result:insert(pandoc.RawBlock('typst', ']'))
  return result
end

local function align_cell(div)
  local align = div.attributes['layout-align']
  if is_typst and div.classes:includes('cell') and (align == 'center' or align == 'right') then
    return typst_aligned({div}, align)
  end
end

local function align_plantuml(cb)
  if not cb.classes:includes('plantuml') then return nil end
  local align = cb.attributes['fig-align'] or cb.text:match("'|%s*fig%-align:%s*(%a+)") or 'center'
  if align ~= 'center' and align ~= 'right' then return nil end
  if is_typst then
    return typst_aligned({cb}, align)
  end
  return pandoc.Div({cb}, pandoc.Attr('', {'course-diagram'}, {{'style', 'text-align: ' .. align}}))
end

-- Code annotations -------------------------------------------------------
-- A code block whose lines end with comment markers such as `// <1>`, directly
-- followed by a numbered list, is annotated (Quarto feature).
-- * Website: Quarto expects `/* <1> */` in C, while `// <1>` is the usual way
--   to write it; C markers are converted.
-- * PDF: Quarto's Typst output lists "Line N" without showing line numbers,
--   so annotations are switched off for Typst (_quarto.yml) and done here: the
--   markers become circled numbers (`// ①`) and the list uses the same numbers.

-- Comment styles that can carry a marker: {start, end} as Lua patterns.
local MARKER_STYLES = {
  {'//', ''}, {'/%*', '%*/'}, {'#', ''}, {'%-%-', ''}, {'%%', ''}, {';', ''},
}

-- For a line ending in an annotation marker: the code before it, the number,
-- and the comment style. nil otherwise.
local function find_marker(line)
  for _, style in ipairs(MARKER_STYLES) do
    local code, n = line:match('^(.-)' .. style[1] .. '%s*<(%d+)>%s*' .. style[2] .. '%s*$')
    if code then return code, tonumber(n), style end
  end
end

local function circled(n)
  if n >= 1 and n <= 20 then
    return utf8.char(0x2460 + n - 1)
  end
  return '(' .. n .. ')'
end

-- Rewrite the markers of an annotated code block; nil if it has none.
local function rewrite_markers(cb)
  local lines, found = {}, false
  for line in (cb.text .. '\n'):gmatch('(.-)\n') do
    local code, n, style = find_marker(line)
    if code and is_typst then
      local start = (style[1]:gsub('%%(.)', '%1'))     -- pattern -> literal text
      local finish = (style[2]:gsub('%%(.)', '%1'))
      line = code .. start .. ' ' .. circled(n) .. (finish ~= '' and ' ' .. finish or '')
      found = true
    elseif code and is_html and cb.classes:includes('c') and style[1] == '//' then
      line = code .. '/* <' .. n .. '> */'
      found = true
    end
    table.insert(lines, line)
  end
  if not found then return nil end
  cb.text = table.concat(lines, '\n')
  return cb
end

local function annotations(blocks)
  local changed = false
  for i = 1, #blocks - 1 do
    if blocks[i].t == 'CodeBlock' and blocks[i + 1].t == 'OrderedList' and rewrite_markers(blocks[i]) then
      changed = true
      if is_typst then
        -- Number the explanations like the markers (①, ②, ...); the Div is a
        -- Typst block, which scopes the `set` rule to this list.
        blocks[i + 1] = pandoc.Div({pandoc.RawBlock('typst', '#set enum(numbering: "①")'), blocks[i + 1]},
                                   pandoc.Attr('', {'course-annotations'}))
      end
    end
  end
  if changed then return blocks end
end

-- Callouts with a teaser ----------------------------------------------------

-- `::: {.callout-tip collapse="true" teaser="..."}`: while the callout is
-- closed, the teaser (Markdown) shows under its title; saxion.scss hides it
-- when the callout is open. Not in the PDF, where callouts are always open.
local function teaser(callout)
  local text = callout.attr.attributes.teaser
  if not text then return nil end
  callout.attr.attributes.teaser = nil
  if is_html and callout.collapse ~= nil and callout.title and callout.title.content then
    local first = pandoc.read(text, 'markdown').blocks[1]
    callout.title.content:insert(pandoc.Span(first and first.content or {}, pandoc.Attr('', {'callout-teaser'})))
  elseif is_html then
    quarto.log.warning('teaser="' .. text .. '": only a callout with a title and collapse="true" or "false" shows a teaser')
  end
  return callout
end

-- Images (PDF) ------------------------------------------------------------

-- Width of the text area of an A4 page with the margins from _quarto.yml.
local MAX_WIDTH_IN = 6.5
local UNIT_IN = {['in'] = 1, cm = 1 / 2.54, mm = 1 / 25.4, pt = 1 / 72, px = 1 / 96}

-- Diagrams (e.g. Mermaid) get their natural size, which may not fit the page.
local function fit_image(img)
  local value, unit = (img.attributes.width or ''):match('^([%d.]+)(%a+)$')
  local factor = unit and UNIT_IN[unit]
  if factor and tonumber(value) * factor > MAX_WIDTH_IN then
    img.attributes.width = '100%'
    img.attributes.height = nil
    return img
  end
end

return {
  {Blocks = annotations},
  {Div = align_cell, CodeBlock = align_plantuml},
  {Pandoc = decorate},
  {Link = link},
  {Callout = teaser},
  is_typst and {Image = fit_image} or {},
}
