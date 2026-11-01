# The engraver's own limits (#540), as the app asks for them and says them.
#
# The engraver (eui-score, pinned by Soli and by wasm/Cargo.toml) refuses,
# while it reads a source, music that writes out to more than 20,000 notes
# — its repeats and variables in full, its marks, keys and rest bars
# counted — or 40,000 characters of words, more words of source than it
# reads (written out or not), blocks or Scheme nested more than 64 deep,
# and a note past MIDI's keys; while it draws, more than
# 400,000 shapes or 6,000,000 points. Each is a refusal like any other,
# "score: … the engraver stops there (at character N)", in a few
# milliseconds; a source within them lays out in 0.1 to 0.3 s at most.
#
# What the app asks of it is that refusal alone: a source the engraver
# cannot read for another reason (a typo, a command it does not know) is
# still saved, as a draft is, and engraved with its own message.
#
# The engraver says it in English; EngraverLimit.said says it in the app's
# language (config/locales, security_540.limits). The MCP tools and the AI
# answer the engraver's own words.

# The width a source is laid out at to be asked: the one ScoreSvg.check and
# SharedSection.problem lay it out at, so the engraver's own last
# engravings (Soli keeps 16) answer the second asking.
const ENGRAVER_LIMIT_WIDTH = 100
# The refusals that are limits, by what they say (eui-score's written.rs,
# parse.rs, draw.rs), and the key each is said with.
const ENGRAVER_LIMITS = [
  ["writes out to more than [0-9,]+ notes", "notes"],
  ["out to more music than this engraves", "music"],
  ["the source is longer than this engraves", "length"],
  ["characters of words", "words"],
  ["draws more than", "drawn"],
  ["nests too deep|more than [0-9]+ deep", "nesting"],
  ["beyond the keys of any instrument", "pitch"]
]

class EngraverLimit
  # The engraver's refusal of `src` when it is one of its limits, as it
  # says it ("score: … (at character N)"), or nil: within them, or refused
  # for another reason.
  static def of(src)
    return nil if src.to_s.blank?

    laid = eui_score_layout(src.to_s, ENGRAVER_LIMIT_WIDTH, {}) rescue {"error": nil}
    EngraverLimit.limit?(laid["error"]) ? laid["error"].to_s : nil
  end

  # Whether the engraver's `message` is one of its limits.
  static def limit?(message)
    !EngraverLimit.kind_of(message).nil?
  end

  # Which of ENGRAVER_LIMITS the engraver's `message` is ("notes", "pitch"…),
  # or nil.
  static def kind_of(message)
    return nil if message.to_s.blank?

    found = ENGRAVER_LIMITS.find do |limit|
      Regex.matches(limit[0], message.to_s)
    end
    found.nil? ? nil : found[1]
  end

  # The engraver's `message` in the app's language when it is one of its
  # limits, with where the source passes it; any other message as it is.
  static def said(message)
    kind = EngraverLimit.kind_of(message)
    return message if kind.nil?

    found = Regex.capture("\\(at character (?P<at>[0-9]+)\\)", message.to_s)
    text = SiteText.t("security_540.limits.#{kind}")
    return text if found.nil? || found["at"].to_s.to_i == 0

    text + " " + SiteText.t("security_540.at_character", {"at": found["at"]})
  end
end
