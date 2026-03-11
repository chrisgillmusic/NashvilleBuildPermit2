import { PrismaClient } from '@prisma/client';
import { defaultSettings } from '../src/lib/settings';

const prisma = new PrismaClient();

async function main() {
  for (const [key, value] of Object.entries(defaultSettings)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
