import type { Request, Response, NextFunction } from "express";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";

export function configureApp(app: NestExpressApplication): void {
  app.disable("x-powered-by");
  // Native auth throttling can return before endpoint hooks execute.
  app.use(
    ["/api/v1/auth/social/google", "/api/v1/google"],
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
      disableErrorMessages: true,
    }),
  );
}

export function getPort(value = process.env.PORT): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}
