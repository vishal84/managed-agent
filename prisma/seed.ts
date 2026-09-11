import "dotenv/config";
import { env } from "../frontend/src/lib/env";
import { prisma } from "../frontend/src/lib/prisma";

async function main() {
  const emails = env.managerEmails();
  if (emails.length === 0) {
    console.log("MANAGER_EMAILS is empty; nothing to promote.");
    return;
  }
  const { count } = await prisma.user.updateMany({ where: { email: { in: emails } }, data: { role: "MANAGER" } });
  console.log(`Promoted ${count} existing user(s) to MANAGER. Users who sign in later with one of these emails are promoted automatically.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
