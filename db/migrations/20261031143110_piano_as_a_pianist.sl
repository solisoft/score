# Migration: piano_as_a_pianist — the library's own sections played again
# (#459): each piano note with a pianist's force and a little humanizing;
# each style's piano added as loops of one and two bars, and the piano
# patterns (riffs.js PIANO_RIFFS) as loops of one and two bars. Ratings and
# comments are kept. Made by scripts/section-seeds.mjs into
# db/data/house_sections.json.

def up(db)
  seeds = JSON.parse(File.read("db/data/house_sections.json"))
  gone = SharedSection.prune_house(seeds)
  added = SharedSection.add_house(seeds)
  changed = SharedSection.refresh_house(seeds)
  SharedSection.backfill_swing
  print("#{gone} sections taken away, #{added} added, #{changed} played again")
end

# The sections before are gone with the old catalogue: nothing to put back.
def down(db)
  nil
end
