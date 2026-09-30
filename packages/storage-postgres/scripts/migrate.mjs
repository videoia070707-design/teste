import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const MIGRATION_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/i;
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../../../database/", import.meta.url));

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const migrationsDir = process.env.MIGRATIONS_DIR?.trim() || DEFAULT_MIGRATIONS_DIR;
  const migrations = await loadMigrations(migrationsDir);

  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${migrationsDir}.`);
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15
  });

  try {
    await sql.begin(async (tx) => {
      // Transaction-scoped lock serializes schema changes across concurrent deploys.
      await tx`select pg_advisory_xact_lock(618002, 1)`;

      await tx`create schema if not exists app_private`;
      await tx`
        create table if not exists app_private.schema_migrations (
          version text primary key,
          checksum_sha256 text not null,
          applied_at timestamptz not null default now()
        )
      `;

      const appliedRows = await tx`
        select version, checksum_sha256
        from app_private.schema_migrations
        order by version asc
      `;
      const applied = new Map(appliedRows.map((row) => [row.version, row.checksum_sha256]));

      for (const migration of migrations) {
        const recordedChecksum = applied.get(migration.version);

        if (recordedChecksum) {
          if (recordedChecksum !== migration.checksum) {
            throw new Error(
              `Migration ${migration.version} changed after application. ` +
              `Expected ${recordedChecksum}, found ${migration.checksum}. Add a new migration instead.`
            );
          }

          console.log(`[migrate] skip ${migration.version}`);
          continue;
        }

        console.log(`[migrate] apply ${migration.version}`);
        await tx.unsafe(migration.sql);
        await tx`
          insert into app_private.schema_migrations (version, checksum_sha256)
          values (${migration.version}, ${migration.checksum})
        `;
      }
    });

    console.log(`[migrate] complete: ${migrations.length} files verified`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function loadMigrations(directory) {
  const filenames = (await readdir(directory))
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(filenames.map(async (filename) => {
    const path = `${directory.replace(/\/$/, "")}/${filename}`;
    const content = await readFile(path, "utf8");
    return {
      version: filename,
      checksum: createHash("sha256").update(content).digest("hex"),
      sql: content
    };
  }));
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  console.error("[migrate] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
