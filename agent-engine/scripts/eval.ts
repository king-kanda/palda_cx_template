import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runScenarios, type ScenarioResult } from "../src/eval";
import { OpenRouterAdapter } from "../src/llm";
import { SCENARIOS } from "../src/scenarios";

/**
 * Agent evals.
 *   pnpm eval:mock                 deterministic: replays each scenario's scripted plan. Free, offline, exact. Tests the engine's guards.
 *   pnpm eval                      real model: the model chooses tools and writes replies against scripted tool results. Needs
 *                                  OPENROUTER_API_KEY and a real model (WAMBO_MODEL, or --model=<id>). Costs a few cents.
 * Flags: --only=<scenario id>  --runs=<n> (live only: repeat each scenario, default 1)  --model=<openrouter model id>
 *
 * Live runs: a safety failure (forbidden tool called, forbidden text said) always fails. Wording or tool-choice differences are
 * reported as warnings because real models phrase things differently.
 */

for (const candidate of ["../.env", "../../.env", ".env"]) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    process.loadEnvFile(path); // does not override variables already set
    break;
  }
}

function flag(name: string): string | undefined {
  return process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}
const has = (name: string) => process.argv.slice(2).includes(`--${name}`);

async function main() {
  const live = has("real") || !has("mock");
  const only = flag("only");
  const scenarios = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`No scenarios matched ${only ?? "(all)"}.`);
    process.exit(1);
  }

  let adapter: OpenRouterAdapter | undefined;
  let model: string | undefined;
  if (live) {
    const envModel = process.env.WAMBO_MODEL;
    model = flag("model") ?? (envModel && envModel !== "mock" ? envModel : undefined);
    if (!process.env.OPENROUTER_API_KEY) {
      console.error("A real-model eval needs OPENROUTER_API_KEY in .env. For the offline replay run: pnpm eval:mock");
      process.exit(2);
    }
    if (!model) {
      console.error('WAMBO_MODEL is "mock". Set a real model id in .env (e.g. openai/gpt-4.1-mini) or pass --model=<id>.');
      process.exit(2);
    }
    adapter = new OpenRouterAdapter({ model, temperature: 0 });
  }

  const runs = live ? Math.max(1, Number(flag("runs") ?? 1) || 1) : 1;
  console.log(
    live
      ? `Running ${scenarios.length} scenario(s) x${runs} against ${model} (real model, scripted tool results)…\n`
      : `Running ${scenarios.length} agent scenario(s) in deterministic mock mode…\n`,
  );

  const all: ScenarioResult[][] = [];
  for (let i = 0; i < runs; i += 1) all.push(await runScenarios(scenarios, adapter ? { adapter, model } : {}));

  let hardFailures = 0;
  let warnings = 0;
  scenarios.forEach((scenario, index) => {
    const results = all.map((run) => run[index]!);
    const passed = results.filter((r) => r.passed).length;
    const safety = results.flatMap((r) => r.safetyFailures);
    const soft = results.flatMap((r) => r.failures.filter((f) => !r.safetyFailures.includes(f)));
    const ok = passed === results.length;
    if (!ok) hardFailures += 1;
    else if (live && soft.length) warnings += 1;
    const status = !ok ? "FAIL" : live && soft.length ? "WARN" : "PASS";
    const last = results[results.length - 1]!;
    console.log(`${status}  ${scenario.id.padEnd(30)} ${scenario.name}${runs > 1 ? `  (${passed}/${runs})` : ""}`);
    console.log(`      tools: ${last.toolCalls.join(", ") || "(none)"}`);
    if (!ok || (live && soft.length)) {
      for (const failure of new Set([...safety, ...soft])) console.log(`      ${safety.includes(failure) ? "✗" : "~"} ${failure}`);
      console.log(`      reply: ${last.text}`);
    }
  });

  const total = scenarios.length;
  console.log(
    `\n${total - hardFailures}/${total} passed${live ? ` (${warnings} with wording or tool-choice differences worth a look)` : ""}.`,
  );
  process.exit(hardFailures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Eval runner crashed:", error);
  process.exit(1);
});
