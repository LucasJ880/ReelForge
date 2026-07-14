-- Ownership token for each external stitch claim. A late callback from an
-- earlier runner attempt must not overwrite a newer STITCHING attempt.
ALTER TABLE "FinalVideo"
ADD COLUMN "stitchAttemptToken" TEXT;
