import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.session.findMany({
    where: {
      OR: [
        { workingDirectory: { contains: '1772329531106' } },
        { name: { contains: '内部確認' } }
      ]
    },
    select: {
      id: true,
      name: true,
      workingDirectory: true,
      status: true
    }
  });
  
  console.log(JSON.stringify(sessions, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
