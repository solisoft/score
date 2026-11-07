# What a write from a stale copy of a record puts in the database, on the
# Soli this app runs (#685). Two copies of one account are read; the second
# changes a field and is saved; then the first, which never saw that change,
# is written. These facts decide which writes in the app can undo another.

def stale_facts_user
  user = User.new()
  user.email = "stale-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.locale = "en"
  user.session_version = 1
  user.save
  user
end

describe("A write from a stale copy") do
  test("save writes every field: it puts back a field it never changed") do
    user = stale_facts_user()
    stale = User.find(user._key)
    fresh = User.find(user._key)
    fresh.session_version = 2
    fresh.save
    stale.locale = "fr"
    stale.save
    stored = User.find(user._key)
    assert_eq(stored.locale, "fr")
    assert_eq(stored.session_version, 1)
  end

  test("update() with no argument writes every field, the same as save") do
    user = stale_facts_user()
    stale = User.find(user._key)
    fresh = User.find(user._key)
    fresh.session_version = 2
    fresh.save
    stale.locale = "fr"
    stale.update()
    assert_eq(User.find(user._key).session_version, 1)
  end

  test("update(attrs) writes every field too, not only the ones it names") do
    user = stale_facts_user()
    stale = User.find(user._key)
    fresh = User.find(user._key)
    fresh.session_version = 2
    fresh.save
    stale.update({"locale": "fr"})
    stored = User.find(user._key)
    assert_eq(stored.locale, "fr")
    assert_eq(stored.session_version, 1)
  end

  test("a stale copy saved unchanged still writes its old values back") do
    user = stale_facts_user()
    stale = User.find(user._key)
    fresh = User.find(user._key)
    fresh.session_version = 2
    fresh.save
    stale.save
    assert_eq(User.find(user._key).session_version, 1)
  end

  test("update_all on a scope writes the fields it names, nothing else") do
    user = stale_facts_user()
    fresh = User.find(user._key)
    fresh.session_version = 2
    fresh.save
    User.where({"_key": user._key}).update_all({"locale": "fr"})
    stored = User.find(user._key)
    assert_eq(stored.locale, "fr")
    assert_eq(stored.session_version, 2)
  end
end

describe("A nil written field by field") do
  test("update_all with a nil empties the field") do
    user = stale_facts_user()
    User.where({"_key": user._key}).update_all({"locale": nil})
    assert_null(User.find(user._key).locale)
  end

  test("an @sdbql UPDATE with a null empties the field") do
    user = stale_facts_user()
    key = user._key
    patch = {"locale": nil}
    @sdbql{
      FOR u IN users
      FILTER u._key == #{key}
      UPDATE u WITH #{patch} IN users
      RETURN NEW._key
    }
    assert_null(User.find(user._key).locale)
  end
end
