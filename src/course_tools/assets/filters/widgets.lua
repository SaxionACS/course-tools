--[[
Widgets: ```widget blocks with YAML (see docs/authoring.md and widgets.py).

The stager has checked every widget and drawn its PDF form; the results are
in _course/widgets.json, keyed by the SHA-1 of the block's text.

* HTML: <div class="course-widget" data-config="..."> with the configuration
  as JSON. The script assets/widgets/widgets.js, added to pages with
  widgets, builds the widget in it. In `course preview`, a widget with
  `editable: true` also has data-yaml: the YAML, which the script shows under
  the widget to change and apply.
* PDF (Typst): the picture, with the title, task and caption, and a link to
  the widget on the website. A challenge (a widget with a goal) becomes an
  exercise: filters/practice.lua numbers it and puts the answer in the
  "Answers" section at the end.
]]

local is_html = quarto.doc.is_format('html')

local data = nil       -- _course/widgets.json
local count = 0
local page_url = nil   -- this page on the website, for links in the PDF

local function str(v)
  if v == nil then return nil end
  return pandoc.utils.stringify(v)
end

local function load()
  local f = io.open(pandoc.path.join({quarto.project.directory, '_course', 'widgets.json'}), 'r')
  if not f then return {widgets = {}} end
  local text = f:read('a')
  f:close()
  return pandoc.json.decode(text, false) or {widgets = {}}
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
    name = 'course-widgets',
    version = data.version or '1',   -- a new path when the script changes
    scripts = {{path = quarto.utils.resolve_path('../widgets/widgets.js'), afterBody = true}},
  })
  if not entry.config then
    return pandoc.RawBlock('html', '<div class="course-widget" id="' .. id .. '"><div class="cw-error">This widget cannot be shown: '
      .. escape(entry.error or 'unknown') .. '</div></div>')
  end
  local yaml = entry.yaml and (' data-yaml="' .. escape(entry.yaml) .. '"') or ''
  return pandoc.RawBlock('html', '<div class="course-widget" id="' .. id .. '" data-config="' .. escape(entry.config)
    .. '"' .. yaml .. '><noscript>This widget needs JavaScript.</noscript></div>')
end

local function picture(entry)
  local width = (entry.width or 400) * 0.75   -- px to pt
  local size = width > 470 and '100%' or string.format('%.0fpt', width)
  return pandoc.RawBlock('typst', '#align(center, image(bytes(' .. typst_string(entry.svg)
    .. '), format: "svg", width: ' .. size .. '))')
end

local function typst(entry, id)
  local blocks = pandoc.Blocks({})
  if entry.error or not entry.svg then
    blocks:insert(pandoc.Para(pandoc.Emph(pandoc.Inlines(entry.error and ('This widget cannot be shown: ' .. entry.error)
      or 'An interactive widget: see the website.'))))
    return blocks
  end
  if entry.title then blocks:insert(pandoc.Para(pandoc.Strong(pandoc.Inlines(entry.title)))) end
  if entry.task then blocks:insert(pandoc.Para(pandoc.Inlines(entry.task))) end
  blocks:insert(picture(entry))
  local after = pandoc.Inlines({})
  if entry.caption then after:extend(pandoc.Inlines(entry.caption)) end
  if page_url then
    if #after > 0 then after:insert(pandoc.Space()) end
    after:insert(pandoc.Link(pandoc.Inlines(entry.exercise and 'Do it on the website.' or 'Try it on the website.'), page_url .. '#' .. id))
  end
  if #after > 0 then blocks:insert(pandoc.Para({pandoc.Emph(after)})) end
  if not entry.exercise then return blocks end
  local answer = pandoc.Blocks({})
  for _, part in ipairs(entry.exercise.answer or {}) do
    if part.code then
      answer:insert(pandoc.CodeBlock(part.code, pandoc.Attr('', {part.lang or ''})))
    else
      answer:insert(pandoc.Para(pandoc.Inlines(part.text or '')))
    end
  end
  blocks:insert(pandoc.Div(answer, pandoc.Attr('', {'answer'})))
  return pandoc.Div(blocks, pandoc.Attr('', {'course-widget-exercise'}))
end

local function widget(cb)
  if not cb.classes:includes('widget') then return nil end
  count = count + 1
  local id = cb.identifier ~= '' and cb.identifier or ('widget-' .. count)
  local entry = data.widgets[key(cb.text)]
  if not entry then
    -- not seen by the stager (e.g. inside a list item it cannot find)
    if is_html then io.stderr:write('warning: ' .. quarto.doc.input_file .. ': widget ' .. count .. ' was not checked by the build\n') end
    entry = {error = 'the build did not find this widget'}
  end
  if is_html then return html(entry, id) end
  return typst(entry, id)
end

local function widgets(doc)
  data = load()
  local site = doc.meta['course-site'] or {}
  local page = doc.meta['course-page'] or {}
  local base = str(site.url) or ''
  if base ~= '' then
    local dir = str(page.dir) or ''
    local stem = pandoc.path.split_extension(pandoc.path.filename(quarto.doc.input_file))
    page_url = base .. '/' .. (dir ~= '' and (dir .. '/') or '') .. stem .. '.html'
  end
  doc.blocks = doc.blocks:walk({CodeBlock = widget})
  return doc
end

return {{Pandoc = widgets}}
