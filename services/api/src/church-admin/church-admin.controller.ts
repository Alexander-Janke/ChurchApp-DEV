import {
  Controller,
  UseGuards,
  Patch,
  Get,
  Param,
  Body,
  Query,
  Req,
} from "@nestjs/common";
import { ChurchAdminService } from "./church-admin.service.js";
import {
  ChurchAdminGuard,
  ADMIN_ACTOR,
  type AdminRequest,
} from "./church-admin.guard.js";
@Controller("churches/:churchId")
@UseGuards(ChurchAdminGuard)
export class ChurchAdminController {
  constructor(private readonly admin: ChurchAdminService) {}
  @Patch("settings")
  settings(
    @Param("churchId") churchId: string,
    @Req() req: AdminRequest,
    @Body() body: unknown,
  ) {
    return this.admin.updateSettings(churchId, req[ADMIN_ACTOR], body);
  }
  @Get("members")
  members(
    @Param("churchId") churchId: string,
    @Req() req: AdminRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.admin.listMembers(churchId, req[ADMIN_ACTOR], query);
  }
}
