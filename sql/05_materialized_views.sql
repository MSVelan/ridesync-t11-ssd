CREATE MATERIALIZED VIEW mv_vehicle_earnings AS
SELECT
    v.id AS vehicle_id, v.license_plate, v.class,
    COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED') AS lifetime_trip_count,
    COALESCE(SUM(t.fare_amount) FILTER (WHERE t.status = 'COMPLETED'), 0) AS lifetime_earnings
FROM vehicles v
LEFT JOIN trips t ON t.vehicle_id = v.id
GROUP BY v.id, v.license_plate, v.class
WITH NO DATA;

-- REFRESH CONCURRENTLY requires a unique index to not lock readers
CREATE UNIQUE INDEX idx_mv_vehicle_earnings_vehicle_id ON mv_vehicle_earnings (vehicle_id);
REFRESH MATERIALIZED VIEW mv_vehicle_earnings;

-- ongoing refreshes go through this, so the view can be
-- rebuilt without locking out readers
CREATE OR REPLACE FUNCTION fn_refresh_vehicle_earnings()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_vehicle_earnings;
END;
$$ LANGUAGE plpgsql;