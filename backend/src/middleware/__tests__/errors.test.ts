import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, asyncHandler, errorHandler } from "../errors.js";

function appThatThrows(thrown: unknown) {
  const app = express();
  app.get(
    "/boom",
    asyncHandler(async () => {
      throw thrown;
    }),
  );
  app.use(errorHandler());
  return app;
}

describe("errorHandler", () => {
  it("reports a deliberate HttpError with its code", async () => {
    const res = await request(appThatThrows(new HttpError(404, "save_not_found"))).get(
      "/boom",
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "save_not_found" });
  });

  it("turns a Zod failure into a 400 with the issues", async () => {
    const thrown = z.object({ n: z.number() }).safeParse({ n: "no" });
    const res = await request(
      appThatThrows(thrown.success ? new Error("unreachable") : thrown.error),
    ).get("/boom");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.details).toBeInstanceOf(Array);
  });

  it("honours the status Express middleware puts on its errors", async () => {
    // This is how `express.static({ fallthrough: false })` reports a missing
    // file; without this branch a 404 under /static/ would surface as a 500.
    const notFound = Object.assign(new Error("Not Found"), { status: 404 });
    const res = await request(appThatThrows(notFound)).get("/boom");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("hides the details of an unexpected failure", async () => {
    const res = await request(appThatThrows(new Error("connection string leaked"))).get(
      "/boom",
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal_error" });
  });
});
