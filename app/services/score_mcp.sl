# The MCP server (#460): Score's scores to a client of the Model Context
# Protocol — Claude Code, or any other — over JSON-RPC 2.0, one message a
# request, no session (McpController, POST /mcp). The client acts as the
# account its personal access token is (AccessToken): it lists, reads,
# checks, creates and changes that account's scores, and has a photo or a
# scan of a score read into one with the account's own AI settings, as
# "From a photo" does.
#
# `handle(user, message)` answers one message: a JSON-RPC response, or nil
# for a notification. No request in here: a spec calls it directly.
const MCP_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05"
]
const MCP_SERVER_VERSION = "1.0.0"
# Characters of a source a tool answers with, at most: a client's context is not a dump.
const MCP_SOURCE_LIMIT = 200000

const MCP_INSTRUCTIONS = """
Score keeps scores as LilyPond source, engraved by its own engraver (eui-score), which reads most of LilyPond:
\new Staff, \relative, \time, \key, \clef, chords <c e g>, \repeat volta, lyrics with \addlyrics, chord
symbols as markup over notes (c1^"Am7"), \header { title = "…" }.

To write a score: draft the LilyPond, call check_source until the engraver accepts it, then create_score (or
update_score with the revision get_score gave). The answer gives the score's address in the editor.

To transcribe a photo or a scan of a score: either read the picture yourself and write the LilyPond, checking
it with check_source; or, when the account has its AI key set, send the picture to transcribe_image (base64)
and follow it with get_transcription, which can save it as a new score.

To transcribe a photo with no wrong note and no missing marking, get the prompt transcribe_photo: it measures the
staff lines and the note heads on the photo with two small Python scripts, reads the markings in a pass of their
own, and ends on a proof page to check against the original.
"""
# The skill the prompt transcribe_photo carries (#466): served by the site
# from public/, so a client downloads its scripts, and installed as is in
# Claude Code (.claude/skills/transcribe-score links to it).
const MCP_SKILL_DIR = "public/skills/transcribe-score"
const MCP_SKILL_FILES = [
  "SKILL.md",
  "scripts/staff.py",
  "scripts/proof.py"
]

class ScoreMcp
  # The answer to `message` (a JSON-RPC request or notification, as parsed)
  # from `user`'s client; nil for a notification, which has none.
  static def handle(user, message)
    return ScoreMcp.error(nil, -32600, "A JSON-RPC message is an object.") unless type(message) == "hash"

    id = message["id"]
    method = message["method"].to_s
    # A notification: nothing to answer (notifications/initialized, cancelled…).
    return nil if id.nil? && message.has_key("method")
    return ScoreMcp.error(id, -32600, "Not a JSON-RPC 2.0 request.") unless message["jsonrpc"] == "2.0"

    params = type(message["params"]) == "hash" ? message["params"] : {}
    return ScoreMcp.result(id, ScoreMcp.initialized(params)) if method == "initialize"
    return ScoreMcp.result(id, {}) if method == "ping"
    return ScoreMcp.result(id, {"tools": ScoreMcp.tools}) if method == "tools/list"
    return ScoreMcp.call(user, id, params) if method == "tools/call"
    return ScoreMcp.result(id, {"prompts": ScoreMcp.prompts}) if method == "prompts/list"
    return ScoreMcp.prompt(id, params) if method == "prompts/get"

    ScoreMcp.error(id, -32601, "No method called #{method}.")
  end

  static def result(id, body)
    {
      "jsonrpc": "2.0",
      "id": id,
      "result": body
    }
  end

  static def error(id, code, message)
    {
      "jsonrpc": "2.0",
      "id": id,
      "error": {"code": code, "message": message}
    }
  end

  # The answer to initialize: the version the client asks for when this
  # server speaks it, else its latest.
  static def initialized(params)
    asked = params["protocolVersion"].to_s
    {
      "protocolVersion": MCP_PROTOCOL_VERSIONS.includes?(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
      "capabilities": {"tools": {"listChanged": false}, "prompts": {"listChanged": false}},
      "serverInfo": {
        "name": "score",
        "title": "Score",
        "version": MCP_SERVER_VERSION
      },
      "instructions": MCP_INSTRUCTIONS.trim + "\nAs a Claude Code skill, installed once: "
      + ScoreMcp.skill_install_command(auth_base_url())
    }
  end

  # The prompts, as prompts/list describes them (#466).
  static def prompts
    [{
      "name": "transcribe_photo",
      "title": "Transcribe a photo of a score",
      "description": "Turn a photo or a scan of sheet music into a Score score with measured pitches and every "
      + "marking: staff lines and note heads measured on the photo, markings read apart, a proof page at the end.",
      "arguments": [{
        "name": "photo",
        "description": "The photo's file, or how to find it",
        "required": false
      }]
    }]
  end

  # prompts/get: the method of the skill transcribe-score, preceded by how to
  # fetch its scripts; a JSON-RPC error for a prompt that does not exist.
  static def prompt(id, params)
    name = params["name"].to_s
    return ScoreMcp.error(id, -32602, "No prompt called #{name}.") unless name == "transcribe_photo"

    arguments = type(params["arguments"]) == "hash" ? params["arguments"] : {}
    text = ScoreMcp.transcription_method(arguments["photo"].to_s)
    message = {"role": "user", "content": {
      "type": "text",
      "text": text
    }}
    summary = "Transcribe a photo of a score into Score, with measured pitches and every marking."
    ScoreMcp.result(
      id,
      {"description": summary, "messages": [message]}
    )
  end

  # What the prompt says: the photo, where the scripts come from, then the
  # skill's own text without its front matter.
  static def transcription_method(photo)
    base = auth_base_url()
    which = photo.blank? ? "the photo I give you" : "the photo #{photo}"
    fetch = MCP_SKILL_FILES.filter do |file|
      file.starts_with?("scripts/")
    end.map do |file|
      "curl -fsSL #{base}/skills/transcribe-score/#{file} -o \"$SKILL/#{file}\""
    end
    "Transcribe #{which} into a Score score, following the method below.\n\n"
    + "Its scripts are not on this machine yet: fetch them into a folder of your scratchpad, never into a "
    + "project, and use that folder as <skill dir>.\n\n```bash\nSKILL=<scratchpad>/transcribe-score\n"
    + "mkdir -p \"$SKILL/scripts\"\n"
    + fetch.join("\n")
    + "\n```\n\n"
    + ScoreMcp.skill_body
  end

  # SKILL.md as served, without its front matter (name, description).
  static def skill_body
    ScoreMcp.without_front_matter(slurp(MCP_SKILL_DIR + "/SKILL.md"))
  end

  # `text` after its "---" front matter block; all of it when it has none.
  static def without_front_matter(text)
    return text unless text.starts_with?("---\n")

    rest = text.substring(4, text.length)
    finish = rest.index_of("\n---\n")
    return text if finish < 0

    rest.substring(finish + 5, rest.length).trim
  end

  # One shell line that installs the skill in Claude Code, for every project.
  static def skill_install_command(base)
    files = MCP_SKILL_FILES.join(" ")
    "d=~/.claude/skills/transcribe-score; mkdir -p $d/scripts && for f in #{files}; do curl -fsSL "
    + "#{base}/skills/transcribe-score/$f -o $d/$f; done"
  end

  # The tools, as tools/list describes them.
  static def tools
    [
      {
        "name": "list_scores",
        "title": "List my scores",
        "description": "The account's scores, the latest changed first, 24 a page: id, title, composer, "
        + "when changed, address in the editor. `query` matches the title or the composer.",
        "inputSchema": {"type": "object", "properties": {
          "query": {"type": "string", "description": "Words of the title or the composer"},
          "page": {
            "type": "integer",
            "minimum": 1,
            "description": "Page, from 1"
          }
        }},
        "annotations": {"readOnlyHint": true}
      },
      {
        "name": "get_score",
        "title": "Read a score",
        "description": "A score's LilyPond source, with its title, its revision (give it back to "
        + "update_score) and whether this account may change it.",
        "inputSchema": {
          "type": "object",
          "properties": {"id": {
            "type": "string",
            "description": "The score's id, from list_scores"
          }},
          "required": ["id"]
        },
        "annotations": {"readOnlyHint": true}
      },
      {
        "name": "check_source",
        "title": "Check LilyPond with the engraver",
        "description": "Whether Score's engraver reads this LilyPond, and if not, why and where (the "
        + "character it stopped at). Nothing is saved. Call it until it answers ok, before "
        + "create_score or update_score.",
        "inputSchema": {
          "type": "object",
          "properties": {"source": {
            "type": "string",
            "description": "LilyPond source"
          }},
          "required": ["source"]
        },
        "annotations": {"readOnlyHint": true}
      },
      {
        "name": "create_score",
        "title": "Create a score",
        "description": "A new score in the account, from LilyPond the engraver reads (check it with "
        + "check_source first). `title` is set when the source has no \\header title. "
        + "Answers its id and its address in the editor.",
        "inputSchema": {"type": "object", "properties": {
          "source": {"type": "string", "description": "LilyPond source; empty for a blank score"},
          "title": {"type": "string", "description": "The title, when the source has none"}
        }},
        "annotations": {"readOnlyHint": false, "destructiveHint": false}
      },
      {
        "name": "update_score",
        "title": "Change a score",
        "description": "A score's whole LilyPond source replaced. Give the `revision` get_score "
        + "answered: when someone changed the score since, nothing is written and the "
        + "answer says so (read it again). Without a revision, it writes over the score as "
        + "it stands. The score's version history keeps the one before.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "id": {"type": "string"},
            "source": {"type": "string", "description": "The new LilyPond source"},
            "revision": {"type": "integer", "description": "The revision get_score answered"}
          },
          "required": ["id", "source"]
        },
        "annotations": {"readOnlyHint": false, "destructiveHint": true}
      },
      {
        "name": "transcribe_image",
        "title": "Transcribe a photo of a score",
        "description": "A photo or a scan of a score (JPEG, PNG or WebP, as base64, 5 MB at most) read "
        + "into LilyPond by the account's own AI model, as the site's \"From a photo\" "
        + "does. It takes a minute or so: this answers a reading_id at once; follow it with "
        + "get_transcription. Needs the account's AI key (Account › AI). For a picture you "
        + "can see yourself, you may instead write the LilyPond and check it with "
        + "check_source.",
        "inputSchema": {
          "type": "object",
          "properties": {"image_base64": {
            "type": "string",
            "description": "The picture's bytes as base64 (a data: URL is accepted too)"
          }},
          "required": ["image_base64"]
        },
        "annotations": {"readOnlyHint": false, "destructiveHint": false}
      },
      {
        "name": "get_transcription",
        "title": "Follow a transcription",
        "description": "Where a transcription started by transcribe_image stands: still reading (with "
        + "the LilyPond so far), failed (why), or done (its LilyPond). With `create_score` "
        + "true, a finished one is saved as a new score.",
        "inputSchema": {
          "type": "object",
          "properties": {"reading_id": {"type": "string"}, "create_score": {
            "type": "boolean",
            "description": "Save it as a new score once done"
          }},
          "required": ["reading_id"]
        },
        "annotations": {"readOnlyHint": false, "destructiveHint": false}
      }
    ]
  end

  # tools/call: the tool's answer, or a JSON-RPC error for a tool that does not exist.
  static def call(user, id, params)
    name = params["name"].to_s
    args = type(params["arguments"]) == "hash" ? params["arguments"] : {}
    answer = nil
    answer = ScoreMcp.list_scores(user, args) if name == "list_scores"
    answer = ScoreMcp.get_score(user, args) if name == "get_score"
    answer = ScoreMcp.check_source(args) if name == "check_source"
    answer = ScoreMcp.create_score(user, args) if name == "create_score"
    answer = ScoreMcp.update_score(user, args) if name == "update_score"
    answer = ScoreMcp.transcribe_image(user, args) if name == "transcribe_image"
    answer = ScoreMcp.get_transcription(user, args) if name == "get_transcription"
    return ScoreMcp.error(id, -32602, "No tool called #{name}.") if answer.nil?

    ScoreMcp.result(id, answer)
  end

  # A tool's answer: `text` for the model, `data` as structured content.
  static def done(text, data = nil)
    out = {"content": [{"type": "text", "text": text}], "isError": false}
    out["structuredContent"] = data unless data.nil?
    out
  end

  # A tool's refusal, said so the model can act on it.
  static def refused(text)
    {"content": [{"type": "text", "text": text}], "isError": true}
  end

  # A score's address in the editor.
  static def address(score)
    base = auth_base_url()
    base + "/app/scores/" + score._key
  end

  # Why the engraver does not read `source`, or nil when it does.
  static def engraver_refusal(source)
    laid = eui_score_layout(source, 100, {}) rescue {"error": "the engraver could not read it"}
    return laid["error"].to_s if laid.has_key("error")

    nil
  end

  static def list_scores(user, args)
    page = Score.library_page(user, args["query"].to_s, "updated", args["page"])
    rows = page["scores"].map do |score|
      {
        "id": score._key,
        "title": score.title,
        "composer": score.composer.to_s,
        "updated_at": score.updated_at,
        "url": ScoreMcp.address(score)
      }
    end
    if rows.length == 0
      return ScoreMcp.done(
        "No score matches.",
        {"scores": [], "more": false}
      )
    end

    lines = rows.map do |row|
      by = row["composer"].blank? ? "" : " (" + row["composer"] + ")"
      "- " + row["title"] + by + " — id " + row["id"]
    end
    more = page["more"] ? "\nMore on the next page." : ""
    listed = lines.join("\n")
    ScoreMcp.done(
      listed + more,
      {"scores": rows, "more": page["more"]}
    )
  end

  # The score of id `id` `user` may read, or nil.
  static def readable(user, id)
    score = Score.find_by("_key", id.to_s)
    return nil if score.nil? || score.trashed? || score.access_of(user).nil?

    score
  end

  static def get_score(user, args)
    score = ScoreMcp.readable(user, args["id"])
    return ScoreMcp.refused("No score of this account has the id #{args["id"]}: list_scores gives them.") if score.nil?

    source = score.source.to_s
    cut = source.length > MCP_SOURCE_LIMIT
    data = {
      "id": score._key,
      "title": score.title,
      "revision": score.revision,
      "writable": score.writable_by?(user),
      "url": ScoreMcp.address(score),
      "source": cut ? source.substring(0, MCP_SOURCE_LIMIT) : source,
      "truncated": cut
    }
    ScoreMcp.done("#{score.title} (revision #{score.revision}):\n\n#{data["source"]}", data)
  end

  static def check_source(args)
    source = args["source"].to_s
    return ScoreMcp.refused("The source is empty.") if source.trim.blank?

    refusal = ScoreMcp.engraver_refusal(source) ?? Score.refusal_of(source)
    return ScoreMcp.refused("The engraver does not read it: #{refusal}") unless refusal.nil?

    ScoreMcp.done("ok: the engraver reads it.", {"ok": true})
  end

  static def create_score(user, args)
    title = args["title"].to_s.trim
    source = args["source"].to_s
    source = Score.blank_source(title) if source.trim.blank?
    source = Score.with_title(source, title) if Score.title_in(source).nil? && !title.blank?
    refusal = ScoreMcp.engraver_refusal(source) ?? Score.refusal_of(source)
    return ScoreMcp.refused("Not created: #{refusal}") unless refusal.nil?

    score = Score.start(user, source)
    return ScoreMcp.refused("Not created: the score could not be saved.") unless score._errors.nil?

    data = {
      "id": score._key,
      "title": score.title,
      "revision": score.revision,
      "url": ScoreMcp.address(score)
    }
    ScoreMcp.done("Created “#{score.title}”: #{data["url"]}", data)
  end

  static def update_score(user, args)
    score = ScoreMcp.readable(user, args["id"])
    return ScoreMcp.refused("No score of this account has the id #{args["id"]}.") if score.nil?
    return ScoreMcp.refused("“#{score.title}” is read-only for this account.") unless score.writable_by?(user)

    source = args["source"].to_s
    refusal = ScoreMcp.engraver_refusal(source)
    return ScoreMcp.refused("Not saved: the engraver does not read it: #{refusal}") unless refusal.nil?

    revision = args.has_key("revision") ? args["revision"].to_s.to_i : score.revision.to_s.to_i
    saved = score.save_from_editor(source, revision, user)
    if saved["status"] == 409
      return ScoreMcp.refused("Not saved: the score changed since revision #{revision}. Read it again with get_score.")
    end

    return ScoreMcp.refused("Not saved: #{saved["body"]["error"]}") unless saved["status"] == 200

    # Whoever has it open hears of it, as of a save from the editor.
    ScoreRoom.tell_saved(score, "mcp") rescue nil
    UserNotification.changed(score, user) rescue nil
    data = {
      "id": score._key,
      "title": saved["body"]["title"],
      "revision": saved["body"]["revision"],
      "url": ScoreMcp.address(score)
    }
    ScoreMcp.done("Saved “#{data["title"]}”, revision #{data["revision"]}: #{data["url"]}", data)
  end

  static def transcribe_image(user, args)
    allowed = AiClient.refusal(user)
    return ScoreMcp.refused("#{AiClient.refusal_text(allowed)} (Account › AI on the site.)") unless allowed.nil?

    data = args["image_base64"].to_s.trim
    # A data: URL's bytes are after its comma.
    data = data.split(",").last.to_s if data.starts_with?("data:")
    return ScoreMcp.refused("Send the picture as base64 in image_base64.") if data.blank?
    return ScoreMcp.refused("The picture is too large: 5 MB at most.") if data.length > SCORE_READER_BYTES

    picture = ScoreReader.picture(data)
    return ScoreMcp.refused("That is not a picture this reads: send a JPEG, PNG or WebP.") if picture.nil?

    refusal = ScoreReading.refusal(user)
    return ScoreMcp.refused("All of today's photos are read: try again tomorrow.") if refusal == "used_up"
    return ScoreMcp.refused(AiClient.refusal_text(refusal)) unless refusal.nil?

    reading = ScoreReading.start(user, picture)
    return ScoreMcp.refused(reading.to_s) if type(reading) == "string"

    ScoreMcp.done(
      "Reading started (id #{reading._key}). It takes a minute or so: call get_transcription with this reading_id.",
      {"reading_id": reading._key, "state": reading.state}
    )
  end

  static def get_transcription(user, args)
    reading = ScoreReading.find_by("_key", args["reading_id"].to_s)
    if reading.nil? || !reading.owned_by?(user)
      return ScoreMcp.refused("No reading of this account has the id #{args["reading_id"]}.")
    end

    reading.expire_if_silent
    if reading.state == "reading"
      news = reading.news
      return ScoreMcp.done(
        "Still reading (#{news["phase"]}, #{news["seconds"]} s): ask again in a little while.",
        {
          "state": "reading",
          "phase": news["phase"],
          "seconds": news["seconds"],
          "draft": news["draft"]
        }
      )
    end
    return ScoreMcp.refused("The reading failed: #{reading.error}") if reading.state == "failed"

    source = reading.source.to_s
    data = {"state": "done", "source": source}
    unless args["create_score"] == true
      return ScoreMcp.done("Read:\n\n#{source}", data)
    end

    score = Score.start(user, source)
    return ScoreMcp.refused("Read, but not saved: the score could not be saved.") unless score._errors.nil?

    data["id"] = score._key
    data["url"] = ScoreMcp.address(score)
    ScoreMcp.done("Read and saved as “#{score.title}”: #{data["url"]}\n\n#{source}", data)
  end
end
