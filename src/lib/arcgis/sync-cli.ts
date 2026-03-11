import { runPermitSync } from './sync';

async function main(): Promise<void> {
  const result = await runPermitSync({ mode: 'full' });
  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
