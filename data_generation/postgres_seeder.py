import argparse

import psycopg2
from faker import Faker
from psycopg2.extras import execute_values
from tqdm import trange


fake = Faker()
Faker.seed(42)


def insert_riders(cur, count=10000):
    riders = [
        (
            fake.name(),
            fake.pydecimal(
                min_value=100,
                max_value=50000,
                right_digits=2,
            ),
        )
        for _ in trange(count, desc="Generating riders")
    ]

    execute_values(
        cur,
        "INSERT INTO riders (name, wallet_balance) VALUES %s",
        riders,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsn", required=True)
    args = parser.parse_args()

    conn = psycopg2.connect(args.dsn)

    try:
        cur = conn.cursor()

        insert_riders(cur)

        conn.commit()

        print("Successfully inserted 10,000 riders.")

    finally:
        conn.close()


if __name__ == "__main__":
    main()