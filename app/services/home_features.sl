# What the home page shows of the app (#397), one section a feature group:
# its anchor, eyebrow, heading, one to three short lines, a screenshot of
# the real app (public/images/home/, 1600×1010 JPEG) and where its link goes
# ("playground", "signup" or "pricing": HomeController#index makes it a path).
# The lines say what the changelog's "app" entries say, shorter.
const HOME_SHOT_WIDTH = 1600
const HOME_SHOT_HEIGHT = 1010

class HomeFeatures
  static def all
    [
      {
        "id": "editor",
        "eyebrow": "The editor",
        "title": "Write with the mouse, the keyboard, or both.",
        "lines": [
          "Click a note and change it, or press N and type the letters: the commands have their shortcuts.",
          "Three and four voices on a staff, a line of chord names, verses of lyrics, grace notes, fingerings.",
          "Undo goes as far back as you like, and survives a reload."
        ],
        "image": "editor.jpg",
        "alt": "The score editor: a string quartet, a note selected and its palette above it.",
        "link": "playground",
        "label": "Try the editor"
      },
      {
        "id": "midi",
        "eyebrow": "The MIDI view",
        "title": "Every track at a glance, every note in reach.",
        "lines": [
          "A piano roll to drag and stretch notes, each note's velocity drawn by hand.",
          "Automation curves, a drum grid, an arpeggiator; quantize, swing and humanize."
        ],
        "image": "midi-view.jpg",
        "alt": "The MIDI view: four tracks as a piano roll, the velocity and automation lanes below.",
        "link": "signup",
        "label": "Open the MIDI view"
      },
      {
        "id": "together",
        "eyebrow": "Together",
        "title": "Two people, one score, live.",
        "lines": [
          "Edit at the same time: your bars merge with theirs, and you see where each one works.",
          "Comment on a bar, answer, resolve; @ someone and they are notified."
        ],
        "image": "together.jpg",
        "alt": "Ben edits a quartet while Anna works on the viola's bars; comments on bars in the side panel.",
        "link": "signup",
        "label": "Write together"
      },
      {
        "id": "sound",
        "eyebrow": "Sound",
        "title": "A mixer, a synth, your own sounds.",
        "lines": [
          "Volume, pan, mute, solo and effects on each staff; a synthesizer, or a SoundFont of your own.",
          "Play and record from a MIDI keyboard: MIDI clock, MIDI learn and MPE included."
        ],
        "image": "mixer.jpg",
        "alt": "The mixer: a strip for each staff of the quartet, with volume, pan, instrument and effects.",
        "link": "playground",
        "label": "Hear it"
      },
      {
        "id": "practice",
        "eyebrow": "Microphone and practice",
        "title": "Sing or play, and the score listens.",
        "lines": [
          "Record audio tracks, turn a take into notes, tune with the tuner.",
          "Practice mode follows you through the score; play it transposed, slower or faster.",
          "A loop that speeds up each pass, until you are at tempo."
        ],
        "image": "practice.jpg",
        "alt": "The tuner reading an A a few cents sharp, beside the practice loop that gets faster each pass.",
        "link": "signup",
        "label": "Start practising"
      },
      {
        "id": "ai",
        "eyebrow": "AI, with Pro",
        "title": "A photo becomes a score.",
        "lines": [
          "Photograph printed or handwritten music: an AI model reads it into a score you can edit.",
          "An assistant suggests chords, an accompaniment, improvements, on your own AI key."
        ],
        "image": "start-photo.jpg",
        "alt": "The Start page: new score templates, Import a file, and From a photo.",
        "link": "pricing",
        "label": "See Pro"
      },
      {
        "id": "files",
        "eyebrow": "Import and export",
        "title": "In and out, in the formats you use.",
        "lines": [
          "Open MusicXML, MIDI and LilyPond; save them back, and the sound as WAV, MP3 or stems.",
          "Print a PDF whose text you can select, with headers, footers and parts."
        ],
        "image": "export.jpg",
        "alt": "The File menu: open a file or a photo; save as LilyPond, PDF, MIDI, MusicXML, WAV, MP3 or stems.",
        "link": "playground",
        "label": "Open a file"
      },
      {
        "id": "sharing",
        "eyebrow": "Versions and sharing",
        "title": "Your work, kept and shared your way.",
        "lines": [
          "Every version kept, with who saved it; go back to any of them.",
          "Share by link, in public, or with people who may read or change it.",
          "Export all your data, and sign in in two steps if you like."
        ],
        "image": "sharing.jpg",
        "alt": "Sharing a score: anyone with the link may read it; Ben may change it, Carla may open it.",
        "link": "signup",
        "label": "Start for free"
      }
    ]
  end
end
