# The playground: LilyPond typed on the left, engraved on the right at each
# keystroke — in the browser, by eui-score compiled to WebAssembly
# (public/eui-score/). The server only engraves the first picture, so the
# page shows a score before the module has loaded.
class PlaygroundController < Controller
  # GET /playground — optionally ?source=piano/waltz to start from a piece
  def show
    @source = ScoreLibrary.source_named(params["source"].to_s) ?? ScoreLibrary.source_named("solos/ode-to-joy")
    @examples = ScoreLibrary.examples
    @figure = ScoreSvg.figure(@source, 1000, 7)
    @title = "Playground"
    @description = "Type LilyPond, and eui-score engraves it in your browser as you type."
  end
end
