# What the home page shows of the app (#397), one section a feature group:
# its anchor, eyebrow, heading, one to three short lines, a screenshot of
# the real app (public/images/home/, 1600×1010 JPEG) and where its link goes
# ("playground" or "signup": HomeController#index makes it a path).
# The lines say what the changelog's "app" entries say, shorter. Its words
# are the locale files' (home.features.<id>.*, #471): eyebrow, title, l1…,
# alt and label, in the request's language.
const HOME_SHOT_WIDTH = 1600
const HOME_SHOT_HEIGHT = 1010

class HomeFeatures
  static def all
    [
      {
        "id": "editor",
        "lines": 3,
        "image": "editor.jpg",
        "link": "playground"
      },
      {
        "id": "midi",
        "lines": 2,
        "image": "midi-view.jpg",
        "link": "signup"
      },
      {
        "id": "together",
        "lines": 2,
        "image": "together.jpg",
        "link": "signup"
      },
      {
        "id": "sound",
        "lines": 2,
        "image": "mixer.jpg",
        "link": "playground"
      },
      {
        "id": "practice",
        "lines": 3,
        "image": "practice.jpg",
        "link": "signup"
      },
      {
        "id": "ai",
        "lines": 2,
        "image": "start-photo.jpg",
        "link": "signup"
      },
      {
        "id": "files",
        "lines": 2,
        "image": "export.jpg",
        "link": "playground"
      },
      {
        "id": "sharing",
        "lines": 3,
        "image": "sharing.jpg",
        "link": "signup"
      }
    ].map do |feature|
      words = "home.features.#{feature["id"]}"
      {
        "id": feature["id"],
        "eyebrow": SiteText.t("#{words}.eyebrow"),
        "title": SiteText.t("#{words}.title"),
        "lines": (1 .. (feature["lines"] + 1)).map do |n|
          SiteText.t("#{words}.l#{n}")
        end,
        "image": feature["image"],
        "alt": SiteText.t("#{words}.alt"),
        "link": feature["link"],
        "label": SiteText.t("#{words}.label")
      }
    end
  end
end
