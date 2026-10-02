import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { SimulatorService } from './modules/simulator/index.js';

/**
 * `pnpm sim --orders 200 --drivers 10 --seed 1`
 * Milestone 1 simulator behind the Milestone 2 script name. Step 7 replaces the body with
 * the Aziziyah world (clock, zones, invariants) and the `--speed` / `--ci` flags.
 */
function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const sim = app.get(SimulatorService);
    const result = await sim.run({
      cityId: 'aziziyah',
      trips: arg('orders', 200),
      drivers: arg('drivers', 10),
      seed: arg('seed', 1),
    });
    console.table(result);
    if (!result.ledgerBalanced) {
      console.error('violation: ledger_not_balanced');
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
