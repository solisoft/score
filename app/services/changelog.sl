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
      {"date": "2026-11-01", "entries": [
        {
          "area": "site",
          "title": "An account harder to guess into",
          "text": "A new password or address now closes every app connection made before. Wrong passwords lock the "
          + "network that tried them, and too many from anywhere lock the account for new browsers while yours, "
          + "already signed in, still get in. The reset and sign-up pages no longer tell whether an address has "
          + "an account, and the account pages ask for your password a few times only.",
          "app": true
        },
        {
          "area": "site",
          "title": "Pages that run only their own scripts",
          "text": "Every page now tells the browser exactly which of its scripts may run, so a script slipped into a "
          + "page is refused. The administration asks for a two-step code in the same session and keeps a log of "
          + "every change it makes.",
          "app": true
        },
        {
          "area": "site",
          "title": "Push, recordings and exports kept in bounds",
          "text": "Push notifications go only to the browsers' own push services, and the test message is sent in the "
          + "background, a few an hour. Audio takes keep at most 2 GB an account while Pro is not on sale. The data "
          + "export splits a score's versions across its zips, each version named by when it was kept.",
          "app": true
        },
        {
          "area": "site",
          "title": "Sharing that stops when you say so",
          "text": "Readers of a shared link now show as « A reader », never by their address. A new link, a score "
          + "made private, someone uninvited or a score put in the trash now closes at once the live view of those "
          + "who may no longer read it, and a score in the trash can no longer be changed by its collaborators.",
          "app": true
        },
        {
          "area": "site",
          "title": "Connecting an app is safer",
          "text": "The page that lets an app such as Claude reach your scores now names where the answer goes, not "
          + "just the name the app gives itself, and it approves only the request it showed. A connection whose "
          + "renewal is replayed is closed, and the connection endpoints are rate-limited.",
          "app": true
        },
        {
          "area": "editor",
          "title": "A score cannot hide a script any more",
          "text": "A score's hidden settings line (note velocities, controller curves) could carry code that ran when "
          + "someone opened the MIDI view. They are now read as numbers only, and what is drawn is escaped. A synth "
          + "preset or reverb room named after a JavaScript property no longer breaks the panels.",
          "app": true
        },
        {
          "area": "engine",
          "title": "Instrument and composer apart on a phone",
          "text": "On a narrow page, a score's instrument (centred) and its composer (on the right) ran into each "
          + "other: Saxo Ténor Sib over Johann Strauss. When they would touch, the instrument now takes its own "
          + "line and the composer goes below it, still on the right. A wide page keeps them on one line."
        },
        {
          "area": "editor",
          "title": "The editor in French",
          "text": "With the app in French, the score editor is too: its menus, tools, dialogs, the mixer, recording, "
          + "the drum grid, riffs and accompaniments, and every message it gives. Instrument names are shown in "
          + "French; the score itself keeps what it prints. Key names read Do majeur / la mineur.",
          "app": true
        },
        {
          "area": "site",
          "title": "The app in the language just chosen",
          "text": "Switched to French on the site, Open the app could still show it in English until a reload: the "
          + "copy fetched ahead in English was reused. Each language now gets its own copy.",
          "app": true
        },
        {
          "area": "site",
          "title": "The app in French",
          "text": "Coming from the site in French, the app is in French too: the Start page, your scores, sharing, "
          + "the trash and versions, photo imports, notifications and the account. Account › Language switches it, "
          + "and the account remembers the choice on another browser. The editor itself is still in English.",
          "app": true
        },
        {
          "area": "site",
          "title": "The AI key in use, on one line",
          "text": "In the account, the sentence that names your AI provider, its model and the end of your key read "
          + "one piece per line. It reads as a sentence again.",
          "app": true
        },
        {
          "area": "editor",
          "title": "A hairpin over the whole selection",
          "text": "A crescendo or diminuendo set on selected notes now runs to the last of them. A hairpin that "
          + "started or ended between them is taken away: before, its end stopped the new one there, at the "
          + "barline when it was a bar's first note.",
          "app": true
        },
        {
          "area": "site",
          "title": "A photo transcription checked against the photo, marks included",
          "text": "The skill transcribe_photo (Score in Claude) now asks for the printed original rather than a "
          + "copy, counts the dynamics, hairpins, slurs and accents of each line of the photo before writing, and "
          + "checks the score against those counts and against the note heads it measures: three new scripts "
          + "find a run written from the wrong note or a missing hairpin, and set notes in doubt side by side.",
          "link": "claude"
        },
        {
          "area": "site",
          "title": "The account page, set in order",
          "text": "Your account opens on a summary (plan, two-step sign-in, AI key, apps connected) and groups its "
          + "settings: sign-in and security, notifications, plan, AI key, Claude and apps, your data, reached from a "
          + "side menu, tabs on a phone. Each form opens from its Change link; deleting the account stands apart.",
          "app": true
        },
        {
          "area": "editor",
          "title": "A tempo in words takes a number",
          "text": "A score whose tempo was written in words alone (Presto, rit.) refused a number typed in Tempo, "
          + "saying \\tempo wants a note value. The number now counts in quarters, as LilyPond does: Presto, "
          + "4 = 120.",
          "app": true
        },
        {
          "area": "site",
          "title": "The site in French",
          "text": "Every page of the site, the guide and the sign-in pages now read in French at /fr: a French "
          + "browser goes there on its first visit, and FR / EN in the header switches, remembered. The e-mails "
          + "of an account are sent in the language it was made in. The app itself is still in English.",
          "link": "home"
        },
        {
          "area": "engine",
          "title": "A PDF a page shorter when a little smaller fits",
          "text": "When the last page of a PDF would hold a line or two, the score is now set a little smaller, down "
          + "to 85 % at most, so that everything fits on a page fewer; Tonnerre et Éclairs comes back to one page at "
          + "18.5 pt. A score that sets its own staff size (set-global-staff-size) keeps it, and the screen does not "
          + "change."
        }
      ]},
      {"date": "2026-10-31", "entries": [
        {
          "area": "editor",
          "title": "Double-dotted notes",
          "text": "The dot (button • or the . key) now goes round: a dot, two dots, none. A quarter note with two "
          + "dots lasts seven sixteenths, and the next note gives way as it does for one dot; the button shows •• "
          + "while two are set, in note input as on a selected note.",
          "app": true
        },
        {
          "area": "editor",
          "title": "A slur over the notes or under them, as you choose",
          "text": "Under Slur, in Slur side, Above and Below draw a slur on that side of the notes, or turn one "
          + "over; pressed again, it goes back to where the stems leave room. It is written ^( or _( in the "
          + "LilyPond, read back as such. Hairpins and dynamics under the staff now go under a slur drawn below "
          + "the notes, where they used to cross it.",
          "app": true
        },
        {
          "area": "site",
          "title": "Claude transcribes a photo of a score with measured notes",
          "text": "Ask Claude for the prompt transcribe_photo, or install it once as a skill in Claude Code (Score in "
          + "Claude gives the command): it measures the staff lines and the note heads on the photo instead of "
          + "guessing them, reads hairpins, fp, slurs and accents in a pass of their own, and ends on a proof page "
          + "with each line of the photo above what it wrote.",
          "link": "claude"
        },
        {
          "area": "site",
          "title": "Score in Claude: how to connect it",
          "text": "A new page of the guide, Score in Claude, says how to connect Claude Code, claude.ai, Claude "
          + "Desktop or another MCP app to your scores, each command or address ready to copy; what to ask, what "
          + "Claude can do, how to disconnect it. The account page now gives the one command to run, and keeps "
          + "tokens for the apps that cannot sign in.",
          "app": true
        },
        {
          "area": "editor",
          "title": "Photo imports: find them again, and watch the score being written",
          "text": "A photo's reading goes on when you leave its page, and Photo imports, from Start, lists them all: "
          + "being read, read, or not. Each opens on a page of its own where the score grows as the AI writes it, "
          + "bar after bar, engraved beside the photo; then Open as a score, or Read it again. Start says when a "
          + "photo is being read. Photos are kept a week, imports a month.",
          "app": true
        },
        {
          "area": "editor",
          "title": "A photo's reading no longer waits for ever",
          "text": "Reading a photo with a model that reasons before it writes (Kimi, DeepSeek, Claude…), the page "
          + "now shows how far its reasoning has gone, not a still \"reading\". A reading stops after 10 minutes and "
          + "says so, suggesting a quicker model; and one that was interrupted is said so within a few minutes, "
          + "where the page used to wait.",
          "app": true
        },
        {
          "area": "site",
          "title": "Connect Claude Code to Score by signing in",
          "text": "Adding Score to Claude Code, or to another MCP client, no longer needs a token pasted: "
          + "claude mcp add --transport http score https://score.solisoft.net/mcp, and the client opens Score in "
          + "the browser, where you sign in and allow it. Each connection is listed in Account › Access tokens, "
          + "to disconnect it there.",
          "app": true
        },
        {
          "area": "site",
          "title": "Score is an MCP server: write scores from Claude Code, transcribe photos",
          "text": "Claude Code, or any other MCP client, can now work on your scores: list and read them, write "
          + "LilyPond and check it with the engraver, create a score or change one, and transcribe a photo or a "
          + "scan of a score into a new one. Make a personal access token in Account › Access tokens: the page "
          + "gives the claude mcp add command to paste. A token acts as your account; revoke it when you no "
          + "longer use it.",
          "app": true
        },
        {
          "area": "editor",
          "title": "Piano patterns, and a piano played by a pianist",
          "text": "Edit ▸ Accompaniment has a Piano plays menu: the style's part, or one of fifteen patterns that "
          + "follow the chords: boogie-woogie, the boogie's left-hand shapes, rock'n'roll triplets, stride, gospel, "
          + "jazz comping, an Alberti bass, ballad arpeggios, a waltz, 6/8 broken chords, pop eighths, a funk "
          + "clavinet, house stabs, a montuno and a reggae bubble. Each note has a pianist's force too: the bass "
          + "marked, the chord lighter off the beat, its top note sung. In the library, each pattern and each "
          + "style's piano is a loop of one bar and of two."
        },
        {
          "area": "editor",
          "title": "Guitar riffs, and a guitar played by a guitarist",
          "text": "Edit ▸ Accompaniment has a Guitar plays menu: the style's strumming, or one of eighteen riffs "
          + "that follow the chords, low on the neck: a blues boogie, rock'n'roll eighths, a rock drive in power "
          + "chords, punk, a metal gallop and chug, a funk line, disco octaves, surf tremolo, a country walk, pop "
          + "and 6/8 picking. The guitar's strokes have a guitarist's force too, the downstroke on the beat over "
          + "the upstroke, its low strings first, with a little unevenness. In the library, each riff and each "
          + "style's guitar is a loop of one bar and of two."
        },
        {
          "area": "site",
          "title": "Sections play in a loop",
          "text": "A section of the library plays round and round until Stop, with no gap between turns: from its "
          + "card, its page, and Sections ▸ Listen in the editor. The bar under Play counts one turn, marked ↻; "
          + "a drum loop never sounds quite the same twice."
        },
        {
          "area": "editor",
          "title": "Drums played as a drummer plays them",
          "text": "The grooves, the accompaniments' drums and the library's drum sections no longer strike every "
          + "note alike, on the grid: the downbeat and the backbeat are strong, the hi-hat's off-beats lighter, "
          + "funk and soul have their ghost notes on the snare, a break builds to the next bar, a crash opens each "
          + "phrase after the first and the third bar opens its hi-hat; each stroke a little early or late, never "
          + "twice the same. Each note's force shows in the MIDI view's velocity strip, to change as you like."
        },
        {
          "area": "site",
          "title": "Drum loops of one and two bars, and breaks",
          "text": "In the library of sections, each of the fifty drum grooves is now a loop of one bar, a loop of two "
          + "bars (the second varied) and its break, one bar: a hundred and fifty sections, in place of the four "
          + "bars of beat and break."
        },
        {
          "area": "editor",
          "title": "On a phone, a finger scrolls the score",
          "text": "In the editor on a touch screen, swiping over the score scrolls it, up and down and sideways, "
          + "where it did nothing. A tap still selects a note or a bar, and the note's palette moves it; a swipe "
          + "never selects anything. With a mouse, nothing changes."
        },
        {
          "area": "editor",
          "title": "The swing swings",
          "text": "The swing, jazz ballad and shuffle accompaniments, and the swing, brushes and jazz waltz grooves, "
          + "now swing at a triplet feel, the off-beat eighth late, where they were nearly straight; the brushes "
          + "play the ride's ding, ding-a. A section shared from a score that swings keeps its swing, the library's "
          + "Play and its page play it swung, and adding it to a score that does not swing yet makes that score swing."
        },
        {
          "area": "editor",
          "title": "Sections, a click away in the editor",
          "text": "The editor's toolbar has a Sections button: the library opens over the score, each section with "
          + "its first bars engraved, Listen and Add. Add puts it after the last bar, each instrument on its own "
          + "staff, with no bar to select first; with a bar selected, it goes before that bar or over it. A piano "
          + "comes with its brace and its name."
        },
        {
          "area": "editor",
          "title": "Add a section of the library to your score",
          "text": "A section's page, in the library at /sections, now has Add it to your score: choose one of your "
          + "scores, or a new one that starts with it. Your score opens in the editor with the section after its "
          + "last bar, each instrument on its own staff, one added when the score has none, and the metre changed "
          + "there when the section's is another. One Undo takes it back.",
          "app": true
        },
        {
          "area": "editor",
          "title": "A bass line of its own for each style",
          "text": "The pop ballad, folk, country and jazz ballad accompaniments played the same bass. Each has its "
          + "own now: an alternating root and fifth for folk, a boom on one and three walking up to the next chord "
          + "for country, a pickup into the next bar for the ballad, a walk into the next chord for jazz. Their "
          + "sections in the library are played again, their ratings and comments kept."
        },
        {
          "area": "site",
          "title": "Play a section from the library's list",
          "text": "Each card of the library of sections, at /sections, now has its Play button: hear the bars "
          + "without opening the section's page, with the time played under it. Another card's Play stops the "
          + "first."
        },
        {
          "area": "site",
          "title": "A hundred and ten sections in the library to start with",
          "text": "The library of sections, at /sections, is no longer empty: each of the fifteen accompaniment "
          + "styles is there on the guitar, the piano, the bass and for the whole band, and each of the fifty "
          + "drum grooves as three bars of its beat and its break, all signed Score. Listen to them, rate them, "
          + "and put them in a score from the editor (Edit ▸ Library of sections)."
        },
        {
          "area": "site",
          "title": "Sign-up kept clear of robots, with no puzzle to solve",
          "text": "Creating an account now asks the browser for a moment of work, done while you type, which costs "
          + "a robot making accounts by the thousand far more than it costs you; one place can make ten accounts "
          + "an hour at most, and a throwaway address is refused, since it could not receive a new password "
          + "later. No captcha: the page needs JavaScript, and says so when it is off."
        },
        {
          "area": "editor",
          "title": "An accompaniment in one click: guitar, piano, bass and drums",
          "text": "Edit ▸ Accompaniment plays a song's chord symbols in fifteen styles, from pop, rock and folk "
          + "to bossa nova, reggae, swing, a waltz and a 6/8 ballad: a guitar strumming its chord shapes, with "
          + "the diagrams over them, a piano in both hands, a bass and the drums, each on a staff of its own, "
          + "added when the score has none. Choose the instruments, Listen to four bars, then Write: one Undo "
          + "takes it all back. Written again in another style, it goes on the same staves."
        },
        {
          "area": "editor",
          "title": "Fifty drum grooves, each with its break",
          "text": "The drum grid has a Groove menu: fifty grooves, rock, funk, house, samba, songo, reggae, "
          + "swing, a jazz waltz, a 12/8 blues and more, each with a basic bar and a break. Put either in the "
          + "bar, change a step or two, or write the groove in every selected bar, a break at the end of each "
          + "four. The accompaniments' drums play them too."
        },
        {
          "area": "site",
          "title": "EUI Score is now called Score",
          "text": "The site and the app have a shorter name: Score. Its pages, its e-mails, the installed app and the "
          + "picture shown when a link is shared now say so. The engraver that draws every score keeps its own name, "
          + "eui-score: it is EUI's."
        }
      ]},
      {"date": "2026-10-30", "entries": [
        {
          "area": "editor",
          "title": "Share your bars, and rate and comment on everyone's",
          "text": "Bars can now be shared with everyone. In the editor, select some bars on one track or several, "
          + "then Edit ▸ Share the selected bars: give them a name, an instrument, a style and a few words, "
          + "and they are in the library of sections, at /sections, engraved and ready to play. Anyone can "
          + "listen; with an account, people rate them from one to five stars and comment on them, and Edit ▸"
          + " Library of sections finds what others shared, plays it, and puts it in the score before the "
          + "selected bar or over it. Each section and comment can be reported to the admins, and its author "
          + "can take it away.",
          "app": true
        },
        {
          "area": "editor",
          "title": "A barre in a chord diagram's grid",
          "text": "Opened large, a chord diagram now takes a barre: drag along a fret from one string to another, "
          + "or Shift+click a second string at the same fret. The barre is drawn across the strings it holds "
          + "down, which take its fret; a click on it takes it away. A finger put on afterwards keeps it."
        },
        {
          "area": "editor",
          "title": "On a phone, a note's buttons are all in sight",
          "text": "A tap on a note shows its buttons (↑ ↓ ♭ ♯…) beside it. On a phone they "
          + "started at the note and ran past the edge of the score, so for a note on the right "
          + "most of them could not be seen. They now stay inside the score, and go on two rows "
          + "when the screen is too narrow for one."
        },
        {
          "area": "editor",
          "title": "Guitar chord shapes for every chord symbol",
          "text": "Insert ▸ Guitar diagrams for the chord symbols puts a chord diagram over the first note of each "
          + "chord symbol, in the shape a guitarist plays it: the open chord where there is one (C, G, Am7, "
          + "D7…), else a barre up the neck in the E or A shape (F, Bm, B♭7, C♯m7), with its barre drawn. A "
          + "slash chord's bass goes on the lowest string that reaches it (C/E, D/F♯). Insert ▸ Guitar chord "
          + "diagram starts from the shape of the chord sounding over the note. The chord symbols are also "
          + "read further: 11, 13, #11, b13, alt and omit3."
        },
        {
          "area": "editor",
          "title": "A chord diagram's grid stays open while it is clicked, and \"dolce\" opens again",
          "text": "Opened large, a chord diagram closed at the first click on one of its frets, which was written "
          + "as it stood: a click now puts the finger there and the grid stays, for the next one. A note's "
          + "palette (↑ ↓ ♭ ♯…) no longer covers the words written under or over the note: a double click on "
          + "a \"dolce\" under a selected note opened nothing and moved the note up a step; it now opens the "
          + "words."
        }
      ]},
      {"date": "2026-10-29", "entries": [
        {
          "area": "editor",
          "title": "A photo's reading followed live, however long the AI thinks",
          "text": "Some AI models think for ten minutes before they write a score down, and the reading was cut "
          + "off after five. The answer is now read as it comes: the page shows how long the AI has been at it, "
          + "whether it is still reading the photo or already writing, and the LilyPond as it is written. A "
          + "reading only stops when the AI has said nothing for three minutes."
        },
        {
          "area": "editor",
          "title": "A click on a chord diagram opens it large, to click on",
          "text": "A guitar chord diagram drawn on the score is small for a precise click: one click now opens it "
          + "large, its six strings and five frets in cells big enough to aim at. A click on a fret puts a finger "
          + "there, again takes it away; over the nut a string is open or not played. A shape up the neck shows "
          + "its first fret's number. Enter writes it, Escape leaves the diagram as it was."
        },
        {
          "area": "editor",
          "title": "Double-click a chord diagram, an expression or a syllable to change it",
          "text": "A double click on words drawn on the score — a guitar chord diagram, an expression such as "
          + "dolce, a staff text, a chord symbol, a syllable — opens them where they stand, with what they say: "
          + "Enter keeps the change, Escape leaves them as they were, an emptied box takes them away. A chord "
          + "diagram also shows its six strings: a click on a fret puts a finger there, over the nut a string "
          + "is open or not played."
        },
        {
          "area": "editor",
          "title": "Open a photo reads the repeats, the segno and the coda too",
          "text": "Reading a photo now asks the AI for the signs of form and ornament as well: repeats with their "
          + "first and second endings, segno, coda, D.S. and D.C., Fine, To Coda, sections, tuplets, grace notes, "
          + "trills and mordents, 8va lines, the pedal, fingering, harmonics and two voices on a staff, each written "
          + "the way the engraver reads it, and the note names in the form it reads."
        },
        {
          "area": "engine",
          "title": "LilyPond 2.24's marks, sections, endings and harmonics open",
          "text": "A file that wrote \\segnoMark 1, a segno or a coda over a note, \\section, \\sectionLabel, "
          + "\\textMark, \\volta in an \\alternative or \\harmonic could not be opened at all. Each is now drawn as "
          + "LilyPond draws it: the sign, a double bar line with the section's name in bold, the words over the bar "
          + "line, endings labelled \"1., 2.\", diamond heads. They stay when the score is edited."
        }
      ]},
      {"date": "2026-10-28", "entries": [
        {
          "area": "engine",
          "title": "A long title fits a phone's page",
          "text": "On a phone, a title wider than the engraved page started off its left edge and was cut. It now "
          + "breaks between words onto a second line, and a single word too long for the page is set a little "
          + "smaller. On a wider page the title is set as before."
        },
        {
          "area": "editor",
          "title": "Note input: Insert › A staff, and the marks, act where you are",
          "text": "In note input, Insert › A staff added the staff without a word and left the writing on the first "
          + "one, so it seemed to do nothing. It now says which staff was added, and note input goes on in it. And "
          + "once ← and → have moved the cursor, a mark, a slur or a chord symbol goes on the note at the cursor, "
          + "not on a note selected before."
        },
        {
          "area": "site",
          "title": "The editor's header fits a narrower screen",
          "text": "On a laptop or a tablet, the header over a score ran its buttons into the app's links and lost the "
          + "score's title. Below 1180 pixels, Keep a version, History, Comments and Share now go under a Score ▾ "
          + "menu, and the title keeps its place. On a phone the header takes two rows, and the actions are there "
          + "too, where they used to be hidden."
        },
        {
          "area": "editor",
          "title": "← and → in note input sound the note you move to",
          "text": "In note input, moving the cursor with ← and → sounded the note selected before, the same one "
          + "each time, instead of the note under the cursor. It now sounds the note the cursor comes to, with its "
          + "staff's instrument, as writing one does."
        },
        {
          "area": "editor",
          "title": "File › Open a photo… looks like the menu's other items",
          "text": "In the app, with no AI key yet, File › Open a photo… is a link to the account page, and it was "
          + "drawn as one: red, underlined and out of line with the items around it. It now looks like the other "
          + "items of the menu, its note on the right."
        },
        {
          "area": "editor",
          "title": "R for a rest, I for note input",
          "text": "In note input, R now writes a rest, as 0 does; out of note input R still records from the MIDI "
          + "keyboard. I turns note input on and off, as N does, and Esc still goes back to selecting."
        },
        {
          "area": "editor",
          "title": "Chords with the mouse",
          "text": "Add to the chord, in the toolbox's Notes, now works with the mouse too. Ticked, in note input, a "
          + "click on the staff over a note adds that pitch to it, and the letter buttons write a chord's first "
          + "note and then add to it. Alt+click adds to the chord without ticking the box; Shift+letter, on the "
          + "keyboard, works as before."
        },
        {
          "area": "editor",
          "title": "The toolbox's buttons grouped by what they do",
          "text": "Each button of the toolbox now sits with its kind, and each row has its name: the respelling "
          + "(C♯ ↔ D♭) with the accidentals, crescendo and diminuendo with the dynamics, the stems, beams and "
          + "cross-staff notes in Stems & beams, fingers, strings, bowings and the pedal in Fingering & technique, "
          + "the rehearsal marks and the jumps with the repeats. The six note values and the dot, and the seven "
          + "letters and the rest, each fit on one line. The Insert menu follows the same groups, and Edit has the "
          + "respelling beside Transpose."
        },
        {
          "area": "editor",
          "title": "The LilyPond source beside the score",
          "text": "View › Source beside the score puts the LilyPond text in a column on the right of a wide "
          + "screen, as tall as the window, instead of under the score: the score and its text in sight together, "
          + "each following the other as before. The choice is kept in this browser; on a narrower window the "
          + "text stays under the score."
        }
      ]},
      {"date": "2026-10-27", "entries": [{
        "area": "editor",
        "title": "The editor puts the score and the writing tools first",
        "text": "The toolbox now opens on what you write with: Mode and Duration stay in sight as it scrolls, "
        + "Notes and Pitch come next, and the other sections start folded (a section you open or fold stays as "
        + "you left it). Speed, the practice loop, the metronome and the MIDI settings moved to a Playback "
        + "panel, opened by the arrow beside Play; the arrow beside Rec holds how a recording is written. What "
        + "is selected now shows in one bar under the score, and note input draws a blue band along the top of "
        + "the sheet. In the playground, the two notices over the editor became one line you can close."
      }]},
      {"date": "2026-10-26", "entries": [
        {
          "area": "editor",
          "title": "Swap voices 1 and 2",
          "sample": "swapped-voices",
          "text": "Two voices written crossed (the high notes in voice 2, the low in voice 1) draw their stems "
          + "into each other. Edit › Swap voices 1 and 2, or the button under the voices in the toolbox, exchanges "
          + "what the two voices hold in the selected bars: the high notes go to voice 1, stems up, the low to "
          + "voice 2, stems down. One undo puts them back."
        },
        {
          "area": "site",
          "title": "The editor opens faster on a slow connection",
          "text": "The score editor is some forty files, and each asked for the next only once it had arrived: on a "
          + "slow or distant connection that was dozens of round trips one after another before the score "
          + "showed. The editor's page now names them all at once, with the engraver, and the browser fetches "
          + "them together."
        },
        {
          "area": "editor",
          "title": "Chord symbols stay in sight while you edit them",
          "text": "The small palette over a selected note (arrows, accidentals, marks) now opens under the note "
          + "when chord symbols stand over the staff, and steps away while a chord, a lyric or a text is typed, so "
          + "it no longer hides them. Under a line of chord names, a chord written on the note itself (^\"Am7\") "
          + "is the one Ctrl+K shows and edits; once typed, it moves onto the line, drawn like the other chord "
          + "names."
        }
      ]},
      {"date": "2026-10-25", "entries": [
        {
          "area": "engine",
          "title": "Pages spaced and beams sloped as LilyPond sets them",
          "sample": "beams-and-spacing",
          "text": "A crowded page now squeezes its systems toward their least distance before one moves to the next "
          + "page, and a page with room spreads them, as LilyPond's springs do; ink of one staff never runs into "
          + "the next. The \\paper and \\layout spacings (system-system, top-system, last-bottom, staff-staff) are "
          + "read. Beams take the slope and the place on the staff lines that LilyPond's quanting gives them, "
          + "across a piano's staves too, and a \\crossStaff eighth keeps its flag at the joined stem's end."
        },
        {
          "area": "engine",
          "title": "Smaller staves, a metre changed mid-bar, polymetre, voices inside a voice",
          "sample": "metre-and-small-staves",
          "text": "Ossia and cue staves are drawn smaller (\\magnifyStaff, StaffSymbol.staff-space with fontSize). "
          + "A \\time may come in the middle of a bar and a \\partial later in a piece; a \\time written in "
          + "one staff applies to the whole score. With \\enablePolymeter, staves keep their own metres when "
          + "their bars last as long (\\scaleDurations, timeSignatureFraction). Voices may open inside a voice. "
          + "The accidentals of a note moved to the other staff are counted on that staff, and \\partCombine "
          + "plays the part a solo or a unison leaves off the staff."
        },
        {
          "area": "editor",
          "title": "The metre wherever it is written, edited on the score",
          "sample": "metre-and-small-staves",
          "text": "Pieces that change metre in the middle of a bar (\\time after the first notes), that write a "
          + "\\partial after the first bar, that write a \\time in one staff only, or that set a metre beside "
          + "another with bars as long (\\set Staff.timeSignatureFraction with \\scaleDurations, or "
          + "\\enablePolymeter) now open in the score editor instead of as text only, and so do voices inside "
          + "a voice. Notes typed, bars put in or taken away, a new metre, copy and paste, transposing and the "
          + "MIDI view keep the bars as they were, the \\time and the \\partial written back where they were. "
          + "On a staff whose notes are scaled, pitches and marks are edited on the score and lengths in the "
          + "text, as the editor says. Staves drawn smaller (\\magnifyStaff) keep their size through every edit."
        },
        {
          "area": "editor",
          "title": "\\partCombine and \\autoChange edited on the score",
          "sample": "autochange",
          "text": "Two parts set on one staff by \\partCombine are now edited on the score: each part is a voice of "
          + "the staff, part I and part II, and everything that works on a voice works on each part — notes "
          + "typed, deleted, copied and pasted, moved in the MIDI view, transposed, bars put in or taken away, a "
          + "new metre. The staff is still drawn as LilyPond draws it, with a2, Solo and chords: a click on a note "
          + "drawn once for both parts selects part I's, and Ctrl+Alt+2 goes to part II's. The text keeps "
          + "\\partCombine, and the variables it names (\\partCombine \\hornI \\hornII), their music "
          + "written as edited. A piano staff made by \\autoChange is one voice: a click on a note on either "
          + "staff selects it, and an edit rewrites the music inside \\autoChange, each note going to the "
          + "staff its pitch sends it to. Both work used inside a variable too. A \\tweak written on an "
          + "articulation, words, a dynamic, a fingering or a slur (c4-\\tweak color #red ->) now stays with "
          + "it through every edit instead of being dropped."
        },
        {
          "area": "engine",
          "title": "The piano's two staves crossed: beams, slurs and ties from one hand to the other",
          "sample": "cross-staff",
          "text": "Notes moved to the other staff with \\change Staff now share one beam drawn between the staves, "
          + "upper stems down to it and lower stems up; a voice may cross in the middle of a beam. Slurs, phrasing "
          + "slurs and ties go from a note on one staff to a note on the other. \\autoChange shares one voice "
          + "between the hands at middle C, with rests where the other hand plays; \\showStaffSwitch draws the "
          + "line that follows a voice across, and \\crossStaff joins a stem to the other staff's note."
        },
        {
          "area": "engine",
          "title": "Lines and pages laid out as LilyPond lays them out",
          "sample": "lines-and-pages",
          "text": "Line breaks are chosen over the whole piece, so the last line is no longer a lonely bar or two, and "
          + "a last page of one system takes one from the page before. \\noBreak and \\noPageBreak are followed. "
          + "The \\paper settings are read: line-width, indent and short-indent, ragged-right, ragged-last and "
          + "ragged-bottom, the space between systems, systems a page, system-count and page-count, in mm, cm, "
          + "in or pt. Notes are spaced a little apart where a stem up meets a stem down, as LilyPond does."
        },
        {
          "area": "engine",
          "title": "\\override, \\set and \\tweak followed",
          "sample": "overrides",
          "text": "The settings real files use most are followed instead of passed over: the direction of stems, "
          + "slurs, ties, dynamics, words, fingerings and tuplets; offsets, padding and alignment of words and "
          + "marks; sizes and \\magnifyMusic; beam grouping (beatStructure, subdivideBeams, Beam.positions); boxed, "
          + "circled or numbered rehearsal marks; C or numbered time signatures; cross, diamond, triangle, slash "
          + "and harmonic note heads; \\omit and \\hide; and which bar numbers are shown. \\once, \\revert and "
          + "\\undo work. Anything else is still skipped with a warning."
        },
        {
          "area": "engine",
          "title": "Empty staves hidden: \\RemoveEmptyStaves",
          "sample": "empty-staves",
          "text": "With \\RemoveEmptyStaves, in a \\layout or a staff's \\with, a staff that only rests for a whole "
          + "system is not drawn on that system, as in an orchestral score: the staves below move up, names turn "
          + "to their short forms, brackets and braces shrink, and bar numbers and marks go over the first staff "
          + "drawn. The first system keeps every staff, unless \\RemoveAllEmptyStaves asks otherwise."
        },
        {
          "area": "engine",
          "title": "Two parts on one staff: \\partCombine",
          "sample": "part-combine",
          "text": "\\partCombine sets two parts on one staff as LilyPond does: the same notes once, with a2 where "
          + "the parts join; chords when they move together; Solo or Solo II when one rests; two voices otherwise. "
          + "\\partCombineApart, Chords, Unisono, SoloI and SoloII force a choice, and \\partCombineUp and Down "
          + "put two pairs on one staff. Both parts are played."
        },
        {
          "area": "editor",
          "title": "More real LilyPond files open on the score, not only as text",
          "sample": "editable-files",
          "text": "Pieces that used to open as text only now open in the score editor, and keep what they say "
          + "through every edit: staves that change key or metre apart from the others (a horn in F, 6/8 beside "
          + "3/4), a tempo, a rehearsal mark or a mark of words in the middle of a bar, a bar line or a repeat "
          + "sign inside a bar, a cadenza (\\cadenzaOn), a tuplet inside a tuplet, every clef the engraver "
          + "draws (French, mezzo-soprano, baritone, sub-bass, 15 above or below…), a brass mute's open and "
          + "stopped, articulations set above or below, notes set smaller (\\tiny), a tablature "
          + "(\\new TabStaff), cue notes (\\new CueVoice, \\cueDuring), an ossia over some bars, and "
          + "tuplets in a line of chord names or a figured bass. Settings the score tools do not offer, "
          + "\\override, \\set, \\tweak, \\hide or \\omit before a note, a staff's \\with, "
          + "\\layout and \\paper, stay in the text where they were written instead of being dropped by the "
          + "first edit."
        },
        {
          "area": "editor",
          "title": "Two pairs of parts on one staff, or parts that say how they combine: kept as written",
          "text": "A staff made by \\partCombineUp and \\partCombineDown, or by a \\partCombine whose parts "
          + "say how they are combined (\\partCombineApart…) or that has other music beside it, is kept exactly "
          + "as its text writes it, with the variables it uses: its notes are shown and played, and edited in the "
          + "text, while every other staff of the piece is edited on the score."
        },
        {
          "area": "site",
          "app": true,
          "title": "Push notifications on your phone and computer",
          "text": "What the bell tells you (a score shared with you, a reply, a mention, changes to a score shared "
          + "with you) can now reach your phone or computer as a notification, even when the app is closed. Turn "
          + "them on in Account, under Push notifications, on each device you want them on, and choose which "
          + "kinds you get; Send a test checks it works. A click on one opens its score at the right place. On an "
          + "iPhone or iPad, add the app to the Home Screen first and turn them on from there."
        },
        {
          "area": "editor",
          "title": "Writing notes: a pen over the staves, a ghost note, a click writes it",
          "text": "In note input (N, or the Note input button, which now wears a pen), the pointer over the staves "
          + "becomes a pen, and a pale note follows it: on the line or space under it, read through the staff's "
          + "clef with the sharp or flat the key gives it, with its ledger lines, in the duration chosen, at the "
          + "beat a click would write it. A click writes that note there, one step to undo, and the cursor goes "
          + "on after it, as typing its letter does; on a drum staff, the drum drawn on that line. Shift+click "
          + "still moves the cursor to a note without writing. Off the staves, or out of note input, the pen and "
          + "the ghost go."
        },
        {
          "area": "site",
          "title": "The home page shows the app: the editor, playing together, practice, sharing",
          "text": "The home page now says what EUI Score is for: writing, playing and sharing scores, together, in "
          + "the browser. Section by section, with a picture of the app each time, it shows the editor (mouse, "
          + "keyboard, voices, chord names, lyrics), the MIDI view, editing with others live and comments on bars, "
          + "the mixer and its sounds, the microphone and practice, reading a photo with AI, the files that come "
          + "in and out, and versions and sharing; then the engraver for developers, and the two plans. The menu "
          + "at the top reads App, Pricing, Guide and Changelog, with Sign in and Start free; the engraver's own "
          + "pages (Syntax, Examples, Embed, Limits) are under Guide and at the foot of every page."
        },
        {
          "area": "site",
          "title": "The AI runs on your own key: the site's own AI is no longer offered",
          "text": "Reading one photo of a score with Claude Opus cost the site about $0.20 to $0.40, too much to "
          + "keep giving away, so the site no longer runs an AI of its own. Reading photos and the editor's "
          + "assistant now work only with an AI key of your own, from Anthropic, OpenAI, Google (Gemini), Mistral, "
          + "DeepSeek, Moonshot (Kimi) or OpenRouter, added on your account page: your requests go to that "
          + "provider, which bills you. Without a key, the Start page and the editor say so and link to your "
          + "account before you choose a photo. Once payments open, AI with your own key is part of Pro; until "
          + "then, anyone signed in can use it. A key of your own still has up to 200 photos and 200 questions a "
          + "day, a guard against a request running away.",
          "link": "pricing",
          "app": true
        }
      ]},
      {"date": "2026-10-24", "entries": [
        {
          "area": "site",
          "title": "Pro: more AI, every audio track, a score shared with anyone",
          "text": "Everything the site does stays free. A Pricing page sets the two plans side by side. Once "
          + "payments open, Free reads 20 photos and answers 30 questions a day on the site's AI, records on one "
          + "audio track a score with 50 MB of takes, and shares a score with up to three people; Pro, 6 € a "
          + "month or 60 € a year, reads and answers five times as much, records on all four tracks with 2 GB of "
          + "takes, and shares with anyone. Until then nothing changes: every audio track, and as many people as "
          + "you like. An AI key of your own stays yours on either plan, and nothing is taken away past a "
          + "limit: older takes still play, and people a score was shared with keep it. Your account has a "
          + "Subscription section: the plan, when it renews or ends, Upgrade (monthly or yearly, paid by card "
          + "through Stripe) and Manage billing to change the card or cancel. Deleting the account cancels "
          + "the subscription, and Export all your data includes the plan.",
          "link": "pricing",
          "app": true
        },
        {
          "area": "editor",
          "title": "Practise: play transposed or slower, a loop that speeds up, a synthesizer, your own SoundFont",
          "text": "Playback has Play transposed, up or down twelve semitones without changing the speed, and a Speed "
          + "from 25 % to 200 % that keeps the pitch; Saved files too puts both in Save as MIDI and Save the sound, "
          + "which otherwise stay as written. Practice loop plays the loop slower first and faster each pass (from, "
          + "add and to, in percent), says the speed of the pass, and stops at the target or keeps looping there. "
          + "In the mixer, each staff can play a synthesizer instead of its instrument: two oscillators (sine, "
          + "square, saw, triangle) with their detune, a low-pass filter with its resonance and envelope, attack, "
          + "decay, sustain and release, from four presets (pad, lead, bass, pluck), through the staff's own volume, "
          + "pan, mute, solo and effects, on Play and in the WAV and MP3. Or a preset of an SF2 or SF3 file of your "
          + "own (up to 100 MB), kept in your browser: the score keeps its name and preset, and plays the usual "
          + "sounds, saying so, where the file is not. An MPE keyboard is recognised (or ticked by hand): each "
          + "note's bend and pressure are heard on its own with the synthesizer, and recorded into the staff's "
          + "Pitch bend and new Pressure curves. Audio takes keep their own pitch when the score is transposed, and "
          + "follow the speed and the loop that speeds up, their pitch moving with it.",
          "app": true
        },
        {
          "area": "site",
          "title": "The microphone: audio tracks, their notes written down, a tuner, and practice",
          "text": "Play ▸ Record from the microphone records a voice or an instrument onto an audio track of "
          + "the score, after a bar of count-in, in time with it: the take plays back with the score, with a "
          + "fader of its own in the mixer, and its waveform is drawn under the staves in the MIDI view. A "
          + "score has four audio tracks, one take each (recording again replaces it, Delete takes it away), "
          + "kept with the score on the server, up to about 2 min 45 s a take: its owner and editors record, "
          + "everyone it is shared with listens, on its read page too, and Export all your data includes "
          + "them. Audio tracks ▸ Write the notes turns a take of one voice or instrument into notes in the "
          + "staff you choose, over the bars it covers, fitted to the Quantize grid, in one Undo — or while "
          + "you record. Play ▸ Tuner names the note you play, its octave and how many cents off it is, "
          + "against the A4 you set (440 Hz unless you change it). Play ▸ Practice with the microphone "
          + "follows you through a staff as you play it, with no music playing: a wrong or a missed note is "
          + "passed over, and after a jump a few notes find you again. The microphone is only opened when you "
          + "ask, and a refusal says how to allow it. The tuner and practice work in the playground too.",
          "app": true
        },
        {
          "area": "editor",
          "title": "Figured bass, guitar chord diagrams, fingered grace notes, clefs with an 8 above",
          "sample": "fig-diagrams-graces",
          "text": "Four more things open in the editor instead of as text only. A figured bass (\\figuremode): "
          + "Insert › A figured bass under the staff, then Insert › Figures on a note and type 6 4, 7+ or _ 5-, "
          + "Space for the next beat. A guitar chord diagram over a note (\\fret-diagram): Insert › Guitar chord "
          + "diagram, typed from the low E as x32010. Grace notes that carry a fingering, set with Alt+Shift+1 "
          + "to 5. And the treble and bass clefs with an 8 above them (a piccolo's). Each is kept by every edit "
          + "and when two people edit other bars, and the figured bass and the fingered grace notes go to "
          + "MusicXML and back. Taking bars away or pasting bars no longer loses an 8va line, or leaves one "
          + "running on.",
          "link": "playground"
        },
        {
          "area": "editor",
          "title": "Stems, beams by hand, and C♯ spelled D♭",
          "sample": "stems-and-beams",
          "text": "Three commands the editor lacked, in the Insert menu, the tools and the keyboard: stems up, down "
          + "or as the voice wants over the selected notes (X flips them), the selected eighths beamed by hand "
          + "(Alt+B, again to take the beam away; beams it reaches into are joined) and a beam broken before a "
          + "note (Alt+Shift+B), and the selected notes spelled the other way, C♯ as D♭, E as F♭ (J), the notes "
          + "tied to them with them. Each is written in the LilyPond (\\stemUp, [ ], des), kept by every edit "
          + "and listed on the shortcuts sheet (?).",
          "link": "playground"
        },
        {
          "area": "editor",
          "title": "A line of chord names, edited beat by beat",
          "sample": "chord-names",
          "text": "A score with a line of chord names over its music (\\new ChordNames \\chordmode) now opens in "
          + "the editor, each chord written back as it was written. Insert › A line of chord names puts one over "
          + "the selected staff; then select a note under it, press K and type a chord (Am7, Bbmaj7, G7/B, "
          + "Dm7b5, N.C.), Space for the next beat. A chord holds until the next one, and a symbol the line "
          + "cannot write is refused. Transposing moves the chords with the music; two people editing other "
          + "bars keep them; MusicXML takes them out as chord symbols, each at its beat.",
          "link": "playground"
        },
        {
          "area": "editor",
          "title": "Notes on the other staff, and words under the second voice",
          "sample": "other-staff-and-verses",
          "text": "A piano score whose right hand reaches into the bass staff (\\change Staff) now opens in the "
          + "editor instead of as text only: select the notes and press Ctrl+Shift+↓ (or ↑), or use Insert, to "
          + "draw them on the staff below or above; again brings them back. They still play with their own "
          + "hand. A choir score whose words go under the alto or the bass (\\new Lyrics \\lyricsto \"alto\") "
          + "opens too: type the words under the second voice's notes and the staff sings to that voice. Both "
          + "are kept when two people edit other bars, and go to MusicXML and back.",
          "link": "playground"
        },
        {
          "area": "editor",
          "title": "Comments follow their bars and are live on the read page; @ names; \\afterGrace in MusicXML",
          "text": "A comment now stays on its bars when bars are put in or taken away before them, by you, by an "
          + "Undo, or by someone else editing at the same time, and on its staff when a staff or a voice is added "
          + "or removed; one whose bars or staff were all taken away is kept, and says so. On a score's read page, "
          + "the people it is shared with see new comments as they are written and who else has it open; anyone "
          + "reading it by its link is told when it changes. Typing @ in a comment lists the score's owner and the "
          + "people it is shared with, filtered as you type: arrows and Enter choose. MusicXML now carries grace "
          + "notes after a note, the way MuseScore and Finale write them: grace notes placed right after their "
          + "note, each saying how much of it they take; on import, grace notes that end a bar, come before a "
          + "rest or say they take from the note before become \\afterGrace.",
          "app": true
        },
        {
          "area": "editor",
          "title": "Grace notes after a note (\\afterGrace)",
          "sample": "after-grace",
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
          "sample": "mid-bar-clef-and-key",
          "text": "Write \\clef bass or \\key d \\major between two notes of a bar: the new clef is drawn small "
          + "before the note, the new key cancels the old one's sharps and flats, as LilyPond draws them. The "
          + "editor keeps these changes through every edit, the notes you type after a new key are spelled in "
          + "it, and a MusicXML file with a clef change inside a measure now opens.",
          "link": "playground"
        },
        {
          "area": "engine",
          "title": "Parts gather their bars of rest",
          "sample": "gathered-rests",
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
          "sample": "four-voices",
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
          "sample": "voices-ottava-fingerings",
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

  # The label a reader sees for an entry's area, in the request's language (#471).
  static def area_label(area)
    SiteText.t(area == "engine" ? "changelog.engine" : "changelog.site")
  end

  # A day's heading in `locale` (#471): its words and their order are the
  # locale file's (date.*) — "Saturday, October 31, 2026", "samedi 31 octobre 2026".
  static def day_heading(date, locale)
    day = DateTime.parse(date)
    name = SiteText.t("date.days.#{day.format("%A").downcase}", {}, locale)
    month = SiteText.t("date.months.m#{day.format("%m").to_i}", {}, locale)
    SiteText.t("date.heading", {
      "day": name,
      "d": day.format("%-d"),
      "month": month,
      "year": day.format("%Y")
    }, locale)
  end
end
