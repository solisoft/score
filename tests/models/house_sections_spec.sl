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
    assert_eq(seeds.length, 210)
    assert_eq(SharedSection.add_house(seeds), 210, "none refused by the engraver or the rules")
    house = SharedSection.where({"user_id": "score"}).all
    assert_eq(house.length, 210)
    drums = house.filter do |section|
      section.instrument == "drums"
    end
    assert_eq(drums.length, 150, "a 1-bar loop, a 2-bar loop and a break a groove")
    assert_eq(drums.filter(&{ |section|
      section.bars == 1
    }).length, 100, "the 1-bar loops and the breaks")
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

  test("refresh_house plays a changed section again, keeping its ratings; an unchanged or refused one is left") do
    seeds = house_seeds()
    SharedSection.add_house([seeds[0], seeds[1]])
    first = SharedSection.where({"seed": seeds[0]["seed"]}).first
    first.source = "{ c'1 }"
    first.rating_count = 3
    first.update()
    refused = seeds[1].merge({"source": "{ c'1 | d'1 }", "instrument": "kazoo"})
    assert_eq(SharedSection.refresh_house([
      seeds[0],
      refused,
      {"seed": "nowhere", "source": "x"}
    ]), 1)
    again = SharedSection.find(first._key)
    assert_eq(again.source, seeds[0]["source"])
    assert_eq(again.rating_count, 3, "its ratings kept")
    assert_eq(
      SharedSection.where({"seed": seeds[1]["seed"]}).first.source,
      seeds[1]["source"],
      "a refused one as it was"
    )
    assert_eq(SharedSection.refresh_house([seeds[0]]), 0, "nothing changed: nothing written")
  end

  test("swing_of reads the swing a source asks for (#453), and nothing else") do
    assert_eq(SharedSection.swing_of("{ c'1 }\n%% eui-score {\"swing\":{\"amount\":62,\"unit\":8}}"), "62/8")
    assert_eq(SharedSection.swing_of("{ c'1 }\n%% eui-score {\"swing\":{\"amount\":60,\"unit\":16}}"), "60/16")
    assert_eq(SharedSection.swing_of("{ c'1 }"), "")
    assert_eq(
      SharedSection.swing_of("{ c'1 }\n%% eui-score {\"swing\":{\"amount\":50,\"unit\":8}}"),
      "",
      "even: straight"
    )
    assert_eq(SharedSection.swing_of("{ c'1 }\n%% eui-score {\"swing\":{\"amount\":90,\"unit\":8}}"), "", "past 75")
    assert_eq(SharedSection.swing_of("{ c'1 }\n%% eui-score {\"swing\":{\"amount\":62,\"unit\":4}}"), "")
    assert_eq(SharedSection.swing_of("{ c'1 }\n%% eui-score not json"), "")
    assert_eq(SharedSection.swing_of(nil), "")
  end

  test("the house's swing sections keep their swing; backfill_swing sets it on those kept before") do
    seeds = house_seeds()
    swing = seeds.filter do |fields|
      fields["seed"] == "style:swing:bass"
    end.first
    pop = seeds.filter do |fields|
      fields["seed"] == "style:pop:bass"
    end.first
    SharedSection.add_house([swing, pop])
    assert_eq(SharedSection.where({"seed": "style:swing:bass"}).first.swing, "66/8")
    assert_eq(SharedSection.where({"seed": "style:pop:bass"}).first.swing, "")
    old = SharedSection.where({"seed": "style:swing:bass"}).first
    old.swing = nil
    old.update()
    assert(SharedSection.backfill_swing >= 1)
    assert_eq(SharedSection.find(old._key).swing, "66/8")
  end

  test("prune_house takes away the house's sections the file no longer has, and only those") do
    seeds = house_seeds()
    SharedSection.add_house([seeds[0], seeds[1]])
    old = SharedSection.where({"seed": seeds[1]["seed"]}).first
    mine = SharedSection.create({
      "user_id": "someone",
      "title": "Mine",
      "instrument": "drums",
      "style": "rock",
      "source": "{ c'1 }"
    })
    assert_eq(SharedSection.prune_house([seeds[0]]), 1)
    assert_null(SharedSection.where({"seed": seeds[1]["seed"]}).first)
    assert_not_null(SharedSection.where({"seed": seeds[0]["seed"]}).first)
    assert_not_null(SharedSection.find(mine._key), "nobody else's")
    assert_eq(SharedSection.prune_house([seeds[0]]), 0)
    old.remove rescue nil
    mine.delete
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
