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
      {"date": "2026-10-24", "entries": [
        {
          "area": "editor",
          "title": "Grace notes after a note (\\afterGrace)",
          "text": "A score that writes grace notes after a note, \\afterGrace d2 { e16 f }, is no longer refused "
          + "once the engraver that reads it is on the site: the grace notes are drawn small after the note, just "
          + "before the next one, and played in the last quarter of the note (or from the point written, "
          + "\\afterGrace 7/8 …). The editor keeps them through every edit, moves them with a transposition and "
          + "takes them away with their note. Until then such a score opens in its text, as before, and the Limits "
          + "page lists them only while the engraver still refuses them.",
          "app": true
        },
        {
          "area": "site",
          "title": "Export all your data, and change your email address",
          "text": "The account page has two new parts. Export all your data downloads a zip: each of your scores "
          + "as LilyPond, in a folder with every version kept of it (those in the trash too, in a trash folder), "
          + "who each is shared with and with which role, your account details (no password or secret), and the "
          + "list of scores others share with you; the comment threads on your scores, every comment you wrote "
          + "and your notifications. A very big account comes in a few zips. Change your email address asks "
          + "for your password (and a code, with two-step sign-in on) and sends a link to the new "
          + "address; the change is made only when it is followed, within a day. Your current address is told, "
          + "the scores shared with your old address follow you, and every other browser is signed out. The "
          + "playground now says that the MIDI view and the AI features are in the app.",
          "app": true
        },
        {
          "area": "site",
          "title": "A file chosen on the start screen while it loads is no longer lost",
          "text": "On the app's start screen, a file chosen with Import in the first moments after the page "
          + "appeared could be dropped without a word, and the score never opened. The page now listens for "
          + "the file from the start."
        },
        {
          "area": "site",
          "title": "Undo survives a reload, with no limit of 300 steps",
          "text": "The score editor now keeps its undo history in your browser, for each score: reload the page, "
          + "or open the score again another day, and Edit ▸ Undo still goes back through your changes, and "
          + "Redo forward. The old limit of 300 steps is gone: the history is kept as the differences "
          + "between one version and the next, a few megabytes per score, the oldest steps going first, for "
          + "the twenty scores you opened last. When someone else has changed the score meanwhile, while you "
          + "watched or while the page was closed, Undo takes back only your own changes and keeps theirs; "
          + "where you both changed the same bar it stops and says so, rather than undo their work. In a "
          + "private window, or with storage turned off, Undo works as before, for as long as the page is "
          + "open."
        },
        {
          "area": "site",
          "title": "Headers and footers, systems a page, piece, opus and copyright",
          "text": "File ▸ Score properties now sets the page around the music: a header and a footer, with "
          + "different ones on even pages if you like, each with words at the left, the centre and the right, "
          + "and {title}, {composer} or {page} filled in; how many systems go on a page; and the header's "
          + "piece, opus and copyright. They are written into the score's \\paper and \\header as LilyPond "
          + "reads them, and kept when you edit anything else; a LilyPond file that already sets "
          + "oddHeaderMarkup, evenFooterMarkup or systems-per-page opens with them. The PDF prints them, with "
          + "the copyright at the foot of the first page and the piece and opus over the first line, once the "
          + "engraver that reads them is on the site; until then the score opens and saves with them "
          + "unchanged. That engraver also makes the PDF's words text: the title, the lyrics and the marks "
          + "can be selected, copied and searched.",
          "app": true
        },
        {
          "area": "site",
          "title": "Comments on a bar, and notifications",
          "text": "Select some bars or a note and choose Edit › Comment on the selection (or the 💬 beside the "
          + "selection, or Ctrl+Alt+M): the comment is kept on those bars of that staff, with a speech bubble over "
          + "them in the score. The Comments panel lists the threads, open ones first; click one to select its bars, "
          + "reply, resolve it, show the resolved ones and reopen them, and change or delete your own messages. "
          + "Everyone the score is shared with may comment: those who may only read it, on its read page. "
          + "Comments reach the others in the editor as they are written. A comment keeps the bar numbers it "
          + "was made on. The bell at the top counts what is new: a score shared with you, a reply in a thread "
          + "you wrote in, a comment that names you with @, and changes others make to a score you share "
          + "(one notice an hour a score). Each also comes by e-mail, the changes gathered in a digest; the "
          + "account page turns each kind of e-mail on or off.",
          "app": true
        },
        {
          "area": "site",
          "title": "Grace notes played as their kind asks; more than fifteen staves each heard",
          "text": "Grace notes now sound the way they are written. An acciaccatura (the slashed one) or a "
          + "plain grace note is short, a thirty-second note or 60 milliseconds, whichever is shorter, and is "
          + "played just before the beat, so the note it leads to still falls on the beat. An appoggiatura "
          + "takes half of its note, or two thirds of a dotted one, and the note starts that much later. "
          + "Several grace notes share the time between them. A score with more than fifteen staves no longer "
          + "puts the last ones on one MIDI channel, where they played as one instrument: each staff keeps its "
          + "own instrument, volume, pan, velocities and curves. Staves with the same instrument and the same "
          + "mixer settings share a channel when they must, and past that the saved MIDI file uses a second "
          + "MIDI port, with the drums on their own channel. Play, Save as MIDI and Save the sound all do this."
        },
        {
          "area": "site",
          "title": "Two people edit one score: bars merge, and each sees where the other works",
          "text": "When someone else saves a score you are changing too, their changes are now merged with yours "
          + "bar by bar instead of asking you to choose one version: a bar, a staff's settings, the title or a "
          + "mixer setting changed by only one of you is kept, and the merge is saved for everyone, with a word "
          + "saying whose changes came in. Bars or staves added or taken away on one side are lined up with the other, "
          + "the velocities, automation curves and mixer settings moving with their bars and staves. "
          + "Only the bars both of you changed differently are asked about, by name (\"Bar 12, Piano right "
          + "hand\"): keep yours for those, take theirs, or save yours as a copy; nothing is ever lost, the "
          + "refused text stays in the score's history. Each person in the score has a colour: their selection "
          + "is drawn as a dashed band with their name over those bars of that staff, in the score and in the "
          + "MIDI view, and the \"With …\" names at the top show the same colours.",
          "app": true
        },
        {
          "area": "site",
          "title": "Automation curves, the stems and MP3",
          "text": "Under the MIDI view, below the velocities, a lane draws how a staff's modulation, expression, "
          + "volume, pan, sustain pedal or pitch bend moves while it plays: choose the staff and the curve, click "
          + "to add a point, drag one to move it, double-click to take it away. A recording keeps the wheel, the "
          + "pedal and the bend played on the MIDI keyboard, and a MIDI file opened keeps its own. The curves are "
          + "saved with the score, heard on Play, written into Save as MIDI (with the mixer's volume and pan at "
          + "the start of each track) and into Save the sound; a pedal written in the notes wins over the lane's. "
          + "File ▸ Save the stems saves a WAV for each staff, alone, in one zip, and Save the sound as MP3 a "
          + "compressed file (its encoder is fetched the first time, so that once needs the network).",
          "app": true
        },
        {
          "area": "site",
          "title": "Rit. and accel. are played; quantize, swing and humanize",
          "text": "A rit., rall. or accel. now slows down or speeds up when the score plays, whether it is a tempo "
          + "mark, words over a note or a dashed line: the speed glides to the next tempo given, and the playhead, "
          + "the metronome, the MIDI clock, the saved WAV and the saved MIDI file all follow it. Edit ▸ Quantize… "
          + "moves notes that sit between the beats onto a grid from quarters to thirty-seconds or triplets, all "
          + "the way or part of it, their starts only or their ends too. Play ▸ Swing and humanize… swings the "
          + "eighths or sixteenths as the music plays, without changing what is written, or writes them as "
          + "triplets or dotted pairs; humanize plays each note a little early or late and a little softer or "
          + "harder, the same way each time. The settings are saved with the score. The metronome can also click "
          + "eighths or sixteenths between the beats, and its accent on the first beat can be turned off."
        },
        {
          "area": "editor",
          "title": "A mixer, effects and each note's velocity",
          "text": "Play › Mixer opens a mixer: each staff has its volume, pan, mute and solo, and the master a "
          + "level meter. Each track and the master have a reverb (room, chamber, hall or cathedral), a "
          + "three-band EQ and a compressor, each with its own switch. Under the MIDI view, a strip shows how "
          + "hard each note is played: draw across it with the mouse, or choose notes and drag them, set a "
          + "fixed velocity, soften them or accent the beats. A recording keeps how hard each key was struck. "
          + "The mixer and the velocities are saved with the score, heard on Play, written into Save as MIDI "
          + "and mixed into Save the sound; Undo takes them back like any edit.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Drum grid, arpeggiator and chord track",
          "text": "Three new tools in the Edit menu write notes for you. Drum grid shows a drum staff's bar as "
          + "sixteen steps for the kick, snare, hi-hats, toms, crash and ride: click a step to strike it, again to "
          + "accent it, a third time to clear it, or use the mouse wheel. The bar loops while you build it, and "
          + "every change goes straight into the score. Arpeggiate breaks the selected chords into runs going up, "
          + "down, up and down, or at random, in eighths, sixteenths or triplets, over one to three octaves. "
          + "Chord track writes an accompaniment from your chord symbols on the staff you choose: block chords, "
          + "arpeggios, or a bass note and then the chord. Undo takes back any of them in one step.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "MIDI clock and MIDI learn",
          "text": "With Send MIDI clock ticked under Playback, the device in Sound to gets the editor's clock, with "
          + "Start, Stop and the place in the piece: GarageBand, Logic or a drum machine play in time, tempo changes "
          + "included. Follow a MIDI clock does the reverse, from your MIDI keyboard. Play ▸ MIDI learn gives Play, "
          + "Stop, Record, the speed, the volume and each staff's mute and solo to a knob, a pad or a key of your "
          + "controller; this browser remembers them. Pitch bend and aftertouch sound as you play. A setting for "
          + "the MIDI device's latency keeps recordings in time with it. Ableton Link is out of reach: a web page "
          + "cannot use the network the way Link does, so sync with Live through its MIDI clock.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "Real LilyPond files open",
          "text": "Files written for LilyPond itself now open instead of being refused. Layout settings such as "
          + "\\override, \\set, \\tweak or a \\layout block are skipped, and the editor names them when you open "
          + "the file and before your first edit leaves them out. \\stemUp, \\stemDown and \\autoBeamOff are "
          + "followed. Breath marks, caesuras, up-bows and down-bows, harmonics, \\espressivo, \\laissezVibrer, "
          + "\\repeatTie, cresc. and dim. in words and text spans like rit. are drawn and kept as you edit; "
          + "accidentals written cis! (always shown) and cis? (in brackets) too. New buttons add breath marks, "
          + "bowings and these accidentals. A file with several \\score blocks shows each as a movement on its "
          + "own line; edit those in the text, one at a time.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "A clef or a key can change in the middle of a bar",
          "text": "Write \\clef bass or \\key d \\major between two notes of a bar: the new clef is drawn small "
          + "before the note, the new key cancels the old one's sharps and flats, as LilyPond draws them. The "
          + "editor keeps these changes through every edit, the notes you type after a new key are spelled in "
          + "it, and a MusicXML file with a clef change inside a measure now opens.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "Parts gather their bars of rest",
          "text": "A printed part now shows a long rest as one bar with its count over it, as players expect, "
          + "instead of every empty bar one after another. In your own scores, \\compressMMRests gathers bars "
          + "of rest written R1*8, and the editor keeps it through every edit; \\compressFullBarRests and "
          + "skipBars work too.",
          "link": "playground"
        }
      ]},
      {"date": "2026-10-23", "entries": [
        {
          "area": "site",
          "title": "Daily limits on the AI, invitations and account emails",
          "text": "On the site's AI, each person can read 20 photos and ask the assistant 30 questions a day, and "
          + "the AI menu says how many questions are left today. With your own AI key you can do more (200 of "
          + "each). A request to the assistant can be up to 2,000 characters long. When the site's AI has done "
          + "its share for the day, it asks you to add your own key in Account. You can send 50 invitations a "
          + "day. Confirmation links and password resets can only be asked for a few times an hour, for each "
          + "address and from each connection. A shared score's PDF is reused by your browser until the score "
          + "changes.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Three and four voices on one staff",
          "text": "A staff can now hold up to four voices in the editor, instead of two: a score with a third or "
          + "fourth voice opens in the editor instead of as text only. Voices 1 and 3 have their stems up, 2 and "
          + "4 down. Pick a voice with Ctrl+Alt+1 to 4, from the toolbox or the Add menu, write in it, and take "
          + "it away again. Every voice plays, has its own track and colour in the MIDI view, and is copied and "
          + "pasted with its staff. MusicXML files bring their third and fourth voices in, and take them out.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Ottava lines, fingerings and phrasing slurs in the editor",
          "text": "A score with an 8va line, fingerings, string numbers or phrasing slurs now opens in the editor "
          + "instead of as text only, and keeps them through every edit. Add them from the tools or the Insert "
          + "menu: 8va and 8vb over the selected notes, fingers 1 to 5 (Alt+1 to 5), strings 1 to 6, and a "
          + "phrasing slur (Shift+S). Notes under an 8va still play at the pitch written, and MusicXML carries "
          + "all of them both ways.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "History says who saved each version; the library finds composers and comes in pages",
          "text": "The History page names who saved each version, and when a save meets someone else's, the editor "
          + "says who it was instead of \"another window\". A version can be played and copied into a new score. "
          + "Make a copy opens the copy. Deleting a score for good asks first, and the trash can be emptied in "
          + "one go. Scores shared with you say who shared them, and you can remove one from your list without "
          + "touching the owner's score. The search reads composers as well as titles, and the library shows "
          + "60 scores a page.",
          "link": "app",
          "app": true
        },
        {
          "area": "engine",
          "title": "One engraver everywhere: what the editor draws, the library, shared pages and PDFs draw too",
          "text": "The server now engraves with the browser's engraver (Soli 2.28.4): 64th notes, a tuplet inside "
          + "a tuplet, up to four voices on a staff and several verses of lyrics show on library cards, shared "
          + "pages and printed PDFs, not only in the editor. The Limits page lists what is still refused.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Jazz chord symbols transpose, and plainer messages",
          "text": "Chord symbols such as C7b9, Cm7b5, C(add9), C7#11, C6/9 or C7(b9,#11)/E are now read as chord "
          + "symbols, and move with the score when you transpose it: the root and the bass change, the rest "
          + "stays. The Start page offers minor keys, as the editor does. The account page says the AI key "
          + "serves the editor's assistant as well as photos, and the messages the editor shows when a change "
          + "cannot be made, a score cannot be saved or the AI cannot answer are written in plain words.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Your library, its history and its previews open faster",
          "text": "Your scores now open with a handful of database reads however many you have, without loading "
          + "every score's full text just to show its title, and the History page lists versions the same way. "
          + "A score already drawn, in the editor or on a library card, is not drawn again for three days. The "
          + "sounds kept for playing offline (about 40 MB) are stored once on your device instead of twice, "
          + "and an older version of the editor's files is let go when a new one arrives. The trash still keeps "
          + "a score 30 days.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Zoom with Ctrl + and −, and menus you can move through with the keyboard",
          "text": "The score now zooms with Ctrl and + or − (⌘ on a Mac) instead of the whole page; + and − "
          + "alone still sharpen and flatten the selected note. The keyboard shortcuts sheet (?) now lists "
          + "every key the editor answers to, including R to record, L and K, the voices and Insert the "
          + "copied bars. On a Mac, menus and tips say ⌘ and ⌥ instead of Ctrl and Alt. The menus open with "
          + "↓, move with the arrow keys, Home and End, and close with Escape. In File, the owner of a score "
          + "now sees Share…, and someone it is shared with copies a link that opens it for them.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Sharing says when the invitation email did not leave",
          "text": "When you share a score with someone and the invitation email cannot be sent, the notice now "
          + "says so and asks you to send them the link yourself, instead of saying only that they may now "
          + "open it. The share itself is made either way.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Printing prints the score, and a shared score comes in every file",
          "text": "Printing the editor or a shared score's page (Ctrl+P or Cmd+P) now prints the music alone: no "
          + "menus, toolbox, source or buttons, and a page never cuts a line of music in half. File, Print as "
          + "PDF says the paper the PDF is printed on, Letter or A3 when the score asks for it, not always A4. "
          + "Someone reading a shared score, even without an account, can now save it as MusicXML, as MIDI "
          + "with its repeats played, as LilyPond, or as one instrument's part, and every file is named after "
          + "the score's title instead of \"score\".",
          "link": "app"
        },
        {
          "area": "site",
          "title": "Your first edit keeps what you wrote",
          "text": "Editing a score in the editor no longer quietly drops what it did not understand. Invisible "
          + "rests stay invisible (no more rests appearing in a piano left hand), beams you drew stay, a "
          + "repeat played three times stays three times, a key in D dorian or A minor keeps its mode, bold "
          + "words stay bold, and a double bar line between sections stays. The few things the editor still "
          + "cannot keep, such as a double bar line in the middle of a bar, are named in a notice the first "
          + "time an edit rewrites the score, and Undo puts the text back as it was.",
          "link": "playground"
        },
        {
          "area": "site",
          "title": "Songs that start with a pickup can be edited",
          "text": "A piece that starts before the first full bar, as many songs, hymns and folk tunes do, no "
          + "longer leaves the note tools, Parts, Transpose and the MusicXML export unavailable: the short "
          + "first bar is edited, numbered, played and counted in like any other. A new \"Pickup\" choice in "
          + "New score and in Score properties sets its length, and a MusicXML file that starts with one opens "
          + "in the editor.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Open a MIDI file as a score",
          "text": "Import on the start screen and File › Open a file now take MIDI files (.mid). Each track "
          + "becomes a staff with its instrument, channel 10 becomes a drum kit, and the file's tempo, metre "
          + "and key are kept. The notes are fitted to a grid (in the editor, the Quantize setting) so they "
          + "read as written music. What a score cannot hold, such as pitch bends, the sustain pedal or a "
          + "change of tempo, is listed before the score is created.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "Saved MIDI files play the repeats",
          "text": "File › Save as MIDI now plays the music the way Play does: every repeat played twice, each "
          + "ending in its turn, and D.S., D.C. and the coda followed, instead of each bar once in the order it "
          + "is written. So do the MIDI buttons under the site's scores and the embeddable eui-score module. A "
          + "piece with no tempo plays at 100 beats a minute everywhere, as it does on Play.",
          "link": "app",
          "app": true
        },
        {
          "area": "site",
          "title": "The site's menu fits on a phone",
          "text": "On a narrow screen the site's navigation stopped at Limits: Changelog, Playground and the "
          + "Open the app button were off the edge, with nothing to say the bar scrolled. Now the button stays "
          + "at the top, beside the name, and the links wrap onto a second row below it, all in sight.",
          "link": "playground"
        },
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
