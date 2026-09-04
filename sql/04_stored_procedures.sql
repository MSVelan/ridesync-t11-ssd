CREATE OR REPLACE PROCEDURE sp_atomic_booking(
    p_rider_id INT,
    p_vehicle_id INT,
    p_fare_amount DECIMAL(10,2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_balance DECIMAL(10,2);
BEGIN
    -- Validate fare
    IF p_fare_amount <= 0 THEN
        RAISE EXCEPTION 'Fare amount must be greater than zero';
    END IF;

    -- Lock rider row and read wallet balance
    SELECT wallet_balance
    INTO v_balance
    FROM riders
    WHERE id = p_rider_id
    FOR UPDATE;

    -- Check rider exists
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rider % does not exist', p_rider_id;
    END IF;

    -- Check sufficient balance
    IF v_balance < p_fare_amount THEN
        RAISE EXCEPTION
            'Insufficient wallet balance. Balance: %, Fare: %',
            v_balance, p_fare_amount;
    END IF;

    -- Deduct fare
    UPDATE riders
    SET wallet_balance = wallet_balance - p_fare_amount
    WHERE id = p_rider_id;

    -- Create trip
    INSERT INTO trips (
        rider_id,
        vehicle_id,
        fare_amount,
        status
    )
    VALUES (
        p_rider_id,
        p_vehicle_id,
        p_fare_amount,
        'REQUESTED'
    );
END;
$$;