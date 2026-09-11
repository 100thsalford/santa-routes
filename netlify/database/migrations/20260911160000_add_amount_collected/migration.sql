-- Cash collected on a given route on a given night. One figure per
-- route_date (route + date is exactly the granularity collections are
-- reported at) -- feeds the homepage "Total Raised" figure.

ALTER TABLE route_dates ADD COLUMN amount_collected NUMERIC(10, 2);
