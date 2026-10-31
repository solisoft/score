# Migration: add_house_sections — the sections the shared library starts
# with (#447): each accompaniment style on the guitar, the piano, the bass
# and the whole band, and each drum groove with its break, signed "Score".
# Made by scripts/section-seeds.mjs into db/data/house_sections.json.

def up(db)
  added = SharedSection.add_house(JSON.parse(File.read("db/data/house_sections.json")))
  print("#{added} sections added to the library")
end

def down(db)
  SharedSection.remove_house
end
