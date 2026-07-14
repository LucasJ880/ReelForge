import { PrismaClient } from "@prisma/client";

/** Bump when schema changes so dev HMR does not keep a stale PrismaClient. */
const PRISMA_CLIENT_GENERATION = "20260713_phase2_provider_submission_integrity";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaGeneration?: string;
};

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });
}

if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.prisma &&
  globalForPrisma.prismaGeneration !== PRISMA_CLIENT_GENERATION
) {
  void globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

export const db =
  globalForPrisma.prisma ??
  (() => {
    const client = createPrismaClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client;
      globalForPrisma.prismaGeneration = PRISMA_CLIENT_GENERATION;
    }
    return client;
  })();
