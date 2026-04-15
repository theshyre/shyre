#!/usr/bin/env tsx
/**
 * Manual cleanup CLI: `npm run cleanup:test-data`
 * Useful when a test run was killed and left stragglers.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main(): Promise<void> {
  const { cleanupAllTestData, countTestData } = await import("./cleanup");

  const before = await countTestData();
  console.log(`Before cleanup: ${before.teams} test teams, ${before.users} test users`);

  if (before.teams === 0 && before.users === 0) {
    console.log("Nothing to clean up. ✓");
    return;
  }

  console.log("Cleaning up...");
  await cleanupAllTestData();

  const after = await countTestData();
  console.log(`After cleanup: ${after.teams} test teams, ${after.users} test users`);

  if (after.teams > 0 || after.users > 0) {
    console.log("⚠ Some test data remains — may need manual intervention.");
    process.exit(1);
  }

  console.log("Cleanup complete. ✓");
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
