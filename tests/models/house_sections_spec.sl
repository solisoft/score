# The sections the shared library starts with (#447): db/data/house_sections.json,
# made by scripts/section-seeds.mjs, put in by the migration add_house_sections.

def house_seeds
  JSON.parse(File.read("db/data/house_sections.json"))
end

describe("SharedSection.add_house") do
  before_each() do
    requires_solidb()
    SharedSection.remove_house
  end

  test("puts in every style and every groove, each one engraved, signed Score, once") do
    seeds = house_seeds()
    assert_eq(seeds.length, 110)
    assert_eq(SharedSection.add_house(seeds), 110, "none refused by the engraver or the rules")
    house = SharedSection.where({"user_id": "score"}).all
    assert_eq(house.length, 110)
    assert_eq(house.filter(&{ |section|
      section.instrument == "drums"
    }).length, 50, "a groove each")
    assert_eq(house.filter(&{ |section|
      section.instrument == "band"
    }).length, 15, "the whole band, a style each")
    assert_eq(SharedSection.author_names(["score"])["score"], "Score")
    assert_eq(SharedSection.add_house(seeds), 0, "a second run adds nothing")
    listed = SharedSection.library("bossa", "", "", "recent", 1)["sections"]
    assert(listed.length >= 5, "found by its name")
  end

  test("leaves out a section the rules refuse, and one already there") do
    seeds = house_seeds()
    broken = seeds[0].merge({"seed": "spec:broken", "instrument": "kazoo"})
    assert_eq(SharedSection.add_house([seeds[0], broken]), 1)
    assert_eq(SharedSection.add_house([seeds[0]]), 0)
    assert_null(SharedSection.where({"seed": "spec:broken"}).first)
  end

  test("remove_house takes them away, and nobody else's") do
    SharedSection.add_house([house_seeds()[0]])
    mine = SharedSection.create({
      "user_id": "someone",
      "title": "Mine",
      "instrument": "drums",
      "style": "rock",
      "source": "{ c'1 }"
    })
    SharedSection.remove_house
    assert_eq(SharedSection.where({"user_id": "score"}).count, 0)
    assert_not_null(SharedSection.find(mine._key))
    mine.delete
  end
end
