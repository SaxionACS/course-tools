--[[
Practice blocks (see docs/authoring.md):

* `::: {.check}`: a self-check question, either multiple choice (a task list,
  `- [x]` for correct options, feedback indented under an option) or fill-in
  (`[42]{.blank}` spans in the text). An optional `::: {.explanation}` is
  shown once the answer is right or revealed.
* `::: {.predict}`: code with a box for the student's prediction; the
  `::: {.answer}` inside is revealed after they wrote something.
* `::: {.compare}`: two code blocks side by side; the browser marks the
  lines that differ.

Website: HTML from this filter, behaviour in theme/practice.html, styles in
theme/saxion.scss. PDF: the questions without the answers; answers, feedback
and explanations go to an "Answers" section at the end of the page.
]]

local is_html = quarto.doc.is_format('html')
local is_typst = quarto.doc.is_format('typst')

local answers = pandoc.Blocks({})        -- PDF: the "Answers" section
local count = {check = 0, predict = 0}

-- Helpers ------------------------------------------------------------------

local function source_name()
  local file = quarto.doc.input_file
  local dir = quarto.project.directory
  if dir and file:sub(1, #dir) == dir then file = file:sub(#dir + 2) end
  return (file:gsub('%.qmd$', '.md'))
end

-- Warnings appear once, in the HTML pass.
local function warn(msg)
  if is_html then io.stderr:write('warning: ' .. source_name() .. ': ' .. msg .. '\n') end
end

local function escape(s)
  s = s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')
  return (s:gsub('"', '&quot;'))
end

local function raw(text)
  return pandoc.RawBlock(is_html and 'html' or 'typst', text)
end

local function raw_inline(text)
  return pandoc.RawInline(is_html and 'html' or 'typst', text)
end

local function label(text)
  if is_html then return raw('<div class="course-practice-label">' .. text .. '</div>') end
  return pandoc.Para({pandoc.Strong(pandoc.Inlines(text .. '.'))})
end

local function add_answer(title, blocks)
  answers:insert(pandoc.Para({pandoc.Strong(pandoc.Inlines(title))}))
  answers:extend(blocks)
end

local function rest(blocks, from)
  local out = pandoc.Blocks({})
  for i = from, #blocks do out:insert(blocks[i]) end
  return out
end

-- Multiple choice ----------------------------------------------------------

-- Task list items: Pandoc turns `[ ]` and `[x]` into ☐ and ☒.
local function task(item)
  local first = item[1]
  if first and (first.t == 'Plain' or first.t == 'Para') then
    local s = first.content[1]
    if s and s.t == 'Str' and (s.text == '☒' or s.text == '☐') then return s.text == '☒' end
  end
  return nil
end

local function option_text(item)
  local inlines = item[1].content:clone()
  inlines:remove(1)
  if inlines[1] and inlines[1].t == 'Space' then inlines:remove(1) end
  return inlines
end

local function choice(div, n, question, options, explanation)
  local correct = 0
  for _, o in ipairs(options.content) do
    if task(o) then correct = correct + 1 end
  end
  local mode = div.attributes.type or (correct > 1 and 'multiple' or 'single')
  if mode ~= 'single' and mode ~= 'multiple' then
    warn('check: type `' .. mode .. '` is not single or multiple')
    mode = correct > 1 and 'multiple' or 'single'
  end
  if correct == 0 then warn('check ' .. n .. ': no option is marked as correct ([x])') end
  if mode == 'single' and correct > 1 then
    warn('check ' .. n .. ': type single, but ' .. correct .. ' options are correct')
  end

  if not is_html then
    local items, key = pandoc.List(), pandoc.List()
    for _, o in ipairs(options.content) do
      local text = option_text(o)
      items:insert({pandoc.Plain(text)})
      -- "Correct: option — feedback", with any further feedback blocks below.
      local line = pandoc.Inlines({pandoc.Strong(pandoc.Inlines(task(o) and 'Correct: ' or 'Wrong: '))})
      line:extend(text)
      local feedback = rest(o, 2)
      if feedback[1] and (feedback[1].t == 'Para' or feedback[1].t == 'Plain') then
        line:extend({pandoc.Space(), pandoc.Str('—'), pandoc.Space()})
        line:extend(feedback[1].content)
        feedback = rest(feedback, 2)
      end
      key:insert(pandoc.Blocks({pandoc.Plain(line)}) .. feedback)
    end
    add_answer('Question ' .. n, {pandoc.BulletList(key)})
    if explanation then answers:extend(explanation) end
    local blocks = pandoc.Blocks({label('Question ' .. n)})
    blocks:extend(question)
    if mode == 'multiple' then blocks:insert(pandoc.Para({pandoc.Emph(pandoc.Inlines('Select all that apply.'))})) end
    -- The Div is a Typst block, which scopes the `set` rule to this list.
    blocks:insert(pandoc.Div({raw('#set list(marker: [' .. (mode == 'single' and '○' or '☐') .. '])'),
                              pandoc.BulletList(items)}, pandoc.Attr('', {'course-options'})))
    return blocks
  end

  local blocks = pandoc.Blocks({label('Question ' .. n)})
  blocks:extend(question)
  if mode == 'multiple' then blocks:insert(pandoc.Para({pandoc.Emph(pandoc.Inlines('Select all that apply.'))})) end
  local list = pandoc.Blocks({})
  for _, o in ipairs(options.content) do
    local line = pandoc.Inlines({raw_inline('<label><input type="' .. (mode == 'single' and 'radio' or 'checkbox')
      .. '" name="check-' .. n .. '"> <span>')})
    line:extend(option_text(o))
    line:insert(raw_inline('</span></label>'))
    local content = pandoc.Blocks({pandoc.Plain(line)})
    local feedback = rest(o, 2)
    if #feedback > 0 then
      content:insert(pandoc.Div(feedback, pandoc.Attr('', {'course-feedback'}, {{'hidden', ''}})))
    end
    list:insert(pandoc.Div(content, pandoc.Attr('', {'course-option'}, {{'data-correct', task(o) and '1' or '0'}})))
  end
  blocks:insert(pandoc.Div(list, pandoc.Attr('', {'course-options'})))
  return blocks
end

-- Fill-in blanks -----------------------------------------------------------

local TYPES = {int = 'a whole number', hex = 'a hexadecimal number', bin = 'a binary number',
               float = 'a number', text = 'text'}

local function strip_separators(s)
  return (s:gsub('[%s_]', ''))
end

-- Whether `answer` is a valid answer of type `kind` (same rules as practice.html).
local function valid(kind, answer)
  local s = strip_separators(answer)
  if kind == 'int' then return s:match('^[+-]?%d+$') ~= nil end
  if kind == 'hex' then return s:match('^[+-]?0[xX]%x+$') ~= nil or s:match('^[+-]?%x+[hH]?$') ~= nil end
  if kind == 'bin' then return s:match('^[+-]?0[bB][01]+$') ~= nil or s:match('^[+-]?[01]+$') ~= nil end
  if kind == 'float' then return tonumber((s:gsub(',', '.'))) ~= nil end
  return true
end

-- The type of a blank without `type`: from the form of its answer.
local function guess_type(answer)
  local s = strip_separators(answer)
  if s:match('^[+-]?%d+$') then return 'int' end
  if s:match('^[+-]?0[xX]%x+$') then return 'hex' end
  if s:match('^[+-]?0[bB][01]+$') then return 'bin' end
  if s:match('^[+-]?%d*%.%d+$') or s:match('^[+-]?%d+%.?%d*[eE][+-]?%d+$') then return 'float' end
  return 'text'
end

local function blank_input(span, n, i, default_type)
  local answer = pandoc.utils.stringify(span.content)
  local a = span.attributes
  local kind = a.type or default_type or guess_type(answer)
  if not TYPES[kind] then
    warn('check ' .. n .. ': blank type `' .. kind .. '` is not one of int, hex, bin, float, text')
    kind = 'text'
  end
  if not valid(kind, answer) then
    warn('check ' .. n .. ': the answer `' .. answer .. '` is not ' .. TYPES[kind])
  end
  local precision = a.precision
  if precision and (kind ~= 'float' or not (precision:match('^[%d.]+%%?$') and tonumber((precision:gsub('%%$', ''))))) then
    warn('check ' .. n .. ': `precision` is for float blanks: a tolerance such as 0.01 or 1%')
    precision = nil
  end
  local case = a.case or 'ignore'
  if case ~= 'ignore' and case ~= 'sensitive' then
    warn('check ' .. n .. ': `case` is ignore or sensitive')
    case = 'ignore'
  end
  local spaces = a.spaces or 'normalize'
  if spaces ~= 'normalize' and spaces ~= 'ignore' then
    warn('check ' .. n .. ': `spaces` is normalize or ignore')
    spaces = 'normalize'
  end
  local unit = a.unit
  local is_code = #span.content == 1 and span.content[1].t == 'Code'

  if not is_html then
    local width = tonumber(a.width) or (kind == 'text' and 10 or 6)
    local box = '#box(width: ' .. string.format('%.1f', width * 0.6) .. 'em, stroke: (bottom: 0.6pt + luma(120)))[#h(0.5em)]'
    local inlines = pandoc.Inlines({raw_inline(box)})
    if unit then inlines:extend({pandoc.Space(), pandoc.Str(unit)}) end
    local key = pandoc.Inlines({})
    key:extend(span.content)
    if unit then key:extend({pandoc.Space(), pandoc.Str(unit)}) end
    if a.accept then key:extend(pandoc.Inlines(' (also right: ' .. a.accept:gsub('|', ', ') .. ')')) end
    if precision then key:extend(pandoc.Inlines(' (± ' .. precision .. ')')) end
    return inlines, key
  end

  local width = tonumber(a.width) or (kind == 'text' and math.max(12, math.min(30, #answer + 6)) or 10)
  local attrs = {
    'class="course-blank' .. (is_code and ' course-blank-code' or '') .. '"',
    'data-type="' .. kind .. '"', 'data-answer="' .. escape(answer) .. '"',
    'aria-label="Answer ' .. i .. '"', 'autocomplete="off"', 'autocapitalize="off"', 'spellcheck="false"',
    'style="width: ' .. width .. 'ch"',
  }
  if kind == 'text' then
    table.insert(attrs, 'data-case="' .. case .. '"')
    table.insert(attrs, 'data-spaces="' .. spaces .. '"')
  end
  if precision then table.insert(attrs, 'data-precision="' .. escape(precision) .. '"') end
  if a.accept then table.insert(attrs, 'data-accept="' .. escape(a.accept) .. '"') end
  local shown = escape(answer)
  if is_code then shown = '<code>' .. shown .. '</code>' end
  local html = '<span class="course-blank-wrap"><input type="text" ' .. table.concat(attrs, ' ') .. '>'
    .. (unit and ('<span class="course-blank-unit">' .. escape(unit) .. '</span>') or '')
    .. '<span class="course-blank-answer" hidden>' .. shown .. '</span></span>'
  return pandoc.Inlines({raw_inline(html)})
end

local function fill(div, n, question, explanation)
  local keys = pandoc.List()
  local i = 0
  question = question:walk({Span = function(span)
    if not span.classes:includes('blank') then return nil end
    i = i + 1
    local inlines, key = blank_input(span, n, i, div.attributes.type)
    if key then keys:insert({pandoc.Plain(key)}) end
    return inlines
  end})
  if i == 0 then
    warn('check ' .. n .. ': a check needs options (- [x] ...) or blanks ([answer]{.blank})')
  end
  if not is_html then
    add_answer('Question ' .. n, {#keys == 1 and pandoc.Plain(keys[1][1].content) or pandoc.OrderedList(keys)})
    if explanation then answers:extend(explanation) end
  end
  local blocks = pandoc.Blocks({label('Question ' .. n)})
  blocks:extend(question)
  return blocks
end

-- `::: {.check}` -------------------------------------------------------------

local function check(div)
  count.check = count.check + 1
  local n = count.check
  local question, options, explanation = pandoc.Blocks({}), nil, nil
  for _, b in ipairs(div.content) do
    if options == nil and b.t == 'BulletList' and task(b.content[1]) ~= nil then
      options = b
    elseif b.t == 'Div' and b.classes:includes('explanation') then
      explanation = b.content
    else
      question:insert(b)
    end
  end
  local blocks
  if options then
    blocks = choice(div, n, question, options, explanation)
  else
    blocks = fill(div, n, question, explanation)
  end
  if not is_html then
    return pandoc.Div(blocks, pandoc.Attr('check-' .. n, {'course-check'}))
  end
  if explanation then
    blocks:insert(pandoc.Div(explanation, pandoc.Attr('', {'course-explanation'}, {{'hidden', ''}})))
  end
  blocks:insert(raw('<div class="course-check-actions">'
    .. '<button type="button" class="btn btn-sm btn-primary course-check-button">Check</button>'
    .. '<button type="button" class="btn btn-sm btn-outline-secondary course-show-answer" hidden>Show answer</button>'
    .. '<span class="course-result" aria-live="polite"></span></div>'))
  return pandoc.Div(blocks, pandoc.Attr('check-' .. n, {'course-check'},
    {{'data-kind', options and 'choice' or 'fill'}}))
end

-- `::: {.predict}` -----------------------------------------------------------

local function predict(div)
  count.predict = count.predict + 1
  local n = count.predict
  local body, answer = pandoc.Blocks({}), nil
  for _, b in ipairs(div.content) do
    if b.t == 'Div' and b.classes:includes('answer') then answer = b.content else body:insert(b) end
  end
  if not answer then warn('predict ' .. n .. ': no ::: {.answer} to reveal') end

  if not is_html then
    add_answer('Prediction ' .. n, answer or {})
    local blocks = pandoc.Blocks({pandoc.Para({pandoc.Strong(pandoc.Inlines('Prediction ' .. n .. '.')), pandoc.Space(),
      pandoc.Emph(pandoc.Inlines('Write down your prediction before you read on; the answer is at the end.'))})})
    blocks:extend(body)
    return pandoc.Div(blocks, pandoc.Attr('predict-' .. n, {'course-predict'}))
  end
  local blocks = pandoc.Blocks({label('Predict')})
  blocks:extend(body)
  blocks:insert(raw('<label class="visually-hidden" for="predict-' .. n .. '-text">Your prediction</label>'
    .. '<textarea class="form-control" id="predict-' .. n .. '-text" rows="2" placeholder="Your prediction…"></textarea>'
    .. '<div class="course-check-actions"><button type="button" class="btn btn-sm btn-primary course-reveal" disabled>Reveal</button>'
    .. '<span class="course-result" aria-live="polite"></span></div>'))
  blocks:insert(pandoc.Div(answer or {}, pandoc.Attr('', {'course-answer'}, {{'hidden', ''}})))
  blocks:insert(raw('<div class="course-selfgrade" hidden>Did your prediction match? '
    .. '<button type="button" class="btn btn-sm btn-outline-primary" data-grade="yes">Yes</button> '
    .. '<button type="button" class="btn btn-sm btn-outline-secondary" data-grade="no">Not quite</button></div>'))
  return pandoc.Div(blocks, pandoc.Attr('predict-' .. n, {'course-predict'}))
end

-- `::: {.compare}` -----------------------------------------------------------

local function compare(div)
  -- Columns: each code block with the blocks after it (e.g. a Compiler
  -- Explorer link); blocks before the first code block go above both.
  local intro, columns = pandoc.Blocks({}), {}
  for _, b in ipairs(div.content) do
    if b.t == 'CodeBlock' then
      table.insert(columns, pandoc.Blocks({b}))
    elseif #columns > 0 then
      columns[#columns]:insert(b)
    else
      intro:insert(b)
    end
  end
  if #columns ~= 2 then
    warn('compare: needs two code blocks, found ' .. #columns)
    return nil
  end
  local labels = {}
  for l in (div.attributes.labels or 'Before|After'):gmatch('[^|]+') do
    table.insert(labels, (l:gsub('^%s+', ''):gsub('%s+$', '')))
  end
  local verdict = div.classes:includes('wrong-right')

  if not is_html then
    local blocks = pandoc.Blocks(intro)
    for k, column in ipairs(columns) do
      local title = labels[k] or ''
      if verdict then title = (k == 1 and '✗ ' or '✓ ') .. title end
      blocks:insert(pandoc.Para({pandoc.Strong(pandoc.Inlines(title))}))
      blocks:extend(column)
    end
    return blocks
  end
  local cells = pandoc.Blocks({})
  for k, column in ipairs(columns) do
    local cell = pandoc.Blocks({raw('<div class="course-compare-label">' .. escape(labels[k] or '') .. '</div>')})
    cell:extend(column)
    cells:insert(pandoc.Div(cell, pandoc.Attr('', {'course-compare-column'})))
  end
  local classes = {'course-compare'}
  if verdict then table.insert(classes, 'wrong-right') end
  local blocks = pandoc.Blocks(intro)
  blocks:insert(pandoc.Div(cells, pandoc.Attr('', classes)))
  return blocks
end

-- Document -----------------------------------------------------------------

local function practice(doc)
  doc.blocks = doc.blocks:walk({Div = function(div)
    if div.classes:includes('check') then return check(div) end
    if div.classes:includes('predict') then return predict(div) end
    if div.classes:includes('compare') then return compare(div) end
  end})
  if is_typst and #answers > 0 then
    doc.blocks:insert(raw('#pagebreak(weak: true)'))
    doc.blocks:insert(pandoc.Header(2, pandoc.Inlines('Answers'), pandoc.Attr('answers', {'unnumbered'})))
    doc.blocks:extend(answers)
  end
  return doc
end

return {{Pandoc = practice}}
