# About how much music a LilyPond source comes to once written out, read
# without engraving it (Score.too_much_music?): its words and signs, a
# `\repeat unfold` or `percent` block counted as many times as it plays, a
# variable as often as it is used, a whole-bar rest `R1*n` (or a spacer,
# `s1*n`) as its n bars, an `\autoChange` three times (a note on one staff,
# rests on the other).
#
# The engraver writes all of that out before it lays a note: 80 characters
# of three nested `\repeat unfold` lay out a quarter of a million notes, 14
# characters of rest a million bars, in seconds a page. The count is on the
# high side — every word counts, a bar line or a dynamic as a note, a
# variable never used as its music — so what it lets through engraves.

# A source's tokens, once its spaces are single: a command, a block's
# brackets, `=`, a word with a `*n`, or a run of plain words, counted at
# once (a million characters read in a second or two, not ten). A run never
# swallows a `<<` or a `>>`.
const WRITTEN_OUT_TOKENS = "\\\\[A-Za-z]+|<<|>>|[{}=]|[^ {}=\\\\<>*]*\\*\\d+(?:/\\d+)?|"
+ "(?:(?:[^ {}=\\\\<>*]|<[^< {}=\\\\*]|>[^> {}=\\\\*])+ ?)+"

class WrittenOut
  # Each open block's weight so far, and how many times it plays.
  weights: Array
  times: Array
  variables: Hash

  # The repeats waiting for their music, multiplied: `\repeat unfold 4
  # \relative c' { … }` repeats the block, not the pitch between.
  pending: Int
  carried: Bool

  # The top-level variable being read (`name = …`), and the weight before it.
  defining: Any
  mark: Int
  previous: String

  # The count for `source`.
  static def count(source)
    text = Regex.replace_all("%\\{[\\s\\S]*?%\\}|%[^\\n]*|\"(?:[^\"\\\\]|\\\\.)*\"", source.to_s, " \"\" ")
    text = Regex.replace_all("\\s+", text, " ").trim
    return 0 if text.blank?

    # No repeat written out, no variable: the words, and what each `*n` adds.
    unless Regex.matches("\\\\repeat (unfold|percent)|\\\\autoChange|[A-Za-z] ?=", text)
      added = Regex.find_all("\\*\\d+(?:/\\d+)?", text).map do |found|
        WrittenOut.times_of(found["match"]) - 1
      end
      return (text.split(" ").length + added.sum) * WrittenOut.short_bars(text)
    end

    WrittenOut.new().read(Regex.find_all(WRITTEN_OUT_TOKENS, text)) * WrittenOut.short_bars(text)
  end

  # How many bars a whole note may be cut into, past the two of a 2/4 or a
  # 6/8 the count's margin covers: a `\time 1/64` lays a whole note, or an
  # `R1*n`, over 64 bars of tied notes or rests. 1 when no metre is that short.
  static def short_bars(text)
    most = 1
    Regex.find_all("\\\\time ([0-9+]+)/(\\d+)", text).each do |found|
      parts = Regex.capture("\\\\time (?P<beats>[0-9+]+)/(?P<unit>\\d+)", found["match"])
      beats = parts["beats"].split("+").map(&:to_i).sum
      unit = parts["unit"].to_i
      next if beats < 1 || unit <= 2 * beats

      most = [most, (unit + beats - 1) / beats].max()
    end
    most
  end

  # How many bars a word stands for: `R1*12` 12, `R2.*3/2` 1, a note 1.
  static def times_of(word)
    found = Regex.capture("\\*(?P<times>\\d+)(?:/(?P<per>\\d+))?$", word)
    return 1 if found.nil?

    [found["times"].to_i / [found["per"].to_s.to_i, 1].max(), 1].max()
  end

  # The count over the tokens of a source with repeats or variables.
  def read(tokens)
    @weights = [0]
    @times = [1]
    @variables = {}
    @pending = 1
    @carried = false
    @defining = nil
    @mark = 0
    @previous = ""
    i = 0
    count = tokens.length
    while i < count
      token = tokens[i]["match"]
      i += @_take(token, tokens, i)
      @previous = token
    end
    @weights[0]
  end

  private

  # One token read: how many it took — a repeat takes the words after it,
  # its kind, its count, and the music when it is words.
  def _take(token, tokens, i)
    after = token == "\\repeat" && i + 1 < tokens.length ? tokens[i + 1]["match"].trim.split(" ") : []
    if after.length > 1 && ["unfold", "percent"].includes?(after[0])
      @_repeat([after[1].to_i, 1].max())
      @_word(after.slice(2, after.length).join(" ")) if after.length > 2
      return 2
    end

    if token == "\\autoChange"
      @_repeat(3)
    elsif token == "{" || token == "<<"
      @_open
    elsif token == "}" || token == ">>"
      @_close
    elsif token == "=" && @weights.length == 1
      @_define
    else
      @_word(token)
    end
    1
  end

  def _repeat(times)
    @pending = @pending * times
    @carried = false
  end

  def _open
    @weights.push(0)
    @times.push(@pending)
    @pending = 1
    @carried = false
  end

  # A block closed: its weight, times its repeats, added to the one around
  # it; back at the top, the variable it was the value of is known.
  def _close
    return nil if @weights.length < 2

    inner = @weights.pop() * @times.pop()
    @weights[@weights.length - 1] = @weights.last + inner
    return nil unless @weights.length == 1 && !@defining.nil?

    @variables[@defining] = @weights[0] - @mark
    @defining = nil
  end

  # `name =` at the top: the last word before it is the variable's name.
  def _define
    name = @previous.trim.split(" ").last.to_s
    return nil unless Regex.matches("^[A-Za-z]+$", name)

    @defining = name
    @mark = @weights[0]
  end

  # A command, a variable, a word with a `*n`, or a run of words. A repeat
  # waiting for its music repeats the first of them — unless a command came
  # between (`\relative c'`), when it is the block after them it repeats.
  def _word(token)
    command = token.starts_with?("\\")
    name = command ? token.substring(1, token.length) : nil
    others = command || token.contains("*") ? 0 : token.trim.split(" ").length - 1
    weight = command ? (@variables[name] ?? 1) : WrittenOut.times_of(token.trim)
    times = @carried && !command ? 1 : @pending
    @weights[@weights.length - 1] = @weights.last + weight * times + others
    if command && !@variables.has_key(name)
      # `\relative`, `\fixed c'`…: the music it is for comes next.
      @carried = true
    elsif !@carried
      @pending = 1
    end
    # A value that is a word, a number or a string, not music.
    return nil unless !@defining.nil? && !command && @weights.length == 1 && @previous == "="

    @variables[@defining] = weight + others
    @defining = nil
  end
end
