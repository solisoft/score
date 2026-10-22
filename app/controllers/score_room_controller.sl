# WS /ws/scores?ticket=… — the room of a score open in the editor
# (ScoreRoom).
def handle(event)
  ScoreRoom.on_event(event, DateTime.utc.to_unix)
end
