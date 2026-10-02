--[[
For HTML output, inline images that filters (e.g. the diagram filter) put in
the mediabag as data URIs.

When a page is rendered to both HTML and PDF, Quarto removes the page's
supporting-files directory after the second format, which would break the
HTML's references to extracted mediabag images.
]]

if not quarto.doc.is_format('html') then
  return {}
end

return {
  Image = function(img)
    local mime, contents = pandoc.mediabag.lookup(img.src)
    if mime and contents then
      img.src = 'data:' .. mime .. ';base64,' .. quarto.base64.encode(contents)
      return img
    end
  end,
}
