# The stars a person gives a section of the shared library (#444): 1 to 5,
# one rating a person and a section, changed by rating again. Its author
# does not rate their own section.
class SectionRating < Model
  validates("section_id", {"presence": true})
  validates("user_id", {"presence": true})
  validates(
    "stars",
    {
      "type": "int",
      "min": 1,
      "max": 5
    }
  )

  # `user` rates `section` `stars` (1 to 5): nil once done, else why not.
  static def rate(section, user, stars)
    count = stars.to_s.to_i
    return "Give 1 to 5 stars." if count < 1 || count > 5
    return "You cannot rate a section you shared." if section.by?(user)

    rating = SectionRating.where({
      "section_id": section._key,
      "user_id": user._key
    }).first
    if rating.nil?
      SectionRating.create({
        "section_id": section._key,
        "user_id": user._key,
        "stars": count,
        "created_at": DateTime.utc.to_unix
      })
    else
      rating.stars = count
      rating.update()
    end
    section.recount
    nil
  end

  # The stars `user` gave `section`, or 0.
  static def given(section, user)
    return 0 if user.nil?

    rating = SectionRating.where({
      "section_id": section._key,
      "user_id": user._key
    }).first
    rating.nil? ? 0 : rating.stars
  end
end
