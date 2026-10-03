import { seedDatabase } from "@/lib/seed";
import { db } from "@/lib/db";

seedDatabase()
  .then((res) => {
    console.log("✔", res.message);
    return db.$disconnect();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
