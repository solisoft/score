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
          "area": "site",
          "title": "Saving never loses what you typed",
          "text": "When two windows save the same score at once, only one of them is written and the other "
          + "asks you what to do: keep yours, load theirs, or save yours as a copy. Until you choose, your "
          + "changes stay kept in the browser. Signed out while editing, the editor says so, with a link to "
          + "sign in again, instead of trying to save over and over.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Nothing left behind: the trash, a deleted account, signing out",
          "text": "A score deleted for good, by you or when the trash empties after 30 days, now takes its history, "
          + "its shares and the AI's suggestions with it, every night, even if you never open your library. "
          + "Deleting your account also deletes your photo readings and what you asked the AI. A photo reading "
          + "or an AI request cut off by a restart now says it failed instead of waiting forever. And signing "
          + "out clears the scores this browser kept for offline use, and any unsent text, so the next person "
          + "on a shared computer cannot open them.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Unshared means unshared, in the live editor too",
          "text": "When you stop sharing a score with someone, or move it to the trash, an editor they still "
          + "have open no longer receives your changes as you make them: it is taken out of the score's live "
          + "room at your next save, and cannot come back in.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "New and Open make a new score, the open one left as it is",
          "text": "In the app's editor, File › New, Open a file, Open an example and Open a photo now make a new "
          + "score in your library and open it, instead of writing over the score you had open.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Notes dragged and resized on the MIDI view's keyboard",
          "text": "On the Keyboard layout, drag a note up or down to change its pitch, along to move it, and its "
          + "right edge to make it longer or shorter, on the Quantize grid; the score follows, ties and all, "
          + "and Ctrl+Z puts it back.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "A loop of its own, and a click to let a selection go",
          "text": "Drag on the MIDI view's bar numbers to set the bars that play over and over (or Play › Loop "
          + "the selected bars); what you select no longer loops by itself. A click on an empty bar lets a "
          + "selection go, and a double click on a track's name shows it alone on the keyboard.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "The editor's commands fit a phone",
          "text": "On a phone, Undo, MIDI, Play, Rec and the zoom have rows of their own under the menus, wrapping "
          + "where the screen is narrow: nothing is cut off any more.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Hear your own virtual instruments as you play",
          "text": "With a MIDI device chosen in Sound to (EastWest, Logic or GarageBand, through the Mac's IAC "
          + "bus), the keys you play while recording and the notes you write go to it too, each on its "
          + "staff's channel, as hard as you struck them.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Recording: triplets, drums, dynamics and loops",
          "text": "Quantize to eighth or sixteenth triplets, record a drum part from a pad (each key its drum), "
          + "let how hard you strike the keys write the dynamics, and record into a loop pass after pass, "
          + "each adding its notes. ● Rec and the grid now sit next to Play.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Record live from a MIDI keyboard",
          "text": "Press R (or ● Rec): after a bar of count-in, play along with the other staves and the "
          + "metronome; what you played is written into the staff, fitted to the grid you chose, chords "
          + "and ties included. One Undo takes the whole take back.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "The MIDI view: every track at a glance",
          "text": "View › MIDI view shows the score as it sounds: a strip per track, or a piano roll. Select "
          + "bars across tracks, copy them, paste them over other bars, or insert them as new bars to "
          + "repeat a verse — Edit › Insert the copied bars, also in the score.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "An AI assistant in the editor",
          "text": "The AI menu adds chord symbols to a melody, harmonizes it, suggests improvements or does what "
          + "you ask; it explains what it did beside the score it proposes, and nothing changes until you "
          + "apply it.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Your own AI key: Claude, GPT, Gemini, Mistral, DeepSeek, Kimi",
          "text": "Bring a key from the AI provider of your choice on your account page, with the model you "
          + "want: photos and the assistant use it, kept encrypted and never shown again.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "A score from a photo",
          "text": "Start a score from a photo or scan of printed or handwritten music, or open one in the editor "
          + "(File › Open a photo…): an AI reads it, the engraver checks it, and you see it beside the photo "
          + "before keeping it.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Two-step sign-in, if you want it",
          "text": "Your account can ask for a code from an authenticator app on your phone as well as your password: "
          + "set it up from a QR code, keep ten backup codes, turn it off with your password and a code.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Your email address, confirmed",
          "text": "A new account confirms its address from the link we email before it signs in; the link can be "
          + "sent again from the sign-in page or your account, and a password reset confirms it too.",
          "link": "app",
          "app": true
        },
        {
          "area": "engine",
          "title": "Cue notes and an ossia",
          "text": "\\cueDuring shows, small and silent over a player's rests, what another part plays meanwhile; an "
          + "ossia stands on a staff over the bars it rewrites. \\tiny and \\small set notes smaller.",
          "sample": "cues-and-ossia"
        },
        {
          "area": "engine",
          "title": "Guitar chord diagrams",
          "text": "\\new FretBoards draws each chord's shape on the guitar, found as a guitarist plays it, and "
          + "\\fret-diagram draws one written by hand over its note.",
          "sample": "chord-diagrams"
        },
        {
          "area": "engine",
          "title": "Figured bass",
          "text": "\\new FiguredBass \\figuremode { <6 4> <7 5- 3!> }: the figures stacked under the bass, each on "
          + "its note, with their sharps, flats and naturals.",
          "sample": "figured-bass"
        },
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
