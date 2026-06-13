-- Forge Handyman — Stage 14 (Phase B1): customer_summary view
-- See docs/stage-14-crm-interface-design.md ("B1 — data layer").
--
-- A read-only aggregate the CRM list/profile/stats surfaces read from instead
-- of scanning listJobs() in memory. One row per customer (GROUP BY c.id), with
-- the per-customer job rollups the customer list + stats need:
--   * job_count               — total jobs for the customer
--   * last_job_at/first_job_at — most-recent / first submitted_at
--   * deposits_collected_cents — sum(deposit_paid_cents) (B1's honest
--                                "Deposits collected" figure; true LTV is B2)
--   * property_count           — distinct normalized addresses (landlords have
--                                one email, many addresses)
--
-- LEFT JOIN so customers with zero jobs still appear (job_count = 0). The
-- mapper layer (lib/data/pg/customers.ts) coerces every value to the
-- all-strings discipline; this view's job is the SQL aggregate only.

create view customer_summary as
select c.id, c.name, c.phone, c.email, c.notes, c.anonymized_at, c.created_at,
       count(j.id)                          as job_count,
       max(j.submitted_at)                  as last_job_at,
       min(j.submitted_at)                  as first_job_at,
       coalesce(sum(j.deposit_paid_cents),0) as deposits_collected_cents,
       count(distinct lower(btrim(j.address))) as property_count
from customers c left join jobs j on j.customer_id = c.id
group by c.id;
