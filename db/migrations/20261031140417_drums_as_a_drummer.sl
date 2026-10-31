# Migration: drums_as_a_drummer — the library's own sections played again
# (#455, #456): their drums with a drummer's force, ghost notes, variations
# and a little humanizing; each groove become a loop of one bar, a loop of
# two and a break of one, where it was four bars of beat and break (those
# are taken away). Ratings and comments of the others are kept. Made by
# scripts/section-seeds.mjs into db/data/house_sections.json.

def up(db)
  seeds = JSON.parse(File.read("db/data/house_sections.json"))
  gone = SharedSection.prune_house(seeds)
  added = SharedSection.add_house(seeds)
  changed = SharedSection.refresh_house(seeds)
  SharedSection.backfill_swing
  print("#{gone} sections taken away, #{added} added, #{changed} played again")
end

# The four-bar grooves are gone with the old catalogue: nothing to put back.
def down(db)
  nil
end
