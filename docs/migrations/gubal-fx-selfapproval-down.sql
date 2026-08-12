-- ═══ GUBAL FX — DROP TWO-PERSON APPROVAL — DOWN ═══
BEGIN;

DO $back$
   DECLARE selfapproved int;
   BEGIN
     SELECT COUNT(*) INTO selfapproved
       FROM accounting_fx_rates
      WHERE approved_by IS NOT NULL AND created_by IS NOT NULL AND approved_by = created_by;

     IF selfapproved > 0 THEN
       RAISE EXCEPTION 'التراجع متوقّف: % سعر صرف اعتمده منشئه. أعد اعتمادها بمستخدم آخر أو احذفها قبل إعادة اشتراط الشخصين.', selfapproved;
     END IF;

     ALTER TABLE accounting_fx_rates ADD CONSTRAINT chk_fx_no_self_approval CHECK (
       approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by);
   END $back$;

COMMIT;
