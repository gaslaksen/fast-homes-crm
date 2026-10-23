-- Counties write people surname first ("KLARENBEEK, JESSICA"). The old split
-- took the first word as the first name, so these leads were stored as first
-- "KLARENBEEK," and last "JESSICA", and every {{firstName}} greeting went out
-- as "Hi KLARENBEEK,,". This turns those names round and recases all-caps
-- person names, using the same rules as splitOwnerName() and personNameCase()
-- in foreclosure-scoring.util.ts.
--
-- Only the bulk-imported pipelines are touched (surplus, foreclosure, tax sale,
-- probate). Ordinary leads already go through toTitleCase on create. Company
-- names are left exactly as they are. A name already in mixed case is how it
-- was typed and is not recased.
--
-- The helpers live in pg_temp, so they vanish when the migration's session ends.

CREATE FUNCTION pg_temp.dc_name_case(s text) RETURNS text AS $$
DECLARE
  w text;
  out text[] := '{}';
BEGIN
  IF s IS NULL OR btrim(s) = '' THEN RETURN s; END IF;
  IF s ~ '[a-z]' AND s ~ '[A-Z]' THEN RETURN btrim(s); END IF;
  FOREACH w IN ARRAY regexp_split_to_array(initcap(lower(btrim(s))), '\s+') LOOP
    IF w ~ '^Mc[a-z]' THEN
      w := 'Mc' || upper(substr(w, 3, 1)) || substr(w, 4);
    ELSIF w IN ('Ii', 'Iii', 'Iv') THEN
      w := upper(w);
    END IF;
    out := out || w;
  END LOOP;
  RETURN array_to_string(out, ' ');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Returns {first, last} for a whole name, or NULL when it is not surname first.
CREATE FUNCTION pg_temp.dc_turn_round(full_name text) RETURNS text[] AS $$
DECLARE
  surname text;
  given text[];
  kept text[] := '{}';
  tail_words text[] := '{}';
  t text;
  parts text[];
BEGIN
  IF full_name !~ '^[^,]+,\s*\S' THEN RETURN NULL; END IF;
  IF full_name ~* '^(the\s+)?estate\s+of\y' THEN RETURN NULL; END IF;
  IF btrim(substring(full_name from '^[^,]+,\s*(.+)$'))
     ~* '^(SR|JR|II|III|IV|V|ESQ|ET\s*AL|ETAL|ESTATE\s*OF|DECEASED|DECD|EST|ESTATE|TRUSTEE|TR)\.?$' THEN
    RETURN NULL;
  END IF;

  surname := btrim(substring(full_name from '^([^,]+),'));
  given := regexp_split_to_array(btrim(substring(full_name from '^[^,]+,\s*(.+)$')), '[\s,]+');
  FOREACH t IN ARRAY given LOOP
    IF t = '' THEN CONTINUE; END IF;
    IF t ~* '^(SR|JR|II|III|IV|ESQ|ETAL|DECEASED|DECD|EST|ESTATE)\.?$' THEN
      tail_words := tail_words || t;
    ELSE
      kept := kept || t;
    END IF;
  END LOOP;

  parts := kept || regexp_split_to_array(surname, '\s+') || tail_words;
  IF array_length(parts, 1) IS NULL THEN RETURN NULL; END IF;
  RETURN ARRAY[parts[1], coalesce(array_to_string(parts[2:], ' '), '')];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

WITH named AS (
  SELECT
    id,
    "sellerFirstName" AS first_name,
    "sellerLastName" AS last_name,
    pg_temp.dc_turn_round(btrim(coalesce("sellerFirstName", '') || ' ' || coalesce("sellerLastName", ''))) AS turned
  FROM "leads"
  WHERE source IN ('SURPLUS', 'FORECLOSURE', 'TAX_SALE', 'PROBATE')
    AND (coalesce("sellerFirstName", '') || ' ' || coalesce("sellerLastName", ''))
        !~* '\y(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|LP|LLP|LLLP|LTD|TRUST|ASSOCIATION|CHURCH|BANK|PARTNERS|HOLDINGS|PROPERTIES)\y'
),
fixed AS (
  SELECT
    id,
    first_name,
    last_name,
    pg_temp.dc_name_case(coalesce(turned[1], regexp_replace(first_name, ',+$', ''))) AS new_first,
    pg_temp.dc_name_case(coalesce(turned[2], last_name)) AS new_last
  FROM named
)
UPDATE "leads" l
SET "sellerFirstName" = f.new_first,
    "sellerLastName" = f.new_last
FROM fixed f
WHERE l.id = f.id
  AND (f.new_first IS DISTINCT FROM f.first_name OR f.new_last IS DISTINCT FROM f.last_name);
