import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ALL_NAMED_THROTTLERS_SKIPPED,
  AUTH_THROTTLER,
} from '../../integrations/throttle/throttler-names';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './services/auth.service';
import { SessionService } from '../session/session.service';
import { SetupGuard } from './guards/setup.guard';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { VerifyUserTokenDto } from './dto/verify-user-token.dto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { validateSsoEnforcement } from './auth.util';
import { ModuleRef } from '@nestjs/core';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { DAuthService } from './services/dauth.service';
import * as crypto from 'crypto';

@SkipThrottle({ ...ALL_NAMED_THROTTLERS_SKIPPED, [AUTH_THROTTLER]: false })
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
    private environmentService: EnvironmentService,
    private dauthService: DAuthService,
    private moduleRef: ModuleRef,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @SkipThrottle({ [AUTH_THROTTLER]: true })
  @Get('dauth')
  async dauthDirect(
    @Query('redirect') redirect: string,
    @Res() res: FastifyReply,
  ) {
    return this.dauthLogin(redirect, res);
  }

  @SkipThrottle({ [AUTH_THROTTLER]: true })
  @Get('dauth/login')
  async dauthLogin(
    @Query('redirect') redirect: string,
    @Res() res: FastifyReply,
  ) {
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');

    res.setCookie('dauth_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.environmentService.isHttps(),
      expires: new Date(Date.now() + 10 * 60 * 1000),
    });

    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      res.setCookie('dauth_redirect', redirect, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: this.environmentService.isHttps(),
        expires: new Date(Date.now() + 10 * 60 * 1000),
      });
    }

    try {
      const authUrl = this.dauthService.getAuthorizationUrl(state, nonce);
      return res.redirect(authUrl, 302);
    } catch (err: any) {
      this.logger.error(`Failed to generate DAuth auth url: ${err.message}`);
      const appUrl = this.environmentService.getAppUrl();
      return res.redirect(
        `${appUrl}/login?error=DAUTH_CONFIG_ERROR&message=${encodeURIComponent(err.message)}`,
        302,
      );
    }
  }

  @SkipThrottle({ [AUTH_THROTTLER]: true })
  @Get('dauth/callback')
  async dauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const appUrl = this.environmentService.getAppUrl();
    const storedState = (req as any).cookies?.['dauth_oauth_state'];
    res.clearCookie('dauth_oauth_state', { path: '/' });

    if (error) {
      const msg = encodeURIComponent(errorDescription || error);
      return res.redirect(
        `${appUrl}/login?error=DAUTH_ERROR&message=${msg}`,
        302,
      );
    }

    if (!code || !state || state !== storedState) {
      this.logger.warn(
        `DAuth callback state mismatch or missing: code=${code}, state=${state}, stored=${storedState}`,
      );
      return res.redirect(
        `${appUrl}/login?error=INVALID_STATE&message=${encodeURIComponent('Invalid OAuth state parameter. Please try again.')}`,
        302,
      );
    }

    let accessToken: string;
    let profile: any;
    try {
      accessToken = await this.dauthService.exchangeCodeForToken(code);
      profile = await this.dauthService.getUserProfile(accessToken);
    } catch (err: any) {
      this.logger.error(
        `DAuth exchange or profile retrieval failed: ${err.message}`,
      );
      return res.redirect(
        `${appUrl}/login?error=AUTH_FAILED&message=${encodeURIComponent(err.message || 'Authentication with DAuth failed')}`,
        302,
      );
    }

    try {
      const result = await this.authService.handleDAuthLogin(profile);
      if (result.allowed === false) {
        return res.redirect(
          `${appUrl}/login?error=NOT_WHITELISTED&email=${encodeURIComponent(result.email)}`,
          302,
        );
      }

      this.setAuthCookie(res, result.authToken);

      const redirectCookie = (req as any).cookies?.['dauth_redirect'];
      res.clearCookie('dauth_redirect', { path: '/' });

      const safeRedirect =
        redirectCookie &&
        redirectCookie.startsWith('/') &&
        !redirectCookie.startsWith('//')
          ? redirectCookie
          : '/home';

      return res.redirect(`${appUrl}${safeRedirect}`, 302);
    } catch (err: any) {
      this.logger.error(`Error logging in DAuth user: ${err.message}`, err);
      return res.redirect(
        `${appUrl}/login?error=AUTH_FAILED&message=${encodeURIComponent(err.message || 'Login failed')}`,
        302,
      );
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login() {
    throw new BadRequestException(
      'Password login is disabled. Please sign in with DAuth.',
    );
  }

  @UseGuards(SetupGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setupWorkspace() {
    throw new BadRequestException(
      'Password setup is disabled. Please sign in with DAuth.',
    );
  }

  @SkipThrottle({ [AUTH_THROTTLER]: true })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword() {
    throw new BadRequestException(
      'Password management is disabled. Authentication is managed via DAuth.',
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword() {
    throw new BadRequestException(
      'Password management is disabled. Authentication is managed via DAuth.',
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('password-reset')
  async passwordReset() {
    throw new BadRequestException(
      'Password management is disabled. Authentication is managed via DAuth.',
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-token')
  async verifyResetToken(
    @Body() verifyUserTokenDto: VerifyUserTokenDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.verifyUserToken(verifyUserTokenDto, workspace.id);
  }

  @SkipThrottle({ [AUTH_THROTTLER]: true })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('collab-token')
  async collabToken(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.getCollabToken(user, workspace.id);
  }

  @SkipThrottle({ [AUTH_THROTTLER]: true })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @AuthUser() user: User,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const sessionId = (req.raw as any).sessionId;
    if (sessionId) {
      await this.sessionService.revokeSession(
        sessionId,
        user.id,
        user.workspaceId,
      );
    }

    res.clearCookie('authToken');

    this.auditService.log({
      event: AuditEvent.USER_LOGOUT,
      resourceType: AuditResource.USER,
      resourceId: user.id,
    });
  }

  setAuthCookie(res: FastifyReply, token: string) {
    res.setCookie('authToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });
  }
}
