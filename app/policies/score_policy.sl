# A score is its owner's: only they see it, change it, trash it. (Sharing
# opens it to others: #322.)
class ScorePolicy < ApplicationPolicy
  def show?
    this.record.owned_by?(this.user)
  end

  def update?
    this.record.owned_by?(this.user)
  end

  def destroy?
    this.record.owned_by?(this.user)
  end
end
