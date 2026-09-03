import argparse
import psycopg2
from graphviz import Digraph


def fetch_tables(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """)
        return [r[0] for r in cur.fetchall()]


def fetch_columns(conn, table):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
        """, (table,))
        return cur.fetchall()


def fetch_primary_keys(conn, table):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_schema = 'public' AND tc.table_name = %s
              AND tc.constraint_type = 'PRIMARY KEY'
        """, (table,))
        return {r[0] for r in cur.fetchall()}


def fetch_foreign_keys(conn):
    """Returns list of (from_table, from_col, to_table, to_col)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                tc.table_name, kcu.column_name,
                ccu.table_name AS foreign_table,
                ccu.column_name AS foreign_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        """)
        return cur.fetchall()


def build_erd(conn, output_path):
    dot = Digraph("RideSync_ERD", format="png")
    dot.attr(rankdir="LR", fontsize="10")
    dot.attr("node", shape="plaintext")

    tables = fetch_tables(conn)

    for table in tables:
        cols = fetch_columns(conn, table)
        pks = fetch_primary_keys(conn, table)

        rows = ""
        for col_name, data_type, nullable in cols:
            marker = "PK" if col_name in pks else ""
            rows += (
                f'<TR><TD ALIGN="LEFT">{col_name}</TD>'
                f'<TD ALIGN="LEFT">{data_type}</TD>'
                f'<TD>{marker}</TD></TR>'
            )

        label = f'''<
        <TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="4">
          <TR><TD COLSPAN="3" BGCOLOR="lightgrey"><B>{table}</B></TD></TR>
          {rows}
        </TABLE>>'''

        dot.node(table, label=label)

    for from_table, from_col, to_table, to_col in fetch_foreign_keys(conn):
        dot.edge(from_table, to_table, label=f"{from_col} -> {to_col}")

    dot.render(output_path, cleanup=True)
    print(f"ERD written to {output_path}.png")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsn", required=True)
    parser.add_argument("--out", default="docs/relational_erd")
    args = parser.parse_args()

    conn = psycopg2.connect(args.dsn)
    try:
        build_erd(conn, args.out)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
