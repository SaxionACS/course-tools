--[[
State machines: ```statemachine blocks with YAML (see docs/statemachines.md
and statemachine.py).

The stager has checked every machine and drawn its PDF form; the results are
in _course/statemachines.json, keyed by the SHA-1 of the block's text.

* HTML: <div class="course-statemachine" data-config="..."> with the
  configuration as JSON. The scripts assets/statemachine/dagre.min.js and
  statemachine.js, added to pages with state machines, draw and run the
  machine in it. In `course preview`, a block with `editable: true` also has
  data-yaml: the YAML, which the script shows under the machine to change and
  apply.
* PDF (Typst): the title and task, then per machine a picture and its
  transition table, and a link to the machine on the website.
]]

local is_html = quarto.doc.is_format('html')

local data = nil       -- _course/statemachines.json
local count = 0
local page_url = nil   -- this page on the website, for links in the PDF

local function str(v)
  if v == nil then return nil end
  return pandoc.utils.stringify(v)
end

local function load()
  local f = io.open(pandoc.path.join({quarto.project.directory, '_course', 'statemachines.json'}), 'r')
  if not f then return {machines = {}} end
  local text = f:read('a')
  f:close()
  return pandoc.json.decode(text, false) or {machines = {}}
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
    name = 'course-statemachine',
    version = data.version or '1',   -- a new path when the scripts change
    scripts = {
      {path = quarto.utils.resolve_path('../statemachine/dagre.min.js'), afterBody = true},
      {path = quarto.utils.resolve_path('../statemachine/statemachine.js'), afterBody = true},
    },
    resources = {{name = 'dagre.min.js.LEGAL.txt', path = quarto.utils.resolve_path('../statemachine/dagre.min.js.LEGAL.txt')}},
  })
  if not entry.config then
    return pandoc.RawBlock('html', '<div class="course-statemachine" id="' .. id .. '"><div class="sm-error">This state machine cannot be shown: '
      .. escape(entry.error or 'unknown') .. '</div></div>')
  end
  local yaml = entry.yaml and (' data-yaml="' .. escape(entry.yaml) .. '"') or ''
  return pandoc.RawBlock('html', '<div class="course-statemachine" id="' .. id .. '" data-config="' .. escape(entry.config)
    .. '"' .. yaml .. '><noscript>This state machine needs JavaScript.</noscript></div>')
end

local function picture(m)
  local width = (m.width or 400) * 0.75   -- px to pt
  local size = width > 470 and '100%' or string.format('%.0fpt', width)
  return pandoc.RawBlock('typst', '#align(center, image(bytes(' .. typst_string(m.svg)
    .. '), format: "svg", width: ' .. size .. '))')
end

-- A row per state, a column per event.
local function transitions(t)
  local function cell(text, strong)
    local inlines = pandoc.Inlines(text)
    return {pandoc.Plain(strong and {pandoc.Strong(inlines)} or inlines)}
  end
  local head, aligns, widths = {}, {}, {}
  for _, h in ipairs(t.head) do
    table.insert(head, cell(h))
    table.insert(aligns, pandoc.AlignLeft)
    table.insert(widths, 0)
  end
  local rows = {}
  for _, row in ipairs(t.rows) do
    local cells = {}
    for i, text in ipairs(row) do table.insert(cells, cell(text, i == 1)) end
    table.insert(rows, cells)
  end
  return pandoc.utils.from_simple_table(pandoc.SimpleTable({}, aligns, widths, head, rows))
end

local function typst(entry, id)
  local blocks = pandoc.Blocks({})
  if entry.error or not entry.machines then
    blocks:insert(pandoc.Para(pandoc.Emph(pandoc.Inlines(entry.error and ('This state machine cannot be shown: ' .. entry.error)
      or 'An interactive state machine: see the website.'))))
    return blocks
  end
  if entry.title then blocks:insert(pandoc.Para(pandoc.Strong(pandoc.Inlines(entry.title)))) end
  if entry.task then blocks:insert(pandoc.Para(pandoc.Inlines(entry.task))) end
  local dash = false
  for _, m in ipairs(entry.machines) do
    -- the title of a machine stays on the page of its picture
    blocks:insert(pandoc.RawBlock('typst', '#block(breakable: false)['))
    if m.title then blocks:insert(pandoc.Para(pandoc.Emph(pandoc.Inlines(m.title)))) end
    blocks:insert(picture(m))
    blocks:insert(pandoc.RawBlock('typst', ']'))
    if m.table then
      blocks:insert(transitions(m.table))
      for _, row in ipairs(m.table.rows) do
        for _, text in ipairs(row) do dash = dash or text == '–' end
      end
    end
  end
  local after = pandoc.Inlines({})
  if dash then after:insert(pandoc.Str('A dash: the state ignores the event.')) end
  if page_url then
    if #after > 0 then after:insert(pandoc.Space()) end
    after:insert(pandoc.Link(pandoc.Inlines('Try it on the website.'), page_url .. '#' .. id))
  end
  if #after > 0 then blocks:insert(pandoc.Para({pandoc.Emph(after)})) end
  return pandoc.Div(blocks, pandoc.Attr('', {'course-statemachine'}))
end

local function statemachine(cb)
  if not cb.classes:includes('statemachine') then return nil end
  count = count + 1
  local id = cb.identifier ~= '' and cb.identifier or ('statemachine-' .. count)
  local entry = data.machines[key(cb.text)]
  if not entry then
    -- not seen by the stager (e.g. inside a list item it cannot find)
    if is_html then io.stderr:write('warning: ' .. quarto.doc.input_file .. ': state machine ' .. count .. ' was not checked by the build\n') end
    entry = {error = 'the build did not find this state machine'}
  end
  if is_html then return html(entry, id) end
  return typst(entry, id)
end

local function statemachines(doc)
  data = load()
  local site = doc.meta['course-site'] or {}
  local page = doc.meta['course-page'] or {}
  local base = str(site.url) or ''
  if base ~= '' then
    local dir = str(page.dir) or ''
    local stem = pandoc.path.split_extension(pandoc.path.filename(quarto.doc.input_file))
    page_url = base .. '/' .. (dir ~= '' and (dir .. '/') or '') .. stem .. '.html'
  end
  doc.blocks = doc.blocks:walk({CodeBlock = statemachine})
  return doc
end

return {{Pandoc = statemachines}}
