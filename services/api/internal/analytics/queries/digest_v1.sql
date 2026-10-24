-- Analytics digest v1 (MD-141, W13). Versioned in the repository; the API runs it as mg_jobs.
-- Aggregates only. Every query returns (label, n) where n counts distinct subjects (cases or
-- daily pseudonyms); the Go layer suppresses every cell with n < 5 (k-anonymity) before anything
-- leaves the backend. Nothing from a minor family member's case is counted (D-13 revised).
-- Parameters: $1 tenant, $2 from (date, inclusive), $3 to (date, exclusive).

-- name: funnel
SELECT label, n FROM (
  SELECT 1 AS ord, 'plans computed' AS label, count(*)::bigint AS n
    FROM core.plans WHERE tenant_id = $1 AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date < $3::date
  UNION ALL
  SELECT 2, 'cases started', count(*)::bigint
    FROM core.cases WHERE tenant_id = $1 AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date < $3::date
      AND NOT ('for_minor_family_member' = ANY(flags))
  UNION ALL
  SELECT 3, 'LL issued', count(DISTINCT e.case_id)::bigint
    FROM core.case_events e JOIN core.cases c ON c.case_id = e.case_id
    WHERE e.tenant_id = $1 AND e.type = 'll_issued' AND (e.recorded_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date AND (e.recorded_at AT TIME ZONE 'Asia/Kolkata')::date < $3::date
      AND NOT ('for_minor_family_member' = ANY(c.flags))
  UNION ALL
  SELECT 4, 'DL test bookable (day 30)', count(DISTINCT e.case_id)::bigint
    FROM core.case_events e JOIN core.cases c ON c.case_id = e.case_id
    WHERE e.tenant_id = $1 AND e.type = 'dl_unlocked' AND (e.recorded_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date AND (e.recorded_at AT TIME ZONE 'Asia/Kolkata')::date < $3::date
      AND NOT ('for_minor_family_member' = ANY(c.flags))
  UNION ALL
  SELECT 5, 'DL test booked', count(DISTINCT e.case_id)::bigint
    FROM core.case_events e JOIN core.cases c ON c.case_id = e.case_id
    WHERE e.tenant_id = $1 AND e.type = 'slot_booked' AND (e.recorded_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date AND (e.recorded_at AT TIME ZONE 'Asia/Kolkata')::date < $3::date
      AND NOT ('for_minor_family_member' = ANY(c.flags))
  UNION ALL
  SELECT 6, 'DL test passed', count(DISTINCT e.case_id)::bigint
    FROM core.case_events e JOIN core.cases c ON c.case_id = e.case_id
    WHERE e.tenant_id = $1 AND e.type = 'test_passed' AND (e.recorded_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date AND (e.recorded_at AT TIME ZONE 'Asia/Kolkata')::date < $3::date
      AND NOT ('for_minor_family_member' = ANY(c.flags))
) f ORDER BY ord;

-- name: events
SELECT name AS label, count(DISTINCT pseudonym)::bigint AS n
  FROM ops.analytics_events WHERE tenant_id = $1 AND day >= $2::date AND day < $3::date
  GROUP BY name ORDER BY name;

-- name: messages
SELECT n.channel || ' ' || n.status AS label, count(DISTINCT n.applicant_id)::bigint AS n
  FROM msg.notifications n
  LEFT JOIN core.timeline_events t ON t.timeline_event_id = n.timeline_event_id
  LEFT JOIN core.cases c ON c.case_id = t.case_id
  WHERE n.tenant_id = $1 AND (n.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date AND (n.created_at AT TIME ZONE 'Asia/Kolkata')::date < $3::date
    AND (c.case_id IS NULL OR NOT ('for_minor_family_member' = ANY(c.flags)))
  GROUP BY n.channel, n.status ORDER BY 1;
