import { pino } from "pino";
import { env } from "./config/env.js";

export const logger = pino({
  level: env.isTest ? "silent" : env.logLevel,
  // Keep JSON in production (the cluster ships logs as-is); readable locally.
  ...(env.isProduction
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});
