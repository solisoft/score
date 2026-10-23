# Migration: backfill_score_composers — the composer of each score, read
# from its source's \header as the title is (Score#stamp), for the scores
# saved before it was kept: the library searches it (#370). Their times and
# revision are left as they were.

def up(db)
  Score.backfill_composers
end

def down(db)
  db.query("FOR s IN scores FILTER s.composer != null UPDATE s WITH { composer: null } IN scores")
end
