-- Forge Handyman — Stage 14 (Phase B1) fix: customer_summary.property_count
--
-- The original property_count `count(distinct lower(btrim(j.address)))`
-- diverged from the in-memory deriveProperties/normalizeAddress
-- (lib/data/pg/customers.ts) in two ways, producing a same-page contradiction
-- between the header/list "Properties" count and the profile's
-- PropertiesSection:
--   1. It counted blank addresses. jobs.address is `text not null default ''`,
--      so an empty address is '' (not NULL); count(distinct) only excludes
--      NULL, so a blank-address job counted as a property. deriveProperties
--      skips blanks (`if (key === '') continue`).
--   2. It did not collapse internal whitespace. normalizeAddress does
--      `.replace(/\s+/g, ' ')`, so '123  Main St' and '123 Main St' are one
--      property in-memory but two in the old view.
--
-- Mirror normalizeAddress exactly: lower + btrim + collapse internal whitespace
-- runs, and a FILTER that drops empty/whitespace-only addresses.

create or replace view customer_summary as
select c.id, c.name, c.phone, c.email, c.notes, c.anonymized_at, c.created_at,
       count(j.id)                          as job_count,
       max(j.submitted_at)                  as last_job_at,
       min(j.submitted_at)                  as first_job_at,
       coalesce(sum(j.deposit_paid_cents),0) as deposits_collected_cents,
       count(distinct regexp_replace(lower(btrim(j.address)), '\s+', ' ', 'g'))
         filter (where btrim(j.address) <> '') as property_count
from customers c left join jobs j on j.customer_id = c.id
group by c.id;
