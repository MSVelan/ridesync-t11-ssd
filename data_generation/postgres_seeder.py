import argparse
import random

import psycopg2
from psycopg2.extras import execute_batch

from faker import Faker
from psycopg2.extras import execute_values
from tqdm import trange, tqdm

fake = Faker()
Faker.seed(42)


def clear_tables(cur):
    cur.execute(
        "TRUNCATE trips, wallet_audit_logs, vehicles, riders "
        "RESTART IDENTITY CASCADE"
    )


def insert_riders(cur, count=10000):
    riders = [
        (
            fake.name(),
            fake.pydecimal(min_value=100, max_value=50000, right_digits=2),
        )
        for _ in trange(count, desc="Generating riders")
    ]
    execute_values(
        cur,
        "INSERT INTO riders (name, wallet_balance) VALUES %s",
        riders,
    )

    cur.execute("SELECT id FROM riders ORDER BY id")
    return [row[0] for row in cur.fetchall()]


def insert_vehicles(cur, count=2000):
    vehicles = [
        (
            f"{fake.license_plate()}-{i:05d}"[:20],
            random.choice(["ECONOMY", "PREMIUM", "SUV", "AUTO"]),
            fake.boolean(chance_of_getting_true=75),
        )
        for i in trange(count, desc="Generating vehicles")
    ]
    execute_values(
        cur,
        "INSERT INTO vehicles (license_plate, class, is_active) VALUES %s",
        vehicles,
    )

    cur.execute("SELECT id FROM vehicles ORDER BY id")
    return [row[0] for row in cur.fetchall()]


def insert_trips(cur, rider_ids, vehicle_ids, count=100000):
    
    trips = []
    in_progress = set()

    for _ in trange(count, desc="Generating trips"):
        rider_id = random.choice(rider_ids)
        status = random.choice(["REQUESTED", "IN TRANSIT", "COMPLETED"])
        if status in ("REQUESTED", "IN TRANSIT"):
            if rider_id in in_progress:
                status = "COMPLETED"
            else:
                in_progress.add(rider_id)

        trips.append((
            rider_id,
            random.choice(vehicle_ids),
            fake.pydecimal(min_value=100, max_value=3000, right_digits=2),
            status,
            fake.date_time_between(start_date="-30d", end_date="now"),
        ))

    execute_values(
        cur,
        """
        INSERT INTO trips
            (rider_id, vehicle_id, fare_amount, status, created_at)
        VALUES %s
        """,
        trips,
    )

    return trips

def simulate_wallet_activity(cur, rider_ids, trips, batch_size=1000):
    cur.execute("SELECT id, wallet_balance FROM riders")
    balances = dict(cur.fetchall())

    # 1. Top-ups
    topup_riders = random.sample(rider_ids, k=len(rider_ids) // 5)
    topup_params = []
    for rider_id in topup_riders:
        amt = fake.pydecimal(min_value=50, max_value=2000, right_digits=2)
        balances[rider_id] += amt
        topup_params.append((amt, rider_id))

    execute_batch(
        cur,
        "UPDATE riders SET wallet_balance = wallet_balance + %s WHERE id = %s",
        topup_params,
        page_size=batch_size,
    )

    # 2. Trip-fare debits (with top-up-if-short logic preserved)
    completed_trips = [t for t in trips if t[3] == "COMPLETED"]
    debit_params = []
    for rider_id, _vehicle_id, fare_amount, _status, _created_at in completed_trips:
        if balances[rider_id] < fare_amount:
            shortfall = fare_amount - balances[rider_id]
            topup_amount = shortfall + fake.pydecimal(min_value=10, max_value=200, right_digits=2)
            execute_batch(
                cur,
                "UPDATE riders SET wallet_balance = wallet_balance + %s WHERE id = %s",
                [(topup_amount, rider_id)],
                page_size=1,
            )
            balances[rider_id] += topup_amount

        debit_params.append((fare_amount, rider_id))
        balances[rider_id] -= fare_amount

    execute_batch(
        cur,
        "UPDATE riders SET wallet_balance = wallet_balance - %s WHERE id = %s",
        debit_params,
        page_size=batch_size,
    )



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsn", required=True)
    args = parser.parse_args()

    conn = psycopg2.connect(args.dsn)
    try:
        cur = conn.cursor()

        clear_tables(cur)
        conn.commit()

        rider_ids = insert_riders(cur)
        conn.commit()

        vehicle_ids = insert_vehicles(cur)
        conn.commit()

        trips = insert_trips(cur, rider_ids, vehicle_ids)
        conn.commit()

        simulate_wallet_activity(cur, rider_ids, trips)
        conn.commit()
    finally:
        conn.close()

    print("Data inserted successfully.")


if __name__ == "__main__":
    main()


# to run the seeder, use the following command:
# in bash, do `set -a`, `source .env`, `set +a`
# python data_generation/postgres_seeder.py --dsn "$NEON_DSN"