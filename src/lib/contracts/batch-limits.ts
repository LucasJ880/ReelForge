/**
 * Customer-visible batch boundaries. Keep the API validator and both UI
 * controls on this single source so the commercial overload tier exercises
 * the same contract customers use.
 */
export const MAX_BATCH_IMAGE_COUNT = 50;
export const MAX_BATCH_VIDEO_COUNT = 250;
