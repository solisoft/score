# Migration: create_two_step_guards — what an account's second step has seen
# (#538): the wrong codes typed at it and the codes spent, one row per
# account (TwoStepGuard), written as a compare-and-set. The unique index on
# user_id keeps two requests making an account's row at once to one row.

def up(db)
  db.create_collection("two_step_guards")
  db.create_index("two_step_guards", "idx_two_step_guards_user", ["user_id"], {"unique": true})
end

def down(db)
  db.drop_collection("two_step_guards")
end
