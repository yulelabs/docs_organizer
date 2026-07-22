import { startOcrWorker } from "./services/jobs.js";

startOcrWorker().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
