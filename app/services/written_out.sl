# About how much music a LilyPond source comes to once written out, read
# without engraving it (Score.too_much_music?): its words and signs, a
# `\repeat unfold` or `percent` block counted as many times as it plays (its
# `\alternative` endings too), a variable as often as it is used, a repeat
# or a `R1*\n` counted by a variable as that number, a whole-bar rest `R1*n`
# (or a spacer, `s1*n`) as its n bars, an `\autoChange` three times (a note
# on one staff, rests on the other).
#
# The engraver writes all of that out before it lays a note: 80 characters
# of three nested `\repeat unfold` lay out a quarter of a million notes, 14
# characters of rest a million bars, in seconds a page. The count is on the
# high side — every word counts, a bar line or a dynamic as a note, a
# variable never used as its music — so what it lets through engraves.
#
# It never goes past one more than the bound (WrittenOut.most): what is
# over is over, and a count of nested repeats multiplied in full would not
# fit in an Int.

# A variable's name, as the engraver reads it: letters, a single `-` or `_`
# between two of them (`a-x`, `left_hand`); no digit.
const WRITTEN_OUT_NAME = "[A-Za-z]+(?:[-_][A-Za-z]+)*"
# A source's tokens, once its spaces are single: a command, a block's
# brackets, `=`, a word with a `*n` (or a `*\name`), or a run of plain
# words, counted at once (a million characters read in a second or two, not
# ten). A run never swallows a `<<` or a `>>`.
const WRITTEN_OUT_TOKENS = "\\\\" + WRITTEN_OUT_NAME
+ "|<<|>>|[{}=]|[^ {}=\\\\<>*]*\\*(?:\\d+(?:/\\d+)?|\\\\[A-Za-z_-]+)|"
+ "(?:(?:[^ {}=\\\\<>*]|<[^< {}=\\\\*]|>[^> {}=\\\\*])+ ?)+"
# A comment, which goes as a space (it parts words, nothing more), or a
# string, which stays as `""`: one word, whatever it held.
const WRITTEN_OUT_ASIDES = "%\\{[\\s\\S]*?%\\}|%[^\\n]*|(?P<q>\")(?:[^\"\\\\]|\\\\.)*\""
# A note's written length: `c'4.` 4 and a dot, `R1*4` 1, `<c e>2` 2.
const WRITTEN_OUT_DURATION = "^[^0-9\\\\]*?[A-Za-z',!?>](?P<d>128|64|32|16|8|4|2|1)(?P<dots>\\.*)(?:[^0-9/]|$)"
# A length's dots: 1 + 1/2 + 1/4… in halves, quarters, as integers.
const WRITTEN_OUT_DOTTED = [
  1,
  3,
  7,
  15,
  31
]
const WRITTEN_OUT_HALVES = [
  1,
  2,
  4,
  8,
  16
]

class WrittenOut
  # The last source counted, and its count: a source read twice in a
  # request (its bounds, then its validation) is read once. `readings` is
  # how many were read in full, for the specs.
  static last_source: Any = nil
  static last_count: Int = 0
  static readings: Int = 0

  # Each open block's weight so far, and how many times it plays.
  weights: Array
  times: Array
  variables: Hash

  # The variables that are a number (`n = 64`), for `\repeat unfold \n`.
  numbers: Hash

  # The repeats waiting for their music, multiplied: `\repeat unfold 4
  # \relative c' { … }` repeats the block, not the pitch between.
  pending: Int
  carried: Bool

  # How many times the last music read plays: the `\alternative` after a
  # repeat plays as often.
  last_times: Int

  # The top-level variable being read (`name = …`), and the weight before it.
  defining: Any
  mark: Int
  previous: String

  # The shortest metre written, when it is shorter than a half note
  # (beats/unit; unit 0 when none is): a note longer than its bar is that
  # many tied notes. The length the next note without one has (`c1 d e`).
  beats: Int
  unit: Int
  length: Array

  # The count for `source`.
  static def count(source)
    src = source.to_s
    return WrittenOut.last_count if src == WrittenOut.last_source

    counted = WrittenOut.new().read_source(src)
    WrittenOut.readings = WrittenOut.readings + 1
    WrittenOut.last_source = src
    WrittenOut.last_count = counted
    counted
  end

  # One more than the bound: what a count never passes.
  static def most
    SCORE_MOST_WRITTEN_OUT + 1
  end

  static def capped(n)
    [n, WrittenOut.most].min()
  end

  # How many bars a word stands for: `R1*12` 12, `R2.*3/2` 1, a note 1;
  # never more than `most`.
  static def times_of(word)
    found = Regex.capture("\\*(?P<times>\\d+)(?:/(?P<per>\\d+))?$", word)
    return 1 if found.nil?

    per = [found["per"].to_s.to_i, 1].max()
    WrittenOut.capped([(found["times"].to_i / per).to_i, 1].max())
  end

  # The count of a whole source: comments and strings set aside, `R1 * 4`
  # read as `R1*4`, as the engraver does.
  def read_source(src)
    text = Regex.replace_all(WRITTEN_OUT_ASIDES, src, " ${q}${q} ")
    text = Regex.replace_all("\\s*\\*\\s*", text, "*")
    text = Regex.replace_all("\\s+", text, " ").trim
    return 0 if text.blank?

    @_start(text)
    # No repeat written out, no variable: the words, and what each `*n` adds.
    return @_plain(text) unless Regex.matches("\\\\repeat (unfold|percent)|\\\\autoChange|[A-Za-z] ?=", text)

    @read(Regex.find_all(WRITTEN_OUT_TOKENS, text))
  end

  # The count over the tokens of a source with repeats or variables.
  def read(tokens)
    @weights = [0]
    @times = [1]
    i = 0
    count = tokens.length
    most = WrittenOut.most
    while i < count && @weights.last < most && @weights[0] < most
      token = tokens[i]["match"]
      i += @_take(token, tokens, i)
      @previous = token
    end
    WrittenOut.capped(@weights.sum)
  end

  # The shortest bar a `\time` sets, past the two of a 2/4 or a 6/8 the
  # count's margin covers: a `\time 1/64` lays a whole note, or an `R1*n`,
  # over 64 bars of tied notes or rests. None (unit 0) when no metre is
  # that short. The shortest anywhere, wherever it stands: which staff a
  # metre reaches is the engraver's to know.
  def bar_of(text)
    @beats = 1
    @unit = 0
    Regex.find_all("\\\\time ([0-9+]+)/(\\d+)", text).each do |found|
      parts = Regex.capture("\\\\time (?P<beats>[0-9+]+)/(?P<unit>\\d+)", found["match"])
      beats = WrittenOut.capped(parts["beats"].split("+").map(&:to_i).sum)
      unit = [parts["unit"].to_i, 1024].min()
      next if beats < 1 || unit <= 2 * beats
      next if @unit > 0 && beats * @unit >= @beats * unit

      @beats = beats
      @unit = unit
    end
    [@beats, @unit]
  end

  # How many items `word` lays out where a bar is that short: a note, a
  # chord or a rest longer than a bar as the bars it is tied over, and one
  # more for the bar line it may start before; anything else one.
  def span(word)
    found = Regex.capture(WRITTEN_OUT_DURATION, word)
    @length = [found["d"].to_i, [found["dots"].length, 4].min()] unless found.nil?
    starred = word.contains("*")
    return 1 unless starred || Regex.matches("^[a-zR<]", word)

    times = starred ? @_times(word) : [1, 1]
    num = times[0] * WRITTEN_OUT_DOTTED[@length[1]] * @unit
    den = times[1] * @length[0] * WRITTEN_OUT_HALVES[@length[1]] * @beats
    return 1 if num <= den

    # Integers divided may answer a float: the bars are whole.
    WrittenOut.capped(((num + den - 1) / den).to_i + 1)
  end

  private

  def _start(text)
    @variables = {}
    @numbers = {}
    @pending = 1
    @carried = false
    @last_times = 1
    @defining = nil
    @mark = 0
    @previous = ""
    @length = [4, 0]
    @bar_of(text)
  end

  # A source without repeats or variables, word after word.
  def _plain(text)
    words = text.split(" ")
    if @unit == 0
      added = Regex.find_all("\\*\\d+(?:/\\d+)?", text).map do |found|
        WrittenOut.times_of(found["match"]) - 1
      end
      return WrittenOut.capped(words.length + added.sum)
    end

    @_spans(words)
  end

  # The items of `words` in a short metre, read until past the bound.
  def _spans(words)
    total = 0
    i = 0
    most = WrittenOut.most
    while i < words.length && total < most
      total += @span(words[i])
      i += 1
    end
    WrittenOut.capped(total)
  end

  # A word's `*n` (`*n/m`, `*\name`): [n, m], n never past `most`.
  def _times(word)
    named = Regex.capture("\\*\\\\(?P<name>#{WRITTEN_OUT_NAME})$", word)
    return [WrittenOut.capped([@numbers[named["name"]] ?? 1, 1].max()), 1] unless named.nil?

    found = Regex.capture("\\*(?P<times>\\d+)(?:/(?P<per>\\d+))?$", word)
    return [1, 1] if found.nil?

    [WrittenOut.capped([found["times"].to_i, 1].max()), [[found["per"].to_s.to_i, 1].max(), 1024].min()]
  end

  # One token read: how many it took — a repeat takes the words after it,
  # its kind, its count (a number, or a variable that is one), and the music
  # when it is words.
  def _take(token, tokens, i)
    taken = token == "\\repeat" ? @_take_repeat(tokens, i) : 0
    return taken if taken > 0

    if token == "\\alternative"
      # Its endings play as often as the music they end, at most.
      @_add(1)
      @_repeat(@last_times)
      return 1
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

  # A `\repeat unfold` or `percent` at `i`, its count a number or a
  # variable that is one: how many tokens it took, 0 when it is neither.
  def _take_repeat(tokens, i)
    after = i + 1 < tokens.length ? tokens[i + 1]["match"].trim.split(" ") : []
    return 0 unless after.length > 0 && ["unfold", "percent"].includes?(after[0])

    if after.length > 1
      @_repeat([after[1].to_i, 1].max())
      @_word(after.slice(2, after.length).join(" ")) if after.length > 2
      return 2
    end

    count = i + 2 < tokens.length ? tokens[i + 2]["match"] : ""
    name = count.starts_with?("\\") ? count.substring(1, count.length) : ""
    return 0 unless @numbers.has_key(name)

    @_repeat(@numbers[name])
    3
  end

  def _add(weight)
    @weights[@weights.length - 1] = WrittenOut.capped(@weights.last + weight)
  end

  def _repeat(times)
    @pending = WrittenOut.capped(@pending * WrittenOut.capped(times))
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

    @last_times = @times.pop()
    @_add(WrittenOut.capped(@weights.pop() * @last_times))
    return nil unless @weights.length == 1 && !@defining.nil?

    @variables[@defining] = @weights[0] - @mark
    @defining = nil
  end

  # `name =` at the top: the last word before it is the variable's name.
  def _define
    name = @previous.trim.split(" ").last.to_s
    return nil unless Regex.matches("^#{WRITTEN_OUT_NAME}$", name)

    @defining = name
    @mark = @weights[0]
  end

  # A run of words (or a word with a `*n`) as [the first's weight, the
  # others'].
  def _weights(token)
    text = token.trim
    if @unit == 0
      times = @_times(text)
      return [[(times[0] / times[1]).to_i, 1].max(), 0] if text.contains("*")

      return [1, text.split(" ").length - 1]
    end

    words = text.split(" ")
    [@span(words[0]), @_spans(words.slice(1, words.length))]
  end

  # A command, a variable, a word with a `*n`, or a run of words. A repeat
  # waiting for its music repeats the first of them — unless a command came
  # between (`\relative c'`), when it is the block after them it repeats.
  def _word(token)
    command = token.starts_with?("\\")
    name = command ? token.substring(1, token.length) : nil
    weights = command ? [@variables[name] ?? 1, 0] : @_weights(token)
    times = @carried && !command ? 1 : @pending
    @last_times = times
    @_add(WrittenOut.capped(weights[0] * times) + weights[1])
    if command && !@variables.has_key(name)
      # `\relative`, `\fixed c'`…: the music it is for comes next.
      @carried = true
    elsif !@carried
      @pending = 1
    end
    # A value right after `name =`: a word, a number or a string, or another
    # variable — not a block, which is known when it closes.
    return nil unless !@defining.nil? && @weights.length == 1 && @previous == "="

    if command
      return nil unless @variables.has_key(name)

      @variables[@defining] = @variables[name]
      @numbers[@defining] = @numbers[name] if @numbers.has_key(name)
    else
      @variables[@defining] = WrittenOut.capped(weights[0] + weights[1])
      value = token.trim.split(" ")[0].to_s
      @numbers[@defining] = WrittenOut.capped(value.to_i) if Regex.matches("^\\d+$", value)
    end
    @defining = nil
  end
end
