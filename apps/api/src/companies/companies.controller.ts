import { Controller, Get, Req } from '@nestjs/common';
import { AuthUser } from '../auth/jwt-auth.guard';
import { CompaniesService } from './companies.service';

@Controller('companies')
export class CompaniesController {
  constructor(private companies: CompaniesService) {}

  /** The companies the signed-in user can switch between. */
  @Get()
  async mine(@Req() req: { user: AuthUser }) {
    // The guard has already refused a token with no account.
    return this.companies.forUser(req.user.userId, req.user.organizationId as string);
  }
}
