import { copyFile } from "node:fs/promises";

await copyFile("cloudflare/pages-worker.js", "dist/_worker.js");
