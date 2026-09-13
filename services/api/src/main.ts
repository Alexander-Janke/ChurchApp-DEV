import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApp, getPort } from "./configure-app.js";

async function bootstrap(): Promise<void> {
  const port = getPort();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app);
  try {
    await app.listen(port, "0.0.0.0");
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  Logger.error(
    "API startup failed; check configuration and port availability",
    "Bootstrap",
  );
  process.exitCode = 1;
});
