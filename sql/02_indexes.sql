
--  partial unique index prohibiting a rider from
-- being in multiple active trips (only allow one active trip per rider i.e. any number of completed but only either one requested or in transit status per rider)

CREATE UNIQUE INDEX idx_active_rider_trip
ON trips (rider_id)
WHERE status IN ('REQUESTED', 'IN TRANSIT');