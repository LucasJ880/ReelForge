import path from "node:path";

export const FINAL_ACCEPTANCE_EMAIL = "final-acceptance@aivora.app";
export const FINAL_ACCEPTANCE_PASSWORD = "aivora-final-acceptance-2026";
export const FINAL_ACCEPTANCE_TEMPLATE_NAME = "最终验收单图模板";
export const FINAL_ACCEPTANCE_TEMPLATE_SLUG = "final-acceptance-one-image";
export const RUN_STATE_PATH = path.join(
  process.cwd(),
  "test-results/final-acceptance/run-state.json",
);
