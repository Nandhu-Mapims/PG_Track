import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import mongoose from "mongoose";
import dns from "node:dns";
import { apiRateLimit } from "./middleware";
import { apiRouter } from "./routes";

dotenv.config();

const app: Application = express();

app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(apiRateLimit);

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/pg_tracking";
const PORT = process.env.PORT || 4000;
const DNS_SERVERS = (process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});
app.use("/api", apiRouter);

// Global error handler placeholder
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

async function start() {
  try {
    if (DNS_SERVERS.length > 0) {
      dns.setServers(DNS_SERVERS);
      console.log(`DNS servers configured: ${DNS_SERVERS.join(", ")}`);
    }

    try {
      await mongoose.connect(MONGO_URI);
      console.log("Connected to MongoDB");
    } catch (dbError) {
      console.warn("MongoDB unavailable; server started without database connectivity", dbError);
    }

    app.listen(PORT, () => {
      console.log(`Backend API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

void start();

