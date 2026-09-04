
--  partial unique index prohibiting a rider from
-- being in multiple active trips (only allow one active trip per rider i.e. any number of completed but only either one requested or in transit status per rider)

CREATE UNIQUE INDEX idx_active_rider_trip
ON trips (rider_id)
WHERE status IN ('REQUESTED', 'IN TRANSIT');



CREATE INDEX idx_trips_rider_id   ON trips (rider_id);
CREATE INDEX idx_trips_vehicle_id ON trips (vehicle_id);

CREATE INDEX idx_trips_completed_vehicle_date
    ON trips (vehicle_id, created_at)
    INCLUDE (fare_amount)
    WHERE status = 'COMPLETED';


