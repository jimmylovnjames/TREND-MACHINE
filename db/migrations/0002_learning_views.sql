-- Learning-loop foundation: raw counts per template / provider / movement characteristic.
-- Rates are computed in application code together with sample sizes, so that nothing is
-- presented as a conclusion when the data can't support one.

create view template_funnel as
select
  t.id as template_id,
  t.slug,
  t.current_version,
  count(*) filter (where e.name = 'template_impression')   ::int as impressions,
  count(*) filter (where e.name = 'template_view')         ::int as views,
  count(*) filter (where e.name = 'template_selected')     ::int as selections,
  count(*) filter (where e.name = 'upload_completed')      ::int as uploads,
  count(*) filter (where e.name = 'generation_requested')  ::int as generations_requested,
  count(*) filter (where e.name = 'generation_completed')  ::int as generations_completed,
  count(*) filter (where e.name = 'generation_failed')     ::int as generations_failed,
  count(*) filter (where e.name = 'regenerate')            ::int as regenerations,
  count(*) filter (where e.name = 'result_play')           ::int as plays,
  count(*) filter (where e.name = 'download')              ::int as downloads,
  count(*) filter (where e.name = 'share')                 ::int as shares,
  count(*) filter (where e.name = 'share_link_opened')     ::int as share_opens,
  percentile_cont(0.5) within group (order by e.latency_ms) filter (where e.name = 'generation_completed') as p50_latency_ms,
  sum(e.cost_usd) filter (where e.name = 'generation_completed') as completed_cost_usd
from templates t
left join analytics_events e on e.template_id = t.id
group by t.id, t.slug, t.current_version;

create view provider_reliability as
select
  provider_id,
  provider_model,
  count(*)::int as submitted,
  count(*) filter (where status = 'COMPLETED')::int as completed,
  count(*) filter (where status = 'FAILED')::int as failed,
  count(*) filter (where status in ('QUEUED','PROCESSING'))::int as active,
  percentile_cont(0.5) within group (order by extract(epoch from (completed_at - submitted_at))) filter (where status = 'COMPLETED') as p50_seconds,
  percentile_cont(0.9) within group (order by extract(epoch from (completed_at - submitted_at))) filter (where status = 'COMPLETED') as p90_seconds,
  sum(cost_usd) as recorded_cost_usd,
  count(cost_usd)::int as jobs_with_cost
from generation_jobs
where provider_id is not null
group by provider_id, provider_model;

create view generation_errors as
select
  error_code,
  provider_id,
  count(*)::int as occurrences,
  max(failed_at) as last_seen
from generation_jobs
where status = 'FAILED'
group by error_code, provider_id;

-- Designed movement characteristics (choreographer intent, NOT measured) joined with
-- observed funnel counts, so future analysis can relate design to behaviour.
create view characteristic_performance as
select
  c.key as characteristic,
  (c.value)::int as designed_score,
  f.template_id,
  f.views,
  f.generations_requested,
  f.generations_completed,
  f.shares,
  f.downloads
from templates t
join template_versions v on v.template_id = t.id and v.version = t.current_version
cross join lateral jsonb_each_text(v.spec -> 'movement' -> 'designedCharacteristics') c
join template_funnel f on f.template_id = t.id;
