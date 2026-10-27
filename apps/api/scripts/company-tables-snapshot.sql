-- Read-only. Row count and checksum per table, for the company tables
-- migration (20261027120000_add_companies_modules_access).
--
-- Run it right before merging and again once the deploy is healthy. The ALL
-- row on top covers every table below it, so if ALL matches, nothing changed.
-- The new brandId column is left out of the checksum, so phone_numbers and
-- campaigns match even though the migration fills it.
--
-- Run it at a quiet time: a text, call or note that lands between the two
-- runs changes messages, call_logs, leads or notes for a real reason.
WITH t AS (
  SELECT 'organizations' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "organizations" x
  UNION ALL
  SELECT 'users' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "users" x
  UNION ALL
  SELECT 'leads' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "leads" x
  UNION ALL
  SELECT 'phone_numbers' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "phone_numbers" x
  UNION ALL
  SELECT 'campaigns' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "campaigns" x
  UNION ALL
  SELECT 'campaign_steps' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "campaign_steps" x
  UNION ALL
  SELECT 'campaign_enrollments' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "campaign_enrollments" x
  UNION ALL
  SELECT 'campaign_message_logs' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "campaign_message_logs" x
  UNION ALL
  SELECT 'messages' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "messages" x
  UNION ALL
  SELECT 'call_logs' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "call_logs" x
  UNION ALL
  SELECT 'notes' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "notes" x
  UNION ALL
  SELECT 'tasks' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "tasks" x
  UNION ALL
  SELECT 'activities' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "activities" x
  UNION ALL
  SELECT 'emails' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "emails" x
  UNION ALL
  SELECT 'web_inquiries' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "web_inquiries" x
  UNION ALL
  SELECT 'surplus_counties' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_counties" x
  UNION ALL
  SELECT 'surplus_details' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_details" x
  UNION ALL
  SELECT 'surplus_documents' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_documents" x
  UNION ALL
  SELECT 'surplus_expenses' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_expenses" x
  UNION ALL
  SELECT 'surplus_heirs' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_heirs" x
  UNION ALL
  SELECT 'surplus_letters' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_letters" x
  UNION ALL
  SELECT 'surplus_poll_runs' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_poll_runs" x
  UNION ALL
  SELECT 'surplus_references' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_references" x
  UNION ALL
  SELECT 'surplus_social_profiles' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_social_profiles" x
  UNION ALL
  SELECT 'surplus_suppressions' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_suppressions" x
  UNION ALL
  SELECT 'surplus_templates' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_templates" x
  UNION ALL
  SELECT 'surplus_trace_attempts' AS tbl, count(*) AS n,
         md5(coalesce(string_agg(md5((to_jsonb(x) - 'brandId')::text), '' ORDER BY x."id"), '')) AS checksum
  FROM "surplus_trace_attempts" x
)
SELECT tbl, n, checksum FROM (
  SELECT 0 AS pos, 'ALL' AS tbl, sum(n) AS n,
         md5(string_agg(tbl || ':' || n || ':' || checksum, '|' ORDER BY tbl)) AS checksum
  FROM t
  UNION ALL
  SELECT 1, tbl, n, checksum FROM t
) s
ORDER BY pos, tbl;
