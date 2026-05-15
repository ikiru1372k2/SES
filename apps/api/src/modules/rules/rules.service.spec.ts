import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AUDIT_RULE_CATALOG } from '@ses/domain';
import { RulesService } from './rules.service';

describe('RulesService.syncCatalog', () => {
  it('upserts every audit rule from the domain catalog', async () => {
    const calls: Array<{ where: { ruleCode: string }; create: { ruleCode: string; functionId: string } }> = [];
    const prisma = {
      auditRule: {
        upsert: async (args: { where: { ruleCode: string }; create: { ruleCode: string; functionId: string } }) => {
          calls.push(args);
          return args;
        },
      },
    };
    const service = new RulesService(prisma as never);

    await service.syncCatalog();

    assert.equal(calls.length, AUDIT_RULE_CATALOG.length);
    assert.equal(calls[0]!.where.ruleCode, AUDIT_RULE_CATALOG[0]!.ruleCode);
    const overPlanningRule = calls.find((call) => call.where.ruleCode === 'RUL-OP-MONTH-PD-HIGH');
    assert.equal(overPlanningRule?.create.functionId, 'over-planning');
    const functionRateRule = calls.find((call) => call.where.ruleCode === 'RUL-FR-RATE-ZERO');
    assert.equal(functionRateRule?.create.functionId, 'function-rate');
  });
});
