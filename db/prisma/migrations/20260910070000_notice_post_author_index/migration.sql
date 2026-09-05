-- NoticePost.postedById is a SetNull foreign key with no index, so deleting a
-- character made Postgres scan the whole table. Small today; a latent scan.
CREATE INDEX "NoticePost_postedById_idx" ON "NoticePost"("postedById");
