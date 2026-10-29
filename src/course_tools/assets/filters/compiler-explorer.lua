--[[
Compiler Explorer links on code blocks (see docs/authoring.md):

  ```{c ce=asm}

The value of `ce` is what Compiler Explorer opens with:

* `asm`: the assembly;
* `run`: the assembly and the output of the program (compiled, linked and
  run); `asm run` means the same;
* `exe`: only the output of the program (an executor pane), with optional
  `ce-stdin` (input; `\n` for a new line) and `ce-args` (arguments). It cannot
  be combined with `asm` or `run`.

Compiler, options and target (a label shown next to the link) come from, in
increasing order of priority: `compiler_explorer` in info/general.yaml (the
`course-site` metadata), `compiler_explorer` in the page's front matter
(`course-page`), and the attributes `ce-compiler`, `ce-options` and
`ce-target` of the code block. For `run` and `exe`, the `run` settings are
used when there are any: Compiler Explorer runs x86-64 programs only, so a
course for a microcontroller needs a second compiler to run code.

The course and page settings arrive as base64-encoded JSON (see
compiler_explorer.py). The link holds the code itself (a "client state"), so
it works without an account and never expires.
]]

local is_html = quarto.doc.is_format('html')

local URL = 'https://godbolt.org/clientstate/'
local MODES = {asm = 'assembly', run = 'assembly and output', exe = 'output'}
-- Code block language -> Compiler Explorer language.
local LANGUAGES = {
  c = 'c', cpp = 'c++', ['c++'] = 'c++', cxx = 'c++', cc = 'c++', rust = 'rust', go = 'go', zig = 'zig',
  d = 'd', swift = 'swift', fortran = 'fortran', haskell = 'haskell', python = 'python', java = 'java',
}
local KEYS = {'target', 'compiler', 'options'}

local course, page = {}, {}

local function source_name()
  local file = quarto.doc.input_file
  local dir = quarto.project.directory
  if dir and file:sub(1, #dir) == dir then file = file:sub(#dir + 2) end
  -- With / on Windows too, like the warnings of the stager.
  return (file:gsub('\\', '/'):gsub('%.qmd$', '.md'))
end

-- Warnings appear once, in the HTML pass.
local function warn(msg)
  if is_html then io.stderr:write('warning: ' .. source_name() .. ': ' .. msg .. '\n') end
end

local function escape(s)
  s = s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')
  return (s:gsub('"', '&quot;'))
end

local function decode(value)
  if value == nil then return {} end
  local ok, data = pcall(function()
    return pandoc.json.decode(quarto.base64.decode(pandoc.utils.stringify(value)), false)
  end)
  return ok and type(data) == 'table' and data or {}
end

local function read_meta(meta)
  course = decode((meta['course-site'] or {})['compiler-explorer'])
  page = decode((meta['course-page'] or {})['compiler-explorer'])
end

-- Settings ---------------------------------------------------------------

-- Target, compiler and options from the given tables; later ones win.
local function merged(...)
  local result = {}
  for _, t in ipairs({...}) do
    if type(t) == 'table' then
      for _, k in ipairs(KEYS) do
        if t[k] ~= nil and t[k] ~= '' then result[k] = t[k] end
      end
    end
  end
  return result
end

local function settings(mode, attrs)
  local s = merged(course, page)
  if mode ~= 'asm' then
    local run = merged(course.run, page.run)
    if run.compiler then s = run end
  end
  return merged(s, {target = attrs['ce-target'], compiler = attrs['ce-compiler'], options = attrs['ce-options']})
end

local function parse_mode(value)
  local words = {}
  for w in value:gmatch('[^%s,]+') do
    if MODES[w] then words[w] = true else warn('ce="' .. value .. '": `' .. w .. '` is not asm, run or exe') end
  end
  if words.exe and (words.asm or words.run) then
    warn('ce="' .. value .. '": exe (output only) cannot be combined with asm or run; using run')
    return 'run'
  end
  return (words.run and 'run') or (words.exe and 'exe') or (words.asm and 'asm') or nil
end

-- Code -------------------------------------------------------------------

-- Annotation markers (`// <1>`, as in course.lua) are not part of the code.
local MARKER_STYLES = {
  {'//', ''}, {'/%*', '%*/'}, {'#', ''}, {'%-%-', ''}, {'%%', ''}, {';', ''},
}

local function strip_markers(text)
  local lines = {}
  for line in (text .. '\n'):gmatch('(.-)\n') do
    for _, style in ipairs(MARKER_STYLES) do
      local code = line:match('^(.-)%s*' .. style[1] .. '%s*<%d+>%s*' .. style[2] .. '%s*$')
      if code then line = code break end
    end
    table.insert(lines, line)
  end
  return (table.concat(lines, '\n'):gsub('\n+$', '')) .. '\n'
end

-- The Compiler Explorer state: one source with a compiler (asm, run) or an
-- executor (exe).
local function client_state(mode, language, source, s, attrs)
  local session = {id = 1, language = language, source = source}
  if mode == 'exe' then
    local stdin = (attrs['ce-stdin'] or ''):gsub('\\n', '\n')
    session.executors = {{
      compiler = {id = s.compiler, options = s.options or ''},
      stdin = stdin, stdinVisible = attrs['ce-stdin'] ~= nil,
      arguments = attrs['ce-args'] or '', argumentsVisible = attrs['ce-args'] ~= nil,
      compilerVisible = false, compilerOutputVisible = false,
    }}
  else
    local compiler = {id = s.compiler, options = s.options or ''}
    if mode == 'run' then
      compiler.filters = {execute = true}
      compiler.specialoutputs = {'compilerOutput'}   -- the pane with the program's output
    end
    session.compilers = {compiler}
  end
  return {sessions = {session}}
end

local function link_url(state)
  local b64 = quarto.base64.encode(pandoc.json.encode(state))
  -- URL-safe base64; Compiler Explorer accepts it.
  return URL .. b64:gsub('%+', '-'):gsub('/', '_'):gsub('=+$', '')
end

local function link_block(mode, s, href)
  local text = 'Compiler Explorer: ' .. MODES[mode]
  local details = {}
  if s.target then table.insert(details, s.target) end
  if s.options and s.options ~= '' then table.insert(details, s.options) end
  if is_html then
    -- Lines break between the flags, not inside one (-mcpu=cortex-m0plus).
    local words = {}
    for w in table.concat(details, ' · '):gmatch('%S+') do table.insert(words, '<span>' .. escape(w) .. '</span>') end
    return pandoc.RawBlock('html', '<div class="course-ce" data-ce-mode="' .. mode .. '">'
      .. '<a href="' .. href .. '" target="_blank" rel="noopener"><i class="bi bi-cpu"></i> ' .. text
      .. ' <i class="bi bi-box-arrow-up-right"></i></a>'
      .. (#words > 0 and ('<span class="course-ce-details">' .. table.concat(words, ' ') .. '</span>') or '')
      .. '</div>')
  end
  local inlines = pandoc.Inlines({pandoc.Link(pandoc.Inlines(text), href)})
  if #details > 0 then inlines:extend(pandoc.Inlines(' (' .. table.concat(details, ', ') .. ')')) end
  -- The Div is a Typst block, which scopes the `set` rule to this line.
  return pandoc.Div({pandoc.RawBlock('typst', '#set text(size: 8.5pt)'), pandoc.Para(inlines)},
                    pandoc.Attr('', {'course-ce'}))
end

-- The link for a code block with `ce`; the `ce` attributes are removed.
local function link_for(cb)
  local attrs = {}
  for k, v in pairs(cb.attributes) do
    if k == 'ce' or k:match('^ce%-') then attrs[k] = v end
  end
  for k in pairs(attrs) do cb.attributes[k] = nil end
  local mode = parse_mode(attrs.ce)
  if not mode then return nil end
  local language = cb.classes[1] and (LANGUAGES[cb.classes[1]] or cb.classes[1])
  if not language then
    warn('ce: the code block has no language')
    return nil
  end
  local s = settings(mode, attrs)
  if not s.compiler then
    warn('ce: no compiler; set compiler_explorer in info/general.yaml or the front matter, or ce-compiler')
    return nil
  end
  if mode ~= 'exe' and (attrs['ce-stdin'] or attrs['ce-args']) then
    warn('ce: ce-stdin and ce-args only work with ce=exe')
  end
  return link_block(mode, s, link_url(client_state(mode, language, strip_markers(cb.text), s, attrs)))
end

local function links(blocks)
  local result, changed = pandoc.Blocks({}), false
  local i = 1
  while i <= #blocks do
    local b = blocks[i]
    result:insert(b)
    if b.t == 'CodeBlock' and b.attributes.ce ~= nil then
      changed = true
      local annotated = strip_markers(b.text) ~= (b.text:gsub('\n+$', '')) .. '\n'
      local link = link_for(b)
      -- An annotation list stays directly after its code block.
      if annotated and blocks[i + 1] and blocks[i + 1].t == 'OrderedList' then
        result:insert(blocks[i + 1])
        i = i + 1
      end
      if link then result:insert(link) end
    end
    i = i + 1
  end
  if changed then return result end
end

return {
  {Meta = read_meta},
  {Blocks = links},
}
