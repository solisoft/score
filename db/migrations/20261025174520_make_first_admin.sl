# The site's first admin (#399): the owner's account, which opens /admin.
# Others are made admin by setting their `role` the same way. An address
# with no account changes nothing.

def up(db)
  db.query("""
    FOR user IN users
      FILTER user.email == 'olivier@solisoft.net'
      UPDATE user WITH { role: 'admin' } IN users
  """)
end

def down(db)
  db.query("""
    FOR user IN users
      FILTER user.email == 'olivier@solisoft.net'
      UPDATE user WITH { role: 'member' } IN users
  """)
end
