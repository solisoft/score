# The editor's AI assistant: what it asks for each action, how it reads the
# answer, and the suggestions kept per person.

const MELODY = "\\header { title = \"Tune\" }\n{ c'4 d' e' f' | g'1 }"

def assistant_user
  user = User.new()
  user.email = "assistant-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

describe("ScoreAssistant") do
  describe("the question") do
    test("carries the score, the task of the action, and the request") do
      turns = ScoreAssistant.turns("  #{MELODY}  ", "chords", "jazz, please")
      assert_eq(turns.length, 1)
      text = turns[0]["text"]
      assert_contains(text, "```lilypond\n#{MELODY}\n```")
      assert_contains(text, "Add chord symbols to the melody")
      assert_contains(text, "c'4^\"Am7\" (the editor reads them")
      assert_contains(text, "Do not change any note.")
      assert_contains(text, "The request: jazz, please")
      assert_contains(text, "voices with << { … } \\\\ { … } >>")
      assert_not(text.includes?("{TASK}"), "every placeholder filled")
    end

    test("has a task for each action, and no request line without one") do
      assert_eq(ScoreAssistant.actions, [
        "chords",
        "harmonize",
        "improve",
        "ask"
      ])
      assert_contains(ScoreAssistant.turns(MELODY, "harmonize", "")[0]["text"], "\\new PianoStaff")
      assert_contains(ScoreAssistant.turns(MELODY, "improve", nil)[0]["text"], "bar number")
      assert_not(ScoreAssistant.turns(MELODY, "improve", "  ")[0]["text"].includes?("The request:"))
    end
  end

  describe("the answer") do
    test("is the explanation before the fence, and the score in the last lilypond block") do
      text = "I added a ii–V–I.\n\n```lilypond\n{ c'4 }\n```\nThen:\n```lilypond\n{ d'4 e' }\n```\n"
      parsed = ScoreAssistant.parsed({"text": text})
      assert_eq(parsed["explanation"], "I added a ii–V–I.")
      assert_eq(parsed["source"], "{ d'4 e' }")
      assert_eq(parsed["raw"], text)
      assert_eq(ScoreAssistant.parsed({"text": "Done.\n```ly\n{ f'4 }\n```"})["source"], "{ f'4 }")
    end

    test("names an answer without a score, and passes an error on") do
      no_score = "The AI answered without a score. Try again, or ask differently."
      assert_eq(ScoreAssistant.parsed({"text": "Just words."})["error"], no_score)
      assert_eq(ScoreAssistant.parsed({"text": "```python\nprint(1)\n```"})["error"], no_score)
      assert_eq(ScoreAssistant.parsed({"text": "```lilypond\n   \n```"})["error"], no_score)
      assert_eq(ScoreAssistant.parsed({"error": "busy"}), {"error": "busy"})
    end
  end
end

describe("ScoreSuggestion") do
  test("starts working on a score, counted against the day's questions, in a job") do
    user = assistant_user()
    score = Score.start(user, MELODY)
    assert_eq(ScoreSuggestion.left_today(user), SCORE_READINGS_PER_DAY)
    suggestion = ScoreSuggestion.start(user, score, "chords", "  jazz ", MELODY)
    stored = ScoreSuggestion.find(suggestion._key)
    assert_eq(stored.state, "working")
    assert_eq(stored.request, "jazz")
    assert_eq(stored.original, MELODY)
    assert_eq(stored.score_id, score._key)
    assert(stored.owned_by?(user))
    assert_not(stored.owned_by?(assistant_user()))
    assert_not(stored.owned_by?(nil))
    assert_eq(ScoreSuggestion.left_today(user), SCORE_READINGS_PER_DAY - 1)
    assert_eq(Score.find(score._key).source, MELODY, "the score itself unchanged")
  end

  test("allows more with a key of one's own, none once the day's are used") do
    user = assistant_user()
    user.keep_ai_key("openai", "gpt-5", "sk-own-key-5555")
    assert_eq(ScoreSuggestion.left_today(User.find(user._key)), SCORE_READINGS_OWN_PER_DAY)
    other = assistant_user()
    (0 .. SCORE_READINGS_PER_DAY).each do |_|
      ScoreSuggestion.create({
        "user_id": other._key,
        "score_id": "s",
        "action": "improve",
        "state": "done",
        "created_at": DateTime.utc.to_unix
      })
    end
    assert_eq(ScoreSuggestion.left_today(other), 0)
  end

  test("a suggestion already finished is not asked again") do
    user = assistant_user()
    suggestion = ScoreSuggestion.create({
      "user_id": user._key,
      "score_id": "s",
      "action": "chords",
      "state": "done",
      "source": "{ c4 }",
      "created_at": DateTime.utc.to_unix
    })
    ScoreSuggestionJob.perform({"suggestion_id": suggestion._key})
    assert_eq(ScoreSuggestion.find(suggestion._key).source, "{ c4 }")
  end

  test("ends failed, not stuck, when its work breaks") do
    suggestion = ScoreSuggestion.create({
      "user_id": "no-such-user",
      "score_id": "s",
      "action": "chords",
      "state": "working",
      "original": "{ c'4 }",
      "created_at": DateTime.utc.to_unix
    })
    ScoreSuggestionJob.perform({"suggestion_id": suggestion._key})
    stored = ScoreSuggestion.find(suggestion._key)
    assert_eq(stored.state, "failed")
    assert_eq(stored.error, "Something went wrong while asking the AI. Try again.")
  end

  test("refuses an action or a state it does not know") do
    assert_null(ScoreSuggestion.create({
      "user_id": "u",
      "score_id": "s",
      "action": "compose",
      "state": "working"
    })._key)
    assert_null(ScoreSuggestion.create({
      "user_id": "u",
      "score_id": "s",
      "action": "chords",
      "state": "lost"
    })._key)
  end
end
