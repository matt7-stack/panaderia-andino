-- 017: Consent-based reuse terms for custom modules.
-- Stores the customer's explicit choice and the agreed discount on the quotation.
ALTER TABLE app_quotations
  ADD COLUMN IF NOT EXISTS reusable_in_mattsystem BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reuse_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (reuse_discount_percent >= 0 AND reuse_discount_percent <= 100),
  ADD COLUMN IF NOT EXISTS reuse_consent_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reuse_consent_notes TEXT;

COMMENT ON COLUMN app_quotations.reusable_in_mattsystem IS
  'True only when the customer expressly authorizes incorporating the custom module into MATTSYSTEM for resale to other businesses.';
COMMENT ON COLUMN app_quotations.reuse_discount_percent IS
  'One-time development discount granted in exchange for explicit reuse consent; does not discount recurring fees.';
