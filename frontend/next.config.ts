// The app lives in frontend/ but .env stays at the repo root, because prisma/ and scripts/ read
// the same file. Next only looks for .env inside its own project directory, so load the root one
// from the cwd (npm always runs scripts from the repo root). dotenv never overrides a variable
// that is already set in process.env.
import "dotenv/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/adapter-better-sqlite3", "better-sqlite3"],
};

export default nextConfig;
