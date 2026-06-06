import { createHandleFromEnv } from "@appbazaar/db";
import { createServer } from "./server.js";
import { createRouterRuntime } from "./wiring.js";

/** Local/standalone entry point. The production target is the Worker entry. */
async function main() {
  const handle = await createHandleFromEnv();
  await handle.migrate();
  const runtime = createRouterRuntime(handle.db);
  const server = createServer({ db: handle.db, runtime });
  const port = Number(process.env.PORT ?? 8888);
  server.listen(port, () => {
    console.log(`appbazaar router listening on http://localhost:${port}`);
    if (!process.env.DATABASE_URL) {
      console.log("(using ephemeral PGlite — set DATABASE_URL for Supabase/Postgres)");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
