# Migration: refresh_house_sections_braces — the library's own sections
# played again (#452): a piano's two staves now come with their brace and
# its name, so a piano added to a score is a piano. Ratings and comments
# are kept. Made by scripts/section-seeds.mjs into db/data/house_sections.json.

def up(db)
  changed = SharedSection.refresh_house(JSON.parse(File.read("db/data/house_sections.json")))
  print("#{changed} sections of the library played again")
end

# The bars before are gone with the old catalogue: nothing to put back.
def down(db)
  nil
end
