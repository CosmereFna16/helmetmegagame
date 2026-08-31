-- Nobility upkeep: consecutive turn closes without a Fine/Lavish Meal.
-- Additive with a default, so deploys in either order are safe.
ALTER TABLE "Character" ADD COLUMN "missedMealStreak" INTEGER NOT NULL DEFAULT 0;
