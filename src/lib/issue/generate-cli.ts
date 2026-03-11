import { generateWeeklyIssue } from './generate';

async function main(): Promise<void> {
  const result = await generateWeeklyIssue(new Date());
  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
