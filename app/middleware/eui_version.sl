# The browser engraver's one version (ScoreAssets.version), handed to the
# pages that load its modules outside the editor (#689): the layout's Play
# and the version pages name every module at it (`eui_module_path`), as the
# modules name the ones they import — so a module two others import is one
# module, not a second copy of score-model.js fetched, read and run.

# order: 5
# global_only: true

def set_eui_version(req)
  req["eui_version"] = ScoreAssets.version if req["method"] == "GET"
  req
end
