-- Master Data function audit engine — seed the 11 rule codes that the
-- new per-function engine emits. Idempotent: both this migration and the
-- seed script upsert the same set. Running them out of order is fine.
--
-- The rules are owned by the Master Data function's engine in
-- packages/domain/src/functions-audit/master-data/rules.ts. This SQL is a
-- belt-and-suspenders copy so that a newly-applied migration leaves the
-- AuditRule table ready to accept issues before the app boots its seed.

INSERT INTO "AuditRule" ("id", "ruleCode", "name", "category", "description", "defaultSeverity", "isEnabledDefault", "paramsSchema", "version", "createdAt") VALUES
    ('rule-md-customer-name',          'RUL-MD-CUSTOMER_NAME-MISSING',          'Customer name required',          'Data Quality', 'Customer name must be populated with a real value (not blank, null, "not assigned", "undefined", …).',          'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-end-customer-name',      'RUL-MD-END_CUSTOMER_NAME-MISSING',      'End Customer Name required',      'Data Quality', 'End Customer Name must be populated with a real value (not blank, null, "not assigned", "undefined", …).',      'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-manager',        'RUL-MD-PROJECT_MANAGER-MISSING',        'Project Manager required',        'Data Quality', 'Project Manager must be populated with a real value (not blank, null, "not assigned", "undefined", …).',        'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-country-manager','RUL-MD-PROJECT_COUNTRY_MANAGER-MISSING','Project Country Manager required','Data Quality', 'Project Country Manager must be populated with a real value (not blank, null, "not assigned", "undefined", …).','High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-bu-head',        'RUL-MD-PROJECT_BU_HEAD-MISSING',        'Project BU Head required',        'Data Quality', 'Project BU Head must be populated with a real value (not blank, null, "not assigned", "undefined", …).',        'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-account-manager',        'RUL-MD-ACCOUNT_MANAGER-MISSING',        'Account Manager required',        'Data Quality', 'Account Manager must be populated with a real value (not blank, null, "not assigned", "undefined", …).',        'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-industry',       'RUL-MD-PROJECT_INDUSTRY-MISSING',       'Project Industry required',       'Data Quality', 'Project Industry must be populated with a real value (not blank, null, "not assigned", "undefined", …).',       'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-end-customer-industry',  'RUL-MD-END_CUSTOMER_INDUSTRY-MISSING',  'End Customer Industry required',  'Data Quality', 'End Customer Industry must be populated with a real value (not blank, null, "not assigned", "undefined", …).',  'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-use-case',               'RUL-MD-USE_CASE-MISSING',               'Use Case required',               'Data Quality', 'Use Case must be populated with a real value (not blank, null, "not assigned", "undefined", …).',               'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-product',        'RUL-MD-PROJECT_PRODUCT-MISSING',        'Project Product required',        'Data Quality', 'Project Product must be populated with a real value (not blank, null, "not assigned", "undefined", …).',        'High',   true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW()),
    ('rule-md-project-product-review', 'RUL-MD-PROJECT_PRODUCT-REVIEW-OTHERS',  'Project Product "Others" needs review', 'Needs Review', 'Project Product is set to "Other"/"Others". Treated as a manual review item — the auditor should confirm the actual product or correct the entry.', 'Medium', true, '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, 1, NOW())
ON CONFLICT ("ruleCode") DO UPDATE SET
    "name"             = EXCLUDED."name",
    "category"         = EXCLUDED."category",
    "description"      = EXCLUDED."description",
    "defaultSeverity"  = EXCLUDED."defaultSeverity",
    "isEnabledDefault" = EXCLUDED."isEnabledDefault",
    "paramsSchema"     = EXCLUDED."paramsSchema",
    "version"          = EXCLUDED."version";
