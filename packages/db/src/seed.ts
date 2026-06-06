import { createHandleFromEnv } from "./client.js";
import { seedSampleData } from "./seedData.js";

async function main() {
  const handle = await createHandleFromEnv();
  await handle.migrate();
  const result = await seedSampleData(handle.db, {
    connectorUrl: process.env.EXAMPLE_CONNECTOR_URL ?? "http://localhost:8787",
    issueApiKey: true,
  });

  console.log("Seed complete.");
  console.log(`  creator tenant : acme-labs (${result.creatorId})`);
  console.log(`  consumer tenant: builder-co (${result.consumerId})`);
  console.log(`  wallet topped up: 10000 credits`);
  if (result.apiKey) console.log(`  API key (save this — shown once): ${result.apiKey}`);

  await handle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
