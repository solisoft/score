# Who may do what with a score through their account: its owner anything;
# someone it is shared with in "write" open and change it, in "read" open
# it. Trash, deletion and sharing stay the owner's. (Its read page, by link,
# is SharedScoresController's: Score#readable_by?.)
class ScorePolicy < ApplicationPolicy
  def show?
    !this.record.access_of(this.user).nil?
  end

  def update?
    this.record.writable_by?(this.user)
  end

  def destroy?
    this.record.owned_by?(this.user)
  end

  def share?
    this.record.owned_by?(this.user)
  end
end
