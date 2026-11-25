-- 025: automatically create a principal branch for every new business.
-- Keeps delivery available for businesses created after migration 024.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_create_default_branch_for_business()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.app_branches(business_id,code,name,is_main,active)
  VALUES(NEW.id,'CENTRAL','Casa central',TRUE,TRUE)
  ON CONFLICT(business_id,code) DO NOTHING;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS app_business_default_branch_trigger ON public.businesses;
CREATE TRIGGER app_business_default_branch_trigger
AFTER INSERT ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.app_create_default_branch_for_business();

INSERT INTO schema_migrations(version)
VALUES('025_default_branch_on_business_create')
ON CONFLICT(version) DO NOTHING;

COMMIT;
