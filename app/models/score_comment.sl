# A message of a comment thread (ScoreThread, #385): its author (`user_id`),
# its text, when it was written and, once its author changed it, when
# (`edited_at`). Only its author may change or delete it.
const SCORE_COMMENT_LENGTH = 5000

class ScoreComment < Model
  validates("thread_id", {"presence": true})
  validates("score_id", {"presence": true})
  validates("user_id", {"presence": true})
  # Its length is `body_error`'s to check, in characters (a validation's
  # max_length counts bytes, which an accent makes more of).
  validates("body", {"presence": true})

  # Why `body` may not be a message, or nil.
  static def body_error(body)
    text = body.to_s.trim
    return "Write something first." if text.blank?

    too_long = "A message holds #{SCORE_COMMENT_LENGTH} characters at most."
    return too_long if text.chars().length > SCORE_COMMENT_LENGTH

    nil
  end

  # `body` written in `thread` by `user` (checked by `body_error` first).
  static def write(thread, user, body)
    ScoreComment.create({
      "thread_id": thread._key,
      "score_id": thread.score_id,
      "user_id": user._key,
      "body": body.to_s.trim,
      "created_at": DateTime.utc.to_unix
    })
  end

  def written_by?(user)
    !user.nil? && @user_id == user._key
  end

  # The text changed to `body` by `user`: nil once done, else why not.
  def edit_by(user, body)
    return "Only its author may change a message." unless @written_by?(user)

    problem = ScoreComment.body_error(body)
    return problem unless problem.nil?

    @body = body.to_s.trim
    @edited_at = DateTime.utc.to_unix
    @save
    nil
  end

  # The message gone, by `user`, its author; its thread too when it was the
  # last. Answers nil once done, else why not.
  def remove_by(user)
    return "Only its author may delete a message." unless @written_by?(user)

    @delete
    thread = ScoreThread.find_by("_key", @thread_id)
    return nil if thread.nil?

    if ScoreComment.where({"thread_id": thread._key}).count == 0
      thread.delete
    else
      thread.touch
    end
    nil
  end

  # The message as the editor shows it, its author named from `names`.
  def view(names)
    {
      "id": @_key,
      "author_id": @user_id,
      "author": names[@user_id] ?? "Someone",
      "body": @body,
      "created_at": @created_at,
      "edited_at": @edited_at
    }
  end

  # Who of `people` (users) `body` names with an @: their address, the part
  # of it before the @, their name, or its first word, in any case ("@ana",
  # "@ana@example.com", "@Ana"). Each once.
  static def mentioned(body, people)
    words = Regex.replace_all("\\s+", body.to_s.downcase, " ").split(" ")
    said = words.filter do |word|
      word.starts_with?("@") && word.length > 1
    end.map do |word|
      Regex.replace_all("[.,;:!?)\\]]+$", word.substring(1, word.length), "")
    end
    return [] if said.length == 0

    people.filter do |person|
      names = ScoreComment.handles(person)
      said.any? do |word|
        names.includes?(word)
      end
    end
  end

  # What an @ may name `person` with, in lower case.
  static def handles(person)
    email = person.email.to_s.downcase
    names = [email, email.split("@")[0]]
    name = person.name.to_s.trim.downcase
    names = names + [name.replace(" ", ""), name.split(" ")[0]] unless name.blank?
    names
  end
end
