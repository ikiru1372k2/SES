-- Master Data audit engine — extended to all 27 columns the business owners
-- review (was 10). Adds rule rows for the 17 new required fields plus a
-- separate "Not assigned" review rule for Project Product. The existing
-- `RUL-MD-PROJECT_PRODUCT-MISSING` and `RUL-MD-PROJECT_PRODUCT-REVIEW-OTHERS`
-- rows from the previous migration stay as-is.
--
-- Idempotent: ON CONFLICT DO UPDATE keeps the catalog in sync with the
-- TypeScript source of truth (`packages/domain/src/functions-audit/
-- master-data/rules.ts`). The seed script writes the same rows; running
-- both is safe.
--
-- All rows are scoped to functionId='master-data' (added by the earlier
-- audit_rule_function_scope migration). The FK to SystemFunction means
-- this migration MUST run after the SystemFunction seed exists — already
-- guaranteed by the issue62_system_functions migration.

INSERT INTO "AuditRule" ("id", "ruleCode", "functionId", "name", "category", "description", "defaultSeverity", "isEnabledDefault", "paramsSchema", "version", "createdAt") VALUES
    ('rule-md-country-customer',          'RUL-MD-COUNTRY_CUSTOMER-MISSING',          'master-data', 'Country Customer required',          'Data Quality', 'Country Customer must be populated with a real value (not blank, null, "not assigned", "undefined", …).',          'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-no',                'RUL-MD-PROJECT_NO-MISSING',                'master-data', 'Project No. required',               'Data Quality', 'Project No. must be populated with a real value (not blank, null, "not assigned", "undefined", …).',               'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-name',              'RUL-MD-PROJECT_NAME-MISSING',              'master-data', 'Project required',                   'Data Quality', 'Project must be populated with a real value (not blank, null, "not assigned", "undefined", …).',                   'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-bcs-project-type',          'RUL-MD-BCS_PROJECT_TYPE-MISSING',          'master-data', 'BCS Project Type required',          'Data Quality', 'BCS Project Type must be populated with a real value (not blank, null, "not assigned", "undefined", …).',          'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-activity-type',             'RUL-MD-ACTIVITY_TYPE-MISSING',             'master-data', 'Activity type required',             'Data Quality', 'Activity type must be populated with a real value (not blank, null, "not assigned", "undefined", …).',             'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-type',                      'RUL-MD-TYPE-MISSING',                      'master-data', 'Type required',                      'Data Quality', 'Type must be populated with a real value (not blank, null, "not assigned", "undefined", …).',                      'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-psu-relevant',              'RUL-MD-PSU_RELEVANT-MISSING',              'master-data', 'PSU Relevant required',              'Data Quality', 'PSU Relevant must be populated with a real value (not blank, null, "not assigned", "undefined", …).',              'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-contractor-type',           'RUL-MD-CONTRACTOR_TYPE-MISSING',           'master-data', 'Contractor Type required',           'Data Quality', 'Contractor Type must be populated with a real value (not blank, null, "not assigned", "undefined", …).',           'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-state',             'RUL-MD-PROJECT_STATE-MISSING',             'master-data', 'Project State required',             'Data Quality', 'Project State must be populated with a real value (not blank, null, "not assigned", "undefined", …).',             'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-management-office', 'RUL-MD-PROJECT_MANAGEMENT_OFFICE-MISSING', 'master-data', 'Project Management Office required', 'Data Quality', 'Project Management Office must be populated with a real value (not blank, null, "not assigned", "undefined", …).', 'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-cost-center-project',       'RUL-MD-COST_CENTER_PROJECT-MISSING',       'master-data', 'Cost Center (Project) required',     'Data Quality', 'Cost Center (Project) must be populated with a real value (not blank, null, "not assigned", "undefined", …).',     'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-created',           'RUL-MD-PROJECT_CREATED-MISSING',           'master-data', 'Project Created required',           'Data Quality', 'Project Created must be populated with a real value (not blank, null, "not assigned", "undefined", …).',           'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-start',             'RUL-MD-PROJECT_START-MISSING',             'master-data', 'Project Start required',             'Data Quality', 'Project Start must be populated with a real value (not blank, null, "not assigned", "undefined", …).',             'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-end',               'RUL-MD-PROJECT_END-MISSING',               'master-data', 'Project End required',               'Data Quality', 'Project End must be populated with a real value (not blank, null, "not assigned", "undefined", …).',               'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-golive-status',             'RUL-MD-GOLIVE_STATUS-MISSING',             'master-data', 'GoLive Status required',             'Data Quality', 'GoLive Status must be populated with a real value (not blank, null, "not assigned", "undefined", …).',             'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-scheduled-golive-date',     'RUL-MD-SCHEDULED_GOLIVE_DATE-MISSING',     'master-data', 'Scheduled GoLive Date required',     'Data Quality', 'Scheduled GoLive Date must be populated with a real value (not blank, null, "not assigned", "undefined", …).',     'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-booking-closure',   'RUL-MD-PROJECT_BOOKING_CLOSURE-MISSING',   'master-data', 'Project Booking Closure required',   'Data Quality', 'Project Booking Closure must be populated with a real value (not blank, null, "not assigned", "undefined", …).',   'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-product-not-assigned', 'RUL-MD-PROJECT_PRODUCT-NOT-ASSIGNED',   'master-data', 'Project Product "Not assigned" needs review', 'Needs Review', 'Project Product contains the literal token "Not assigned" — alone or alongside other entries (e.g. "Not assigned, SAP X"). Treated as a manual review item: someone explicitly deferred picking the product and the auditor needs to follow up with the project team.', 'Medium', true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW())
ON CONFLICT ("ruleCode") DO UPDATE SET
    "functionId"       = EXCLUDED."functionId",
    "name"             = EXCLUDED."name",
    "category"         = EXCLUDED."category",
    "description"      = EXCLUDED."description",
    "defaultSeverity"  = EXCLUDED."defaultSeverity",
    "isEnabledDefault" = EXCLUDED."isEnabledDefault",
    "paramsSchema"     = EXCLUDED."paramsSchema",
    "version"          = EXCLUDED."version";

-- The previous master-data migration described its rule rows generically
-- ("Project Product is set to 'Other'/'Others'."). Refresh the wording so
-- the description matches the engine's new comma-aware detection
-- ("Other, SAP Emarsys" now also fires the rule). Idempotent — only the
-- description and name change here, severity / category stay.
UPDATE "AuditRule"
SET
    "name" = 'Project Product "Others" needs review',
    "description" = 'Project Product contains the literal token "Other" / "Others" — alone or alongside other entries (e.g. "Other, SAP Emarsys"). Treated as a manual review item: the auditor should confirm the actual product or correct the entry.'
WHERE "ruleCode" = 'RUL-MD-PROJECT_PRODUCT-REVIEW-OTHERS';