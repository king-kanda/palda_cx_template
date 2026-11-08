import { runScenarios } from "../src/eval";
import { SCENARIOS } from "../src/scenarios";

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.find((arg) => arg.startsWith("--only="))?.split("=")[1];
  const scenarios = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`No scenarios matched ${only ?? "(all)"}.`);
    process.exit(1);
  }

  console.log(`Running ${scenarios.length} agent scenario(s) in deterministic mock mode…\n`);
  const results = await runScenarios(scenarios);

  let failures = 0;
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status}  ${result.id.padEnd(26)} ${result.name}`);
    console.log(`      tools: ${result.toolCalls.join(", ") || "(none)"}`);
    console.log(
      `      flagged=${result.flagged} approvals=${result.pendingApprovals} handoff=${result.handoff} ${result.latencyMs}ms`,
    );
    if (!result.passed) {
      failures += 1;
      for (const failure of result.failures) console.log(`      ✗ ${failure}`);
      console.log(`      reply: ${result.text}`);
    }
  }

  console.log(`\n${results.length - failures}/${results.length} passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Eval runner crashed:", error);
  process.exit(1);
});
