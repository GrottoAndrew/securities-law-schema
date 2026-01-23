#!/bin/bash
set -e

echo "========================================"
echo "Securities Law Schema - Docker Entrypoint"
echo "========================================"

# Wait for PostgreSQL to be ready
if [ -n "$DATABASE_URL" ]; then
  echo "Waiting for PostgreSQL..."

  # Extract host and port from DATABASE_URL
  # Format: postgresql://user:pass@host:port/db
  DB_HOST=$(echo "$DATABASE_URL" | sed -E 's/.*@([^:]+):.*/\1/')
  DB_PORT=$(echo "$DATABASE_URL" | sed -E 's/.*:([0-9]+)\/.*/\1/')

  # Default port if not specified
  DB_PORT=${DB_PORT:-5432}

  # Wait up to 30 seconds for PostgreSQL
  for i in {1..30}; do
    if pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; then
      echo "PostgreSQL is ready!"
      break
    fi
    echo "Waiting for PostgreSQL... ($i/30)"
    sleep 1
  done

  # Run migrations
  echo "Running database migrations..."
  node scripts/db/migrate.js

  # Seed data if SEED_DATA is set and database is empty
  if [ "$SEED_DATA" = "true" ]; then
    echo "Checking if database needs seeding..."
    EVIDENCE_COUNT=$(node -e "
      import('pg').then(pg => {
        const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT COUNT(*) as count FROM evidence')
          .then(r => { console.log(r.rows[0].count); pool.end(); })
          .catch(() => { console.log('0'); pool.end(); });
      });
    " 2>/dev/null || echo "0")

    if [ "$EVIDENCE_COUNT" = "0" ]; then
      echo "Seeding database with demo data..."
      node scripts/seed-demo-data.js --sql | psql "$DATABASE_URL"
      echo "Seeded database with 200+ evidence records"
    else
      echo "Database already has $EVIDENCE_COUNT evidence records, skipping seed"
    fi
  fi
else
  echo "No DATABASE_URL set - using in-memory storage"
fi

echo "Starting API server..."
exec node src/api/server.js
