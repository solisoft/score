# What was recorded from the microphone onto one of a score's audio tracks
# (#390): a voice or an acoustic instrument, played along with the score.
# One take per track (`track`, from 1 to SCORE_TAKE_TRACKS): a new one
# replaces the last. Its sound is a WAV (mono, 16-bit, made in the editor:
# public/eui-score/takes.js) in SoliDB's blob store, read through this
# app only, with the score's rules: its owner and the people it is shared
# with to change it record and delete, those it is shared with to read
# listen.
#
# `offset` is where the take's first sample sits in the score's playback,
# in seconds as the score plays at its own speed (score-model.js
# `playback`), `rate` the speed it was played at while recording.
#
# The WAV's size is capped below the server's request body cap (8 MiB by
# default, SOLI_MAX_BODY_SIZE): at 24 kHz, 16-bit, mono, 48 000 bytes a
# second, about 2 min 46 s a take.
const SCORE_TAKE_MAX_BYTES = 8000000
const SCORE_TAKE_TRACKS = 4
const SCORE_TAKE_TYPES = [
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave"
]
const SCORE_TAKE_NAME_LENGTH = 60
# The blob collection the sounds are kept in (created by the migration).
const SCORE_TAKE_BLOBS = "score_take_audio"

class ScoreTake < Model
  uploader(
    "audio",
    {
      "content_types": SCORE_TAKE_TYPES,
      "max_size": SCORE_TAKE_MAX_BYTES,
      "collection": SCORE_TAKE_BLOBS
    }
  )
  validates("score_id", {"presence": true})
  validates("user_id", {"presence": true})

  # `score`'s takes, by track.
  static def of(score)
    ScoreTake.where({"score_id": score._key}).order("track", "asc").all
  end

  # What is wrong with the take's details as the editor sent them (track,
  # offset, rate, duration), or nil.
  static def details_error(fields)
    track = fields["track"].to_s.to_i
    return "Choose an audio track from 1 to #{SCORE_TAKE_TRACKS}." if track < 1 || track > SCORE_TAKE_TRACKS

    offset = fields["offset"].to_s.to_f
    return "The take must start within the score." if offset < -60.0 || offset > 36000.0

    rate = fields["rate"].to_s.to_f
    return "The take's speed must be from 0.25 to 4." if rate < 0.25 || rate > 4.0

    duration = fields["duration"].to_s.to_f
    return "The take is empty." if duration <= 0.0

    nil
  end

  # Whether `file` (as find_uploaded_file gives it) holds a WAV: its first
  # bytes "RIFF", whatever type it was declared as.
  static def wav?(file)
    file["data"].to_s.starts_with?("UklGR")
  end

  # `file` recorded by `user` onto `score`'s track `fields["track"]`, in
  # place of the take that was there: {"take"}, or {"error"} with nothing
  # written and the old take kept. (Runs in the server: the uploader's
  # `attach_audio` is the server's.)
  static def record(score, user, fields, file)
    problem = ScoreTake.details_error(fields)
    return {"error": problem} unless problem.nil?
    return {"error": "Send the take's sound, as a WAV file."} if file.nil?
    unless SCORE_TAKE_TYPES.includes?(file["content_type"].to_s) && ScoreTake.wav?(file)
      return {"error": "A take is a WAV file: that file is not one."}
    end

    if file["size"].to_s.to_i > SCORE_TAKE_MAX_BYTES
      return {"error": "A take may be #{SCORE_TAKE_MAX_BYTES / 1000000} MB at most: record a shorter one."}
    end

    track = fields["track"].to_s.to_i
    refused = ScoreTake.plan_refusal(score, user, track, file["size"].to_s.to_i)
    return refused unless refused.nil?

    take = ScoreTake.create({
      "score_id": score._key,
      "user_id": user._key,
      "track": track,
      "name": ScoreTake.name_for(fields["name"], track),
      "offset": fields["offset"].to_s.to_f,
      "rate": fields["rate"].to_s.to_f,
      "duration": fields["duration"].to_s.to_f,
      "size": file["size"].to_s.to_i,
      "created_at": DateTime.utc.to_unix
    })
    unless take.attach_audio(file)
      message = take._errors.length > 0 ? take._errors[0]["message"] : "The take could not be stored."
      take.delete
      return {"error": message}
    end

    ScoreTake.where(
      "doc.score_id == @score AND doc.track == @track AND doc._key != @key",
      {
        "score": score._key,
        "track": track,
        "key": take._key
      }
    ).all.each do |old|
      old.remove
    end
    {"take": take}
  end

  # What the plans (#393, Plan) refuse of a take of `bytes` by `user` onto
  # `score`'s `track`: {"error", "upgrade"} or nil. The tracks a score has
  # are its owner's plan's; the room the takes take, the recorder's own,
  # counting all they recorded on any score, less the take this one
  # replaces. Takes kept past a limit (on Pro once) still play. `open`:
  # whether payments are open (Plan.limits); nil asks Stripe's settings.
  static def plan_refusal(score, user, track, bytes, open = nil)
    owner = score.user_id == user._key ? user : User.find_by("_key", score.user_id)
    tracks = Plan.limits(owner, open)["take_tracks"]
    if track > tracks
      fewer = "On the Free plan a score has #{tracks} audio track: Pro records on #{SCORE_TAKE_TRACKS}."
      return {"error": fewer, "upgrade": true}
    end

    limits = Plan.limits(user, open)
    return nil if limits["take_bytes"].nil?

    total = ScoreTake.bytes_of(user) - ScoreTake.replaced_bytes(score, user, track) + bytes
    return nil if total <= limits["take_bytes"]

    room = Plan.size_text(limits["take_bytes"])
    unless limits["upgrade"]
      return {"error": SiteText.t("security_543.take_room_full", {"room": room})}
    end

    {
      "error": "Your takes would pass the #{room} the Free plan keeps: delete some, "
      + "or move to Pro for #{Plan.size_text(Plan.pro_limits["take_bytes"])}.",
      "upgrade": true
    }
  end

  # The bytes of every take `user` recorded.
  static def bytes_of(user)
    ScoreTake.total_size(ScoreTake.where({"user_id": user._key}))
  end

  # The bytes of `user`'s take on `score`'s `track`, which a new one replaces.
  static def replaced_bytes(score, user, track)
    ScoreTake.total_size(ScoreTake.where({
      "score_id": score._key,
      "track": track,
      "user_id": user._key
    }))
  end

  # The bytes of the takes `query` finds: 0 for none.
  static def total_size(query)
    row = query.aggregate({"total": ["sum", "size"]}).first
    return 0 if row.nil?

    (row["total"] ?? 0).to_s.to_i
  end

  # The track's name as typed, trimmed and cut short; "Audio <track>" when
  # there is none.
  static def name_for(name, track)
    text = name.to_s.trim
    return "Audio #{track}" if text.blank?

    text.substring(0, SCORE_TAKE_NAME_LENGTH)
  end

  # The take for the editor: what it needs to place and play it.
  def shown
    {
      "id": @_key,
      "track": @track,
      "name": @name,
      "offset": @offset,
      "rate": @rate,
      "duration": @duration,
      "size": @size,
      "created_at": @created_at
    }
  end

  # The take gone, its sound with it.
  def remove
    @detach_audio unless @audio_blob_id.nil?
    @delete
  end

  # The response that streams its sound to `req`, with Range (an audio
  # element seeks).
  def audio_response(req)
    solidb_blob_response(ScoreTake.blobs, SCORE_TAKE_BLOBS, @audio_blob_id, req, {
      "Content-Type": "audio/wav",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300"
    })
  end

  # Its sound's bytes (the export's): a byte array.
  def audio_bytes
    data = Base64.decode(solidb_get_blob(ScoreTake.blobs, SCORE_TAKE_BLOBS, @audio_blob_id))
    data.is_a?("string") ? Encoding.encode(data, "utf-8") : data
  end

  # The SoliDB client the uploader stores the sounds with.
  static def blobs
    __soli_resolve_solidb_client()
  end

  static def delete_all_for(score)
    ScoreTake.of(score).each do |take|
      take.remove
    end
  end
end
