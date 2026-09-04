-- Workflow 2: 7-day moving average of fare revenue per vehicle,
-- ranked two ways via DENSE_RANK().

-- Assumption: only COMPLETED trips count as earned revenue.

WITH daily_revenue AS (
   
    SELECT
        vehicle_id,
        created_at::date AS revenue_date,
        SUM(fare_amount)  AS daily_fare
    FROM trips
    WHERE status = 'COMPLETED'
    GROUP BY vehicle_id, created_at::date
),

moving_avg AS (
    
    SELECT
        vehicle_id,
        revenue_date,
        daily_fare,
        ROUND(
            AVG(daily_fare) OVER (
                PARTITION BY vehicle_id
                ORDER BY revenue_date
                ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
            ),
            2
        ) AS moving_avg_7d
    FROM daily_revenue
)

SELECT
    vehicle_id,
    revenue_date,
    daily_fare,
    moving_avg_7d,

    -- which vehicle had the best 7-day average on this day?
    DENSE_RANK() OVER (
        PARTITION BY revenue_date
        ORDER BY moving_avg_7d DESC
    ) AS rank_vehicle_per_day,

    -- which day had the best 7-day average for this vehicle?
    DENSE_RANK() OVER (
        PARTITION BY vehicle_id
        ORDER BY moving_avg_7d DESC
    ) AS rank_day_for_vehicle

FROM moving_avg
ORDER BY vehicle_id, revenue_date;