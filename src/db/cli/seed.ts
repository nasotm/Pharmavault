import { runMigrations } from '../migrate';
import { seedDatabase } from '../seed';
import { SqliteWasmAdapter } from '../sqlite-wasm-adapter';

async function main(): Promise<void> {
  const db = await SqliteWasmAdapter.create();
  try {
    await runMigrations(db);
    const result = await seedDatabase(db);
    console.log(
      `Seed complete: inserted ${result.insertedMedications} medication(s), skipped ${result.skippedMedications} existing medication(s).`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
