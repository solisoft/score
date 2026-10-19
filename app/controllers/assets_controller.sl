# The browser engraver at stable addresses, for other sites to link to.
class AssetsController < Controller
  # GET /eui-score.js — <eui-score> and the engraving API, current version
  def element
    ScoreAssets.entry("eui-score.js")
  end

  # GET /eui-score-editor.js — <eui-score-editor>, current version
  def editor
    ScoreAssets.entry("eui-score-editor.js")
  end
end
