/** 混合批量队列：一次向导会话内暂存的多组「模板 × 数量」。 */
export interface BatchQueueGroup {
  id: string;
  templateId: string;
  templateVersion: number;
  templateName: string;
  count: number;
}

export function queueTotalCount(
  groups: BatchQueueGroup[],
  currentCount: number,
): number {
  return groups.reduce((sum, group) => sum + group.count, 0) + currentCount;
}

export function queueTotalPoints(
  groups: BatchQueueGroup[],
  currentCount: number,
  pointsPerVideo: number,
): number {
  return queueTotalCount(groups, currentCount) * pointsPerVideo;
}
