# The pieces the site engraves, and where their LilyPond lives.
#
# Every source is a file under `scores/`: `scores/<category>/<slug>.ly` for
# the gallery, `scores/syntax/<name>.ly` for the syntax reference. A file is
# only ever read by a name this class lists or has checked, so a request can
# never pick the path.
class ScoreLibrary
  static def categories

    # Their titles and leads are the locale files' (examples.categories.*, #471).
    ["solos", "voice", "piano", "guitar", "drums", "ensembles"].map do |slug|
      {
        "slug": slug,
        "title": SiteText.t("examples.categories.#{slug}.title"),
        "lead": SiteText.t("examples.categories.#{slug}.lead")
      }
    end
  end

  static def examples
    [
      {
        "category": "solos",
        "slug": "ode-to-joy",
        "title": "Ode to Joy",
        "composer": "Beethoven",
        "instrument": "Violin",
        "about": "The theme of the Ninth Symphony's finale: four phrases, dynamics, and a hairpin on the return.",
        "shows": ["\\relative", "\\key d \\major", "\\mf \\p \\f", "hairpin \\< … \\!"]
      },
      {
        "category": "solos",
        "slug": "cello-suite",
        "title": "Cello Suite No. 1, Prelude",
        "composer": "J. S. Bach",
        "instrument": "Cello",
        "about": "The first three bars of the famous prelude: sixteenths in the bass clef, phrasing slurs.",
        "shows": ["\\clef bass", "sixteenths", "slurs ( )", "\\bar \"||\""]
      },
      {
        "category": "solos",
        "slug": "the-swan",
        "title": "The Swan",
        "composer": "Saint-Saëns",
        "instrument": "Viola",
        "about": "The melody from The Carnival of the Animals in the alto clef, in 6/4, with its long slurs.",
        "shows": ["\\clef alto", "\\time 6/4", "dotted whole notes", "tie ~"]
      },
      {
        "category": "solos",
        "slug": "prince-of-denmark",
        "title": "Prince of Denmark's March",
        "composer": "Clarke",
        "instrument": "Trumpet",
        "about": "Dotted rhythms, accents and tenutos, and a closing fermata.",
        "shows": ["8. 16", "-> accent", "-- tenuto", "\\fermata"]
      },
      {
        "category": "solos",
        "slug": "greensleeves",
        "title": "Greensleeves",
        "composer": "Traditional",
        "instrument": "Oboe",
        "about": "A compound 6/8 metre and the raised leading tone of the minor mode.",
        "shows": ["\\time 6/8", "\\tempo \"Andante\" 8 = 144", "G sharp"]
      },
      {
        "category": "solos",
        "slug": "flute-etude",
        "title": "Triplet Etude",
        "composer": "Example",
        "instrument": "Flute",
        "about": "Numbered triplets, triplets grouped by beat, staccatos and a fermata.",
        "shows": ["\\tuplet 3/2", "\\tuplet 3/2 4", "-. staccato", "\\fermata"]
      },
      {
        "category": "voice",
        "slug": "au-clair-de-la-lune",
        "title": "Au clair de la lune",
        "composer": "French folk song",
        "instrument": "Voice",
        "about": "A melody and its lyrics, syllable by syllable, with hyphens between syllables.",
        "shows": ["\\addlyrics", "-- hyphen"]
      },
      {
        "category": "voice",
        "slug": "frere-jacques",
        "title": "Frère Jacques as a round",
        "composer": "Traditional",
        "instrument": "Two voices",
        "about": "The two-voice round: the second voice enters two bars later, each with its own lyrics.",
        "shows": ["\\new ChoirStaff", "R1*2", "lyrics per staff"]
      },
      {
        "category": "voice",
        "slug": "satb-chorale",
        "title": "Four-Part Chorale",
        "composer": "Example",
        "instrument": "Soprano, alto, tenor, bass",
        "about": "An SATB choir: full then short names, lyrics under every staff, aligned fermatas.",
        "shows": ["\\new ChoirStaff", "shortInstrumentName", "\\clef bass"]
      },
      {
        "category": "voice",
        "slug": "voice-and-piano",
        "title": "Voice and Piano",
        "composer": "French folk song",
        "instrument": "Voice and piano",
        "about": "A vocal line above a grand staff: nested staff groups.",
        "shows": ["<< … >>", "\\new PianoStaff", "\\header arranger"]
      },
      {
        "category": "piano",
        "slug": "minuet-in-g",
        "title": "Minuet in G major",
        "composer": "Petzold",
        "instrument": "Piano",
        "about": "The minuet from the Notebook for Anna Magdalena Bach, sixteen bars over two systems.",
        "shows": ["\\new PianoStaff", "brace", "chords < >", "staccatos"]
      },
      {
        "category": "piano",
        "slug": "prelude-in-c",
        "title": "Prelude in C major",
        "composer": "J. S. Bach",
        "instrument": "Piano",
        "about": "The first four bars of The Well-Tempered Clavier: two voices in the left hand, with ties.",
        "shows": ["<< { … } \\\\ { … } >>", "sixteenths", "ties ~"]
      },
      {
        "category": "piano",
        "slug": "fur-elise",
        "title": "Für Elise",
        "composer": "Beethoven",
        "instrument": "Piano",
        "about": "The opening of the bagatelle: 3/8 time, sixteenths and rests in both hands.",
        "shows": ["\\time 3/8", "accidentals", "\\pp"]
      },
      {
        "category": "piano",
        "slug": "waltz",
        "title": "Little Waltz",
        "composer": "Example",
        "instrument": "Piano",
        "about": "An oom-pah-pah bass under a slurred melody, with crescendo and diminuendo hairpins.",
        "shows": ["\\relative", "left-hand chords", "\\< \\>"]
      },
      {
        "category": "piano",
        "slug": "little-suite",
        "title": "Little Suite in Five Moods",
        "composer": "Demonstration tune",
        "instrument": "Piano, right hand",
        "about": "Five movements in a row: changes of key, metre and tempo.",
        "shows": ["\\tempo", "\\key changes", "\\break", "several systems"]
      },
      {
        "category": "guitar",
        "slug": "arpeggios",
        "title": "Arpeggios in A minor",
        "composer": "Example",
        "instrument": "Guitar",
        "about": "Arpeggios over Am – Dm – E7, with the chord names above the staff.",
        "shows": ["^\"Am\" text above", "final chord < >", "\\fermata"]
      },
      {
        "category": "guitar",
        "slug": "strumming",
        "title": "Pop Strumming",
        "composer": "Example",
        "instrument": "Guitar",
        "about": "Six-string block chords on an eighth-eighth-rest rhythm, over G – D – Em – C.",
        "shows": ["six-note chords", "r rest", "^\"G\""]
      },
      {
        "category": "guitar",
        "slug": "blues",
        "title": "Blues in E",
        "composer": "Example",
        "instrument": "Electric guitar",
        "about": "A twelve-bar boogie riff, played twice with two different endings.",
        "shows": ["\\repeat volta 2", "\\alternative", "\\key e \\major"]
      },
      {
        "category": "guitar",
        "slug": "romance",
        "title": "Spanish Romance",
        "composer": "Anonymous",
        "instrument": "Guitar",
        "about": "The opening of the Romance from Forbidden Games, in eighth-note triplets grouped by beat.",
        "shows": ["\\tuplet 3/2 4", "\\key e \\minor"]
      },
      {
        "category": "drums",
        "slug": "rock",
        "title": "Rock Groove",
        "composer": "Example",
        "instrument": "Drums",
        "about": "A drum kit on its own staff: hands on top, the kick below, a fill around the toms into a crash.",
        "shows": ["\\new DrumStaff \\drummode", "<< { … } \\\\ { … } >>", "<hh sn> strokes"]
      },
      {
        "category": "drums",
        "slug": "funk",
        "title": "Funk Groove",
        "composer": "Example",
        "instrument": "Drums",
        "about": "Sixteenths on the hi-hat, accented snare and ghost notes, an open hi-hat to finish.",
        "shows": ["\\drummode", "-> accents", "hho, the open hi-hat"]
      },
      {
        "category": "drums",
        "slug": "timpani",
        "title": "Timpani",
        "composer": "Example",
        "instrument": "Timpani",
        "about": "Two drums in the bass clef: a triplet roll, crescendo to fortissimo.",
        "shows": ["\\clef bass", "triplets", "\\p\\< … \\ff"]
      },
      {
        "category": "drums",
        "slug": "percussion",
        "title": "Percussion Ensemble",
        "composer": "Example",
        "instrument": "Woodblock, steel drum, taiko",
        "about": "Three instruments joined by a bracket, each with its own MIDI sound.",
        "shows": ["\\new StaffGroup", "midiInstrument", "triplets"]
      },
      {
        "category": "ensembles",
        "slug": "string-quartet",
        "title": "Canon in D",
        "composer": "Pachelbel",
        "instrument": "String quartet",
        "about": "Two violins, a viola in the alto clef, a cello: the ground bass and the canon taking shape.",
        "shows": ["\\new StaffGroup", "\\clef alto", "short names"]
      },
      {
        "category": "ensembles",
        "slug": "wind-quintet",
        "title": "Little March",
        "composer": "Example",
        "instrument": "Wind quintet",
        "about": "Flute, oboe, clarinet, horn and bassoon in a 2/4 march in B flat.",
        "shows": ["five staves", "\\key bes \\major", "staccatos"]
      },
      {
        "category": "ensembles",
        "slug": "jazz-trio",
        "title": "Two-Five-One",
        "composer": "Example",
        "instrument": "Trumpet, saxophone, double bass",
        "about": "A ii – V – I cadence: chord symbols over the trumpet, a walking double bass.",
        "shows": ["^\"Dm7\"", "triplet", "bass clef double bass"]
      },
      {
        "category": "ensembles",
        "slug": "chamber-orchestra",
        "title": "Chorale for Chamber Orchestra",
        "composer": "Example",
        "instrument": "Woodwinds and strings",
        "about": "Two groups of staves, each with its bracket, in one score.",
        "shows": ["nested groups", "\\clef alto", "\\fermata"]
      },
      {
        "category": "ensembles",
        "slug": "symphony-5",
        "title": "Symphony No. 5",
        "composer": "Beethoven",
        "instrument": "Orchestra",
        "about": "The opening of the first movement in full score: woodwinds, brass, timpani and strings.",
        "shows": ["full score", "R2*12", "\\repeat volta 2", "\\fermata"]
      }
    ]
  end

  static def category(slug)
    ScoreLibrary.categories.find do |cat|
      cat["slug"] == slug
    end
  end

  static def examples_in(slug)
    ScoreLibrary.examples.filter do |example|
      example["category"] == slug
    end
  end

  # The example, or nil: the caller answers 404.
  static def example(category_slug, slug)
    ScoreLibrary.examples.find do |example|
      example["category"] == category_slug && example["slug"] == slug
    end
  end

  static def source(example)
    File.read("scores/#{example["category"]}/#{example["slug"]}.ly")
  end

  # `name` is "syntax/notes" or "piano/waltz": a snippet of the syntax page
  # or a gallery piece. Nil for anything else, a made-up name included.
  static def source_named(name)
    return nil unless ScoreLibrary.safe_name?(name)

    parts = name.split("/")
    return nil unless parts.length == 2

    if parts[0] == "syntax"
      path = "scores/syntax/#{parts[1]}.ly"
      return nil unless File.exists(path)

      return File.read(path)
    end
    example = ScoreLibrary.example(parts[0], parts[1])
    return nil if example.nil?

    ScoreLibrary.source(example)
  end

  # Every snippet of the syntax page, by its file's name.
  static def snippets
    snippets_by_name = {}
    File.glob("scores/syntax/*.ly").each do |path|
      name = path.split("/").last.replace(".ly", "")
      snippets_by_name[name] = File.read(path)
    end
    snippets_by_name
  end

  static def safe_name?(name)
    return false if name.blank?
    return false if name.length > 80

    allowed = "abcdefghijklmnopqrstuvwxyz0123456789-/"
    name.chars().all? do |ch|
      allowed.contains(ch)
    end
  end

  # What the engraver refuses, each with a source that shows it: the limits
  # page engraves them live, so the messages it prints are the engraver's own.
  # Only what is still refused: since Soli 2.28.5, layout settings (\stemUp,
  # \override) and a forced accidental (cis!) are read. What the engraver on
  # this server has come to read is left out by itself (\afterGrace, from
  # the Soli release with eui #389).
  static def refusals
    ScoreLibrary.known_refusals.filter do |refusal|
      ScoreLibrary.refused?(refusal["src"])
    end
  end

  # Whether the server's engraver refuses `src`.
  static def refused?(src)
    !eui_score_layout(src, 100, {})["error"].nil?
  end

  # Every limit the page has listed, each with a source that shows it.
  static def known_refusals
    [
      {"what": "256th notes", "src": "{ c''256 }"},
      {"what": "Tuplets three deep", "src": "{ \\tuplet 3/2 { \\tuplet 3/2 { \\tuplet 3/2 { c'32 d' e' } } } }"},
      {"what": "Five voices", "src": "{ << { c''4 } \\\\ { a'4 } \\\\ { f'4 } \\\\ { d'4 } \\\\ { b4 } >> }"},
      {"what": "A change of metre inside a bar", "src": "{ c''4 \\time 3/4 d''4 e'' f'' }"},
      {"what": "Grace notes after a note", "src": "{ c''4 \\afterGrace d''2 { e''16 } r4 }"},
      {"what": "An unknown command", "src": "{ c''4 \\shiver d''4 }"}
    ]
  end
end
