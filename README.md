
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

- Create .env file with contents:
  ```
  NEON_DSN=<public_neon_db_conn_string>
  ATLAS_URI=<public_atlas_db_conn_string>
  ```