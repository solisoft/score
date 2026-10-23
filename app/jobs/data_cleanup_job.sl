# Every night, what no one should keep: the scores in the trash past
# SCORE_TRASH_DAYS — every owner's, those who never open their library
# included — with their versions, shares and suggestions; and the photo
# readings and AI suggestions cut off mid-way by a restart (failed, their
# picture or text let go); the engravings kept past their time, or past the
# newest ENGRAVINGS_KEPT. Answers what it did.
class DataCleanupJob
  static cron: String = Cron.daily_at("03:30")

  static def perform(args: Hash)
    {
      "scores": Score.purge_all_trash,
      "readings": ScoreReading.expire_stuck,
      "suggestions": ScoreSuggestion.expire_stuck,
      "engravings": Engraving.expire
    }
  end
end
