-- اختبار 0009: طلبات التجربة لا يصل إليها دور العميل، وتشترط الموافقة.
\set ON_ERROR_STOP 1
DO $$ BEGIN
  BEGIN
    INSERT INTO trial_requests (full_name, company_name, email, consent) VALUES ('س', 'ش', 'a@b.sa', false);
    RAISE EXCEPTION 'request without consent accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
INSERT INTO trial_requests (full_name, company_name, email, consent) VALUES ('سالم', 'شركة', 'a@b.sa', true);
SET ROLE haseef_app;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM trial_requests;
    RAISE EXCEPTION 'client role can read trial requests';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT 'Trial request tests passed';
