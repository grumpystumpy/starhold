import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SCHEDULED_PASS_SAVE_RESERVE_MS,
  SCHEDULED_PASS_TOTAL_BUDGET_MS,
} from "./data/tuning.js";
import { budgetScheduledTickAfterLoad, maintenanceTickBudget } from "./tick-budget.js";

describe("scheduled tick budget", () => {
  it("reserves save time and subtracts time spent loading", () => {
    const budget = maintenanceTickBudget(100);
    budgetScheduledTickAfterLoad(budget, 160, 5);

    assert.equal(
      budget.timeBudgetMs,
      SCHEDULED_PASS_TOTAL_BUDGET_MS - 60 - SCHEDULED_PASS_SAVE_RESERVE_MS,
    );
    assert.equal(budget.timeBudgetCpuMs, 5);
    assert.equal(budget.timeBudgetStartedAt, 160);
  });

  it("does not leave tick time when loading used the pass window", () => {
    const budget = maintenanceTickBudget(100);
    budgetScheduledTickAfterLoad(budget, 400, 5);

    assert.equal(budget.timeBudgetMs, 0);
  });
});
