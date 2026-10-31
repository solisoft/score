# Migration: swing_in_sections — the library's sections that swing are
# heard swung (#453): the house's own played again with their `%% eui-score`
# swing line, and every section's `swing` read from its source, for the
# cards' Play. Ratings and comments are kept.

def up(db)
  changed = SharedSection.refresh_house(JSON.parse(File.read("db/data/house_sections.json")))
  swinging = SharedSection.backfill_swing
  print("#{changed} sections of the library played again; #{swinging} swing")
end

# The swing line is gone with the old catalogue: nothing to put back.
def down(db)
  nil
end
