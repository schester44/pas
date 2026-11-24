-- The pin is the contract (CLAUDE.md rule 5). An offering's submission is pinned to its candidate
-- releases at start; choosing a quote option narrows the pin once, from the intake release to one
-- of those candidates (PLAN §6.0). Nothing else about the pin may change.
CREATE OR REPLACE FUNCTION submissions_pin_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.form_key IS DISTINCT FROM OLD.form_key OR
     NEW.number IS DISTINCT FROM OLD.number OR
     NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.intake_release_id IS DISTINCT FROM OLD.intake_release_id OR
     NEW.offering_id IS DISTINCT FROM OLD.offering_id OR
     NEW.candidates IS DISTINCT FROM OLD.candidates THEN
    RAISE EXCEPTION 'a submission''s release pin and number are immutable';
  END IF;

  IF NEW.product_release_id IS DISTINCT FROM OLD.product_release_id AND NOT (
    OLD.product_release_id = OLD.intake_release_id AND
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(OLD.candidates) AS candidate
      WHERE candidate->>'productReleaseId' = NEW.product_release_id::text
    )
  ) THEN
    RAISE EXCEPTION 'a submission''s release pin and number are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
