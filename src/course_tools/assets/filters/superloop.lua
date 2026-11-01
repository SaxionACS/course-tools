--[[
Superloop blocks: ```superloop blocks with YAML (see docs/superloop.md and
superloop.py).

The stager has checked every block and drawn its PDF form; the results are in
_course/superloops.json, keyed by the SHA-1 of the block's text.

* HTML: <div class="course-superloop" data-config="..."> with the
  configuration as JSON. The script assets/superloop/superloop.js, added to
  pages with superloop blocks, compiles and runs the program in it. In
  `course preview`, a block with `editable: true` also has data-yaml: the YAML,
  which the script shows under the block to change and apply.
* PDF (Typst): the title, a note that the program runs live on the website
  (with a link to the block), the task, then per variant the code (with line
  numbers), the timeline of the run with the block's script and a caption. A block with a goal is an exercise:
  the code and the task, and its answer (with the timeline of the answer's
  run) for the "Answers" section of practice.lua, which runs after this filter.
]]

local is_html = quarto.doc.is_format('html')

local data = nil       -- _course/superloops.json
local count = 0
local page_url = nil   -- this page on the website, for links in the PDF

local function str(v)
  if v == nil then return nil end
  return pandoc.utils.stringify(v)
end

local function load()
  local f = io.open(pandoc.path.join({quarto.project.directory, '_course', 'superloops.json'}), 'r')
  if not f then return {blocks = {}} end
  local text = f:read('a')
  f:close()
  return pandoc.json.decode(text, false) or {blocks = {}}
end

-- The same key as widgets.key() in Python: SHA-1 of the text without trailing
-- spaces, blank lines at the start and end, and common indentation.
local function key(text)
  local lines = {}
  for line in (text .. '\n'):gmatch('(.-)\n') do
    table.insert(lines, (line:gsub('[ \t\r]+$', '')))
  end
  while #lines > 0 and lines[1] == '' do table.remove(lines, 1) end
  while #lines > 0 and lines[#lines] == '' do table.remove(lines) end
  local indent
  for _, line in ipairs(lines) do
    if line ~= '' then
      local n = #line:match('^ *')
      if not indent or n < indent then indent = n end
    end
  end
  for i, line in ipairs(lines) do lines[i] = line:sub((indent or 0) + 1) end
  return pandoc.utils.sha1(table.concat(lines, '\n'))
end

local function escape(s)
  s = s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')
  return (s:gsub('"', '&quot;'))
end

local function typst_string(s)
  return '"' .. s:gsub('\\', '\\\\'):gsub('"', '\\"') .. '"'
end

local function html(entry, id)
  quarto.doc.add_html_dependency({
    name = 'course-superloop',
    version = data.version or '1',   -- a new path when the scripts change
    scripts = {{path = quarto.utils.resolve_path('../superloop/superloop.js'), afterBody = true}},
  })
  if not entry.config then
    return pandoc.RawBlock('html', '<div class="course-superloop" id="' .. id .. '"><div class="sl-error">This superloop cannot be shown: '
      .. escape(entry.error or 'unknown') .. '</div></div>')
  end
  local yaml = entry.yaml and (' data-yaml="' .. escape(entry.yaml) .. '"') or ''
  return pandoc.RawBlock('html', '<div class="course-superloop" id="' .. id .. '" data-config="' .. escape(entry.config)
    .. '"' .. yaml .. '><noscript>This program needs JavaScript to run.</noscript></div>')
end

local function picture(p)
  local width = (p.width or 400) * 0.75   -- px to pt
  local size = width > 470 and '100%' or string.format('%.0fpt', width)
  return pandoc.RawBlock('typst', '#align(center, image(bytes(' .. typst_string(p.svg)
    .. '), format: "svg", width: ' .. size .. '))')
end

-- The code as a C code block, with line numbers (the messages and captions name lines):
-- Pandoc's Typst writer numbers the lines of a block with the class numberLines.
local function code(text)
  return {pandoc.CodeBlock(text, pandoc.Attr('', {'c', 'numberLines'}))}
end

local function link(text, id)
  return pandoc.Link(pandoc.Inlines(text), page_url .. '#' .. id)
end

local function typst(entry, id)
  local blocks = pandoc.Blocks({})
  if entry.error or not entry.variants then
    blocks:insert(pandoc.Para(pandoc.Emph(pandoc.Inlines(entry.error and ('This superloop cannot be shown: ' .. entry.error)
      or 'A program that runs on the website.'))))
    return blocks
  end
  local ex = entry.exercise
  if entry.title then blocks:insert(pandoc.Para(pandoc.Strong(pandoc.Inlines(entry.title)))) end
  -- the PDF shows one run of a live program: say so, and where it runs
  local note = pandoc.Inlines(ex
    and 'This exercise is done on the website, where the program runs live and you press the buttons yourself. The answer at the end of the PDF shows one way to do it.'
    or 'In the PDF, this is one run of the program, with scripted presses. On the website, the program runs live: you press the buttons yourself and watch what it does.')
  if page_url then
    note:insert(pandoc.Space())
    note:insert(link(ex and 'Do it on the website.' or 'Run it on the website.', id))
  end
  -- (quarto.Callout returns more than the node: the parentheses keep only the node)
  blocks:insert((quarto.Callout({type = 'note', title = 'Live on the website', content = {pandoc.Para(note)}, appearance = 'simple'})))
  if entry.task then blocks:insert(pandoc.Para(pandoc.Inlines(entry.task))) end
  for _, v in ipairs(entry.variants) do
    if v.name then blocks:insert(pandoc.Para(pandoc.Emph(pandoc.Inlines(v.name)))) end
    blocks:extend(code(v.code))
    if v.svg then
      -- the timeline and its caption stay together
      blocks:insert(pandoc.RawBlock('typst', '#block(breakable: false)['))
      blocks:insert(picture(v))
      if v.caption then blocks:insert(pandoc.Para(pandoc.Emph(pandoc.Inlines(v.caption)))) end
      blocks:insert(pandoc.RawBlock('typst', ']'))
    end
  end
  if not ex then return pandoc.Div(blocks, pandoc.Attr('', {'course-superloop'})) end
  local answer = pandoc.Blocks({})
  for _, part in ipairs(ex.answer or {}) do answer:insert(pandoc.Para(pandoc.Inlines(part.text or ''))) end
  if ex.picture then answer:insert(picture(ex.picture)) end
  blocks:insert(pandoc.Div(answer, pandoc.Attr('', {'answer'})))
  return pandoc.Div(blocks, pandoc.Attr('', {'course-widget-exercise'}))
end

local function superloop(cb)
  if not cb.classes:includes('superloop') then return nil end
  count = count + 1
  local id = cb.identifier ~= '' and cb.identifier or ('superloop-' .. count)
  local entry = data.blocks[key(cb.text)]
  if not entry then
    -- not seen by the stager (e.g. inside a list item it cannot find)
    if is_html then io.stderr:write('warning: ' .. quarto.doc.input_file .. ': superloop ' .. count .. ' was not checked by the build\n') end
    entry = {error = 'the build did not find this block'}
  end
  if is_html then return html(entry, id) end
  return typst(entry, id)
end

local function superloops(doc)
  data = load()
  local site = doc.meta['course-site'] or {}
  local page = doc.meta['course-page'] or {}
  local base = str(site.url) or ''
  if base ~= '' then
    local dir = str(page.dir) or ''
    local stem = pandoc.path.split_extension(pandoc.path.filename(quarto.doc.input_file))
    page_url = base .. '/' .. (dir ~= '' and (dir .. '/') or '') .. stem .. '.html'
  end
  doc.blocks = doc.blocks:walk({CodeBlock = superloop})
  return doc
end

return {{Pandoc = superloops}}
