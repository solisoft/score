# Migration: refresh_house_sections — the library's own sections played
# again (#450): the pop ballad, folk, country and jazz ballad have a bass
# line each now, where they shared one. Ratings and comments are kept.
# Made by scripts/section-seeds.mjs into db/data/house_sections.json.

def up(db)
  changed = SharedSection.refresh_house(JSON.parse(File.read("db/data/house_sections.json")))
  print("#{changed} sections of the library played again")
end

# The bars before are gone with the old catalogue: nothing to put back.
def down(db)
  nil
end
