--[[
Key-terms blocks (`::: {.terms}`, a definition list; see terms.py): a box
titled "Key terms". Every term gets the id that the glossary and the
definitions on first use (theme/terms.html) link to. The stager passes the
ids of the page's terms, in order, as `course-page.terms`.
]]

local is_html = quarto.doc.is_format('html')

local ids, used = {}, 0

local function read_meta(meta)
  local page = meta['course-page'] or {}
  for _, id in ipairs(page.terms or {}) do
    table.insert(ids, pandoc.utils.stringify(id))
  end
end

-- Same as terms.slug() in Python; only used if the stager found fewer terms.
local function slug(text)
  local s = text:lower():gsub('[^a-z0-9]+', '-'):gsub('^%-+', ''):gsub('%-+$', '')
  return 'term-' .. (s ~= '' and s or 'x')
end

local function with_ids(dl)
  for _, item in ipairs(dl.content) do
    used = used + 1
    local id = ids[used] or slug(pandoc.utils.stringify(item[1]))
    item[1] = pandoc.Inlines({pandoc.Span(item[1], pandoc.Attr(id, {'course-term-name'}))})
    -- A definition of several paragraphs: keep them apart (a tight list has
    -- Plain blocks, which would run together).
    for k, definition in ipairs(item[2]) do
      if #definition > 1 then
        item[2][k] = pandoc.Blocks(definition:map(function(b)
          return b.t == 'Plain' and pandoc.Para(b.content) or b
        end))
      end
    end
  end
  return dl
end

local function terms_box(div)
  if not div.classes:includes('terms') then return nil end
  local content = div.content:walk({DefinitionList = with_ids})
  if is_html then
    content:insert(1, pandoc.RawBlock('html', '<div class="course-practice-label">Key terms</div>'))
    return pandoc.Div(content, pandoc.Attr(div.identifier, {'course-terms'}))
  end
  -- PDF: a shaded box with a green line on the left, like on the website.
  local blocks = pandoc.Blocks({pandoc.RawBlock('typst',
    '#block(width: 100%, breakable: true, inset: (x: 10pt, y: 8pt), fill: rgb("#f2f8f6"), '
    .. 'stroke: (left: 2pt + rgb("#009c82")))[')})
  blocks:insert(pandoc.Para({pandoc.Strong(pandoc.Inlines('Key terms'))}))
  blocks:extend(content)
  blocks:insert(pandoc.RawBlock('typst', ']'))
  return blocks
end

return {
  {Meta = read_meta},
  {Div = terms_box},
}
