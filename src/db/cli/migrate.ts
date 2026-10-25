import { runMigrations } from '../migrate';
import { SqliteWasmAdapter } from '../sqlite-wasm-adapter';

async function main(): Promise<void> {
  const db = await SqliteWasmAdapter.create();
  try {
    const result = await runMigrations(db);
    if (result.applied.length > 0) {
      console.log(`Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
    } else {
      console.log(
        `No pending migrations (${result.skipped.length} already applied). Migration run is a no-op.`,
      );
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
