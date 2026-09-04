
## Setup:
- Install `uv`
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- For visualization of schema:
  ```bash
  uv run docs/generate_erd.py --dsn "postgresql://user:pass@localhost:5432/ridesync"
  ```
  or
  ```bash
  source .venv/bin/activate
  ./docs/generate_erd.py --dsn "postgresql://user:pass@localhost:5432/ridesync"
  ```

to run the seeder, use the following command:
``` python data_generation/postgres_seeder.py --dsn postgres://username:password@localhost:5432/ridesync```