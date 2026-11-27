-- 051: separate the four expansion modules from the three core license tiers.
-- Existing issued licenses and business data remain unchanged.
BEGIN;

UPDATE app_module_catalog
SET commercial_mode='addon',
    updated_at=NOW()
WHERE module_key IN ('branches','delivery','receivables');

-- Official MATTSYSTEM acquisition and monthly prices (configuration is quoted separately).
UPDATE app_license_plan_settings
SET setup_amount=CASE plan_key
      WHEN 'basic' THEN 1200000
      WHEN 'professional' THEN 1500000
      WHEN 'enterprise' THEN 2000000
      ELSE setup_amount
    END,
    monthly_amount=CASE plan_key
      WHEN 'basic' THEN 120000
      WHEN 'professional' THEN 200000
      WHEN 'enterprise' THEN 260000
      ELSE monthly_amount
    END,
    updated_at=NOW()
WHERE plan_key IN ('basic','professional','enterprise');

-- Keep only core modules inside Basic, Professional and Enterprise plan definitions.
-- Add-ons are contracted and enabled independently per business.
UPDATE app_license_plan_settings p
SET modules = COALESCE((
  SELECT jsonb_agg(item.value ORDER BY item.ordinality)
  FROM jsonb_array_elements_text(p.modules) WITH ORDINALITY AS item(value,ordinality)
  JOIN app_module_catalog m ON m.module_key=item.value
  WHERE m.commercial_mode='core' AND m.active=TRUE AND m.implemented=TRUE
), '[]'::jsonb),
updated_at=NOW()
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(p.modules) item(value)
  JOIN app_module_catalog m ON m.module_key=item.value
  WHERE m.commercial_mode='addon'
);

INSERT INTO schema_migrations(version)
VALUES ('051_separate_license_tiers_and_addons')
ON CONFLICT(version) DO NOTHING;

COMMIT;
