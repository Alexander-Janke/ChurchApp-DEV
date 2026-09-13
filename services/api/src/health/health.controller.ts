import {
  HEALTH_RESPONSE,
  type HealthResponse,
} from "@church-platform/contracts";
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return HEALTH_RESPONSE;
  }
}
