# What changed, newest first: on the site and in its score editor, and in the
# engraver (eui-score) that draws every score. One entry is one change a
# reader can see; `area` is "site" or "engine", `link` the name of a page
# of the site that shows it (see PagesController#changelog); "app": true
# for what is shown only once the app (/app) is open on the server;
# `sample` names a score of scores/changelog/ that shows it.
#
# Add an entry at the top of its day when a change ships; a new day goes
# first.
class Changelog
  static def days
    [
      {"date": "2026-10-23", "entries": [
        {
          "area": "engine",
          "title": "Pages cut evenly, when you ask for it",
          "text": "Tick “Spread the lines evenly over the pages” in the score's properties (or write page-breaking "
          + "= #ly:optimal-breaking in \\paper): as few pages, each about as full, no line left alone on the last.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Long scores stay quick in the editor",
          "text": "On a 200-bar quartet, selecting a note or following the playback redraws in 4 ms instead of 90, "
          + "and an edit takes a fifth less time.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "MusicXML in and out",
          "text": "Open a score from MuseScore, Sibelius, Finale or Dorico (.musicxml, .mxl) in the editor or the "
          + "app's Import, and save yours as MusicXML for them. In your browser; what the editor does not write "
          + "is named.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Each engraver change shows a score",
          "text": "Here, under a change to the engraver, a short score drawn by today's engraver shows it, with "
          + "its LilyPond to read or copy."
        },
        {
          "area": "site",
          "title": "The score and its text, linked",
          "text": "A note clicked on the score is marked in the LilyPond, and the caret put on a note in the text "
          + "selects it on the score.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "Scores a screen reader can name",
          "text": "Every drawn score carries its title and a sentence: its composer, staves and bars, each "
          + "staff's key, metre, notes and rests."
        },
        {
          "area": "engine",
          "title": "Four voices on a staff, and notes that cross to the other staff",
          "sample": "four-voices",
          "text": "A chorale on one staff, soprano to bass, each voice with its stems; and a piano's notes sent "
          + "with \\change Staff to the other hand's staff, drawn there and played in their own."
        },
        {
          "area": "engine",
          "title": "64ths, 128ths, a tuplet in a tuplet, metres added up, modes",
          "sample": "values-and-metres",
          "text": "Notes down to the 128th, a triplet inside a quintuplet with both brackets, \\time 2+3/8 and "
          + "13/8, and \\key d \\dorian with the signature of its notes."
        },
        {
          "area": "site",
          "title": "The new values and metres in the editor",
          "text": "64 and 128 among the durations; 5/8, 7/8, 2+3/8, 13/8 and more among the metres.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "The paper a score asks for",
          "text": "\\paper's size and margins and the staff size are the PDF's: letter, A3, A5, landscape, 16 pt…"
        },
        {
          "area": "site",
          "title": "Paper, staff size, and lines and pages ended by hand",
          "text": "Score properties set the paper and the staff size; Edit ends the line or the page after the "
          + "selected bar.",
          "link": "playground"
        }
      ]},
      {"date": "2026-10-22", "entries": [
        {
          "area": "site",
          "title": "Parts, and transposing instruments as they are read",
          "text": "File ▸ Print a part: one instrument alone, as a PDF, its name on top. View ▸ Written pitch "
          + "shows a "
          + "clarinet in B♭, a horn in F or a saxophone as its player reads it; the score sounds and is written "
          + "at concert pitch.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "A flat or a sharp in a staff's name",
          "sample": "flat-in-a-name",
          "text": "\"Clarinet in B♭\" prints its flat: the score's words have ♭, ♯ and ♮, drawn like the "
          + "accidentals on the staff."
        },
        {
          "area": "site",
          "title": "The app: your scores, kept in your account",
          "text": "Sign up, start a score from a template or a file, and it saves itself as you write: a library "
          + "with previews, search and a trash, the history of every score, and a way back to any version.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Share a score: by link, in public, or with the people you choose",
          "text": "A read page to play and print it, a code to show it on any site, and invitations to read it or "
          + "to change it with you.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "An app to install, that works without a network",
          "text": "Install it from your browser; the scores you opened open offline, and what you write there is "
          + "saved once the network is back.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Menus in the editor, and a palette over the note",
          "text": "File, Edit, View, Insert and Play, each command with its key; over the selected note, its "
          + "accidentals, dot, tie and articulations at hand; the score's properties in a dialog of their own.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "Several verses of lyrics on a staff",
          "sample": "verses",
          "text": "A song's second and third verses are each set on the same notes, a line under the one before, "
          + "as LilyPond sets them."
        },
        {
          "area": "site",
          "title": "A Verse menu for the lyrics",
          "text": "Choose verse 1 to 6 next to the Lyrics button, and the words you type go on that line.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "A note too long for its bar is cut into tied notes",
          "sample": "tied-over",
          "text": "A half note written where only a quarter is left is no longer refused: it is cut at the bar "
          + "line into two tied notes, as LilyPond cuts it. In the browser for now; the server follows."
        },
        {
          "area": "engine",
          "title": "The sustain pedal, D.S., D.C. and Fine",
          "sample": "pedal-and-jumps",
          "text": "Ped. and its release mark are drawn under the staff and held. D.S. al Coda, D.C. al Fine and "
          + "Fine are written as LilyPond 2.24 writes them and set against their bar line."
        },
        {
          "area": "site",
          "title": "Rehearsal letters, segno, coda and jumps in the editor",
          "text": "The toolbox writes rehearsal letters, segno and coda signs, D.S. and D.C. jumps, the pedal, "
          + "staff text and expression text. Play follows the jumps.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "A duration that overflows the bar is tied over",
          "text": "Choosing a duration longer than what is left of the bar writes tied notes across it instead "
          + "of refusing.",
          "link": "playground"
        }
      ]},
      {"date": "2026-10-21", "entries": [
        {
          "area": "site",
          "title": "New… starts a score from a template",
          "text": "Piano, voice and piano, choir, string quartet, band, lead sheet or drums, with the title, key, "
          + "metre and tempo chosen at the start.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Save as WAV, PNG or SVG",
          "text": "What Play sounds is saved as an audio file, and the score as a picture to share.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "A MIDI keyboard writes the notes",
          "text": "Plug in a keyboard: a key played writes its note at the cursor, keys held together a chord.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Bars inserted or removed anywhere, and a shared clipboard",
          "text": "Put a bar before the selection or take the selected bars away; copy and paste go through the "
          + "system clipboard, so music moves between the editor and other programs.",
          "link": "playground"
        }
      ]},
      {"date": "2026-10-20", "entries": [
        {
          "area": "engine",
          "title": "A treble clef is drawn whole",
          "text": "On a score with nothing over the first staff, the top of the clef was cut off. The picture "
          + "now starts as high as its ink."
        },
        {
          "area": "engine",
          "title": "A dotted eighth's dot can be seen",
          "sample": "dotted-eighth",
          "text": "The dot stood against the flag and nearly vanished; it now stands past it."
        },
        {
          "area": "engine",
          "title": "A tempo mark stands clear of grace notes",
          "sample": "tempo-over-grace",
          "text": "A tempo mark, and anything else over the staff, rises over the grace notes under it instead of "
          + "running through them."
        },
        {
          "area": "site",
          "title": "Grace notes, arpeggios, glissandi, tremolos and ornaments",
          "text": "All written from the editor's toolbox, and all heard when the score plays.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "The notes light up as they are heard",
          "text": "The highlight waits for fermatas and grace notes, and keeps time with the sound."
        },
        {
          "area": "site",
          "title": "A tied note changes pitch with its tie",
          "text": "Changing the pitch of a tied note changes every note tied to it, so a tie never joins two "
          + "different pitches."
        }
      ]},
      {"date": "2026-10-19", "entries": [
        {
          "area": "engine",
          "title": "Endings, rests and dynamics keep their distance",
          "sample": "endings",
          "text": "An ending's number clears the high notes under it, a rest shared by two voices clears the "
          + "other voice, a volta bracket stands over the lyrics, and neighbouring dynamics stand apart."
        },
        {
          "area": "site",
          "title": "Play with real instruments",
          "text": "Scores play with the MuseScore_General sounds, each staff in its instrument, repeats played "
          + "out — on every page of the site as in the editor. Drum staves play a real drum kit."
        },
        {
          "area": "site",
          "title": "Playback controls",
          "text": "Pause, loop the selected bars, speed from 50 to 150 %, metronome and count-in, mute or solo a "
          + "staff, and send the playback to a MIDI device such as GarageBand.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Transpose, share by link, hear what you write",
          "text": "Transpose the selection or the whole score with its keys and chord symbols; Share copies a "
          + "link that holds the score itself; notes sound as they are written or moved.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "An editor for phones, tablets and screen readers",
          "text": "On a small screen the score comes first and the tools open in a sheet; toolbox sections fold; "
          + "? shows the keyboard shortcuts; every sign-only button is read aloud by name.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "The playground becomes a score editor",
          "text": "A menu bar, a toolbox and the score: repeats and endings by drag and drop, two voices on a "
          + "staff, key, metre, tempo and clef changes anywhere, an instrument menu for each staff, and a "
          + "refused source that names its line.",
          "link": "playground"
        }
      ]},
      {"date": "2026-10-18", "entries": [{
        "area": "engine",
        "title": "eui 0.11: LilyPond as people write it",
        "sample": "lilypond-as-written",
        "text": "Variables, voices, lyrics, \\transpose, \\partial, grace notes, more clefs, chord names, drum "
        + "staves and tablature are read and drawn as LilyPond draws them.",
        "link": "limits"
      }]}
    ]
  end

  # The days as a reader sees them: the app's entries only where the app is
  # open, and no day left empty.
  static def shown(app_open)
    days = Changelog.days.map do |day|
      day.merge({"entries": day["entries"].filter(&{ |entry|
        app_open || entry["app"] != true
      })})
    end
    days.filter do |day|
      day["entries"].length > 0
    end
  end

  # The LilyPond of a sample, scores/changelog/<name>.ly, or nil.
  static def sample(name)
    return nil if name.blank? || !Regex.matches("^[a-z0-9-]+$", name)

    path = "scores/changelog/#{name}.ly"
    File.exists(path) ? File.read(path) : nil
  end

  # The label a reader sees for an entry's area.
  static def area_label(area)
    area == "engine" ? "Engraver" : "Site & editor"
  end
end
