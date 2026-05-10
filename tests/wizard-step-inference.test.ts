import assert from "node:assert/strict";
import test from "node:test";
import { inferWizardStepFromPathname } from "../src/components/wizard/wizard-step-indicator";

test("inferWizardStepFromPathname: /wizard root → 0", () => {
  assert.equal(inferWizardStepFromPathname("/wizard"), 0);
  assert.equal(inferWizardStepFromPathname("/wizard/"), 0);
});

test("inferWizardStepFromPathname: /wizard/new → 0", () => {
  assert.equal(inferWizardStepFromPathname("/wizard/new"), 0);
  assert.equal(inferWizardStepFromPathname("/wizard/new/"), 0);
});

test("inferWizardStepFromPathname: /wizard/<id> → 1", () => {
  assert.equal(inferWizardStepFromPathname("/wizard/abc123"), 1);
  assert.equal(inferWizardStepFromPathname("/wizard/abc123/"), 1);
});

test("inferWizardStepFromPathname: /wizard/<id>/step-N-... → N", () => {
  assert.equal(inferWizardStepFromPathname("/wizard/abc/step-2-card"), 2);
  assert.equal(inferWizardStepFromPathname("/wizard/abc/step-3-script"), 3);
  assert.equal(inferWizardStepFromPathname("/wizard/abc/step-4-storyboard"), 4);
  assert.equal(inferWizardStepFromPathname("/wizard/abc/step-5-upload"), 5);
  assert.equal(inferWizardStepFromPathname("/wizard/abc/step-6-render"), 6);
});

test("inferWizardStepFromPathname: out of range step → 0", () => {
  assert.equal(inferWizardStepFromPathname("/wizard/abc/step-9-foo"), 0);
});

test("inferWizardStepFromPathname: null/empty → 0", () => {
  assert.equal(inferWizardStepFromPathname(null), 0);
  assert.equal(inferWizardStepFromPathname(""), 0);
  assert.equal(inferWizardStepFromPathname("/orders"), 0);
});
