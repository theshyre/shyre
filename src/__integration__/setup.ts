import dotenv from "dotenv";
import path from "path";

// Load .env.local FIRST — before any module reads process.env.
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
