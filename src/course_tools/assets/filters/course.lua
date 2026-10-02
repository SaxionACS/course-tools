--[[
Course page decorations and link handling.

* HTML: a "PDF" download button at the top of every page.
* Lectures: a "Slides" box with the slides PDF, or "No presentation yet".
* Assignments: whether generative AI is allowed (from the course's GenAI
  policy), and a box with the starter-files zip if there are starter files.
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

-- Box at the top of an assignment: is generative AI allowed in it?
local function genai_box(rule)
  local T = pandoc.Inlines
  local rules = pandoc.Link('rules for generative AI', str(rule.policy))
  local kind, title, inlines
  local use = str(rule.use)
  if use == 'allowed' then
    kind, title = 'tip', 'Generative AI: allowed, with citation'
    inlines = T('You may use generative AI in this assignment if you cite every use: a comment '
      .. 'with the tool and your prompt for a short piece of code, otherwise a ')
      .. {pandoc.Code('GENAI.md')} .. T(' file. See the ') .. {rules} .. T('.')
  elseif use == 'tutor' then
    kind, title = 'note', 'Generative AI: as a tutor only'
    inlines = T('You may use generative AI to have things explained to you, but nothing it '
      .. 'generates may be handed in: write all code and text yourself. See the ') .. {rules} .. T('.')
  elseif use == 'not-allowed' then
    kind, title = 'warning', 'Generative AI: not allowed'
    inlines = T('You may not use generative AI in this assignment. See the ') .. {rules} .. T('.')
  else
    kind, title = 'note', 'Generative AI'
    inlines = T('See the ') .. {rules} .. T(' of this course.')
  end
  local blocks = pandoc.Blocks({pandoc.Para(inlines)})
  -- The note is Markdown in the front matter, already parsed by Pandoc.
  local note = rule.note
  if pandoc.utils.type(note) == 'Inlines' then
    blocks:insert(pandoc.Para(note))
  elseif pandoc.utils.type(note) == 'Blocks' then
    blocks:extend(note)
  elseif note ~= nil then
    blocks:insert(pandoc.Para(T(str(note))))
  end
  return callout(kind, title, blocks)
end

local function decorate(doc)
  site = doc.meta['course-site'] or {}
  page = doc.meta['course-page'] or {}
  local top = pandoc.List()

  if is_html and site.pdf == true then
    top:insert(pandoc.RawBlock('html',
      '<div class="course-pdf"><a class="btn btn-sm btn-outline-primary" href="'
      .. input_stem() .. '.pdf" download><i class="bi bi-file-earmark-pdf"></i> PDF</a></div>'))
  end

  if page.slides ~= nil then
    local content
    if page.slides == false then
      content = pandoc.Para(pandoc.Inlines('No presentation yet.'))
    else
      content = pandoc.Para({pandoc.Link('Download the slides (PDF)', str(page.slides))})
    end
    top:insert(callout('note', 'Slides', {content}))
  end

  if page.genai ~= nil then
    top:insert(genai_box(page.genai))
  end

  if page.starter ~= nil then
    local zip = str(page.starter)
    top:insert(callout('tip', 'Starter files', {pandoc.Para({
      pandoc.Str('Download'), pandoc.Space(), pandoc.Link(pandoc.Code(zip), zip),
      pandoc.Space(), pandoc.Str('and unzip it to get started.')})}))
  end

  doc.blocks = top .. doc.blocks

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

local function link(l)
  if not is_relative(l.target) then return nil end
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
  {Pandoc = decorate},
  {Link = link},
  is_typst and {Image = fit_image} or {},
}
