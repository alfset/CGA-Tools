import { loadEnvConfig } from "@next/env";
import { GovernanceScraper } from "../lib/scraper/governance-scraper";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const scraper = new GovernanceScraper();

  if (hasFlag("--once")) {
    const result = await scraper.runOnce();
    console.log(
      JSON.stringify(
        {
          mode: "once",
          snapshotId: result.snapshot.id,
          generatedAt: result.analytics.generatedAt,
          proposals: result.analytics.proposalCount,
          votes: result.analytics.voteCount
        },
        null,
        2
      )
    );
    return;
  }

  if (hasFlag("--daemon")) {
    const interval = Number(process.env.SCRAPER_INTERVAL_MS || 300000);
    console.log(`[scraper] daemon started interval=${interval}ms`);
    await scraper.runDaemon(interval);
    return;
  }

  console.log("Usage: tsx scripts/run-scraper.ts --once | --daemon");
}

main().catch((error) => {
  console.error("[scraper] fatal", error);
  process.exit(1);
});
