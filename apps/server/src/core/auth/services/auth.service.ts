import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from '../dto/login.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { TokenService } from './token.service';
import { SessionService } from '../../session/session.service';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { SignupService } from './signup.service';
import { CreateAdminUserDto } from '../dto/create-admin-user.dto';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import {
  comparePasswordHash,
  hashPassword,
  isUserDisabled,
  nanoIdGen,
} from '../../../common/helpers';
import { throwIfEmailNotVerified } from '../auth.util';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { MailService } from '../../../integrations/mail/mail.service';
import ChangePasswordEmail from '@docmost/transactional/emails/change-password-email';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import ForgotPasswordEmail from '@docmost/transactional/emails/forgot-password-email';
import { UserTokenRepo } from '@docmost/db/repos/user-token/user-token.repo';
import { PasswordResetDto } from '../dto/password-reset.dto';
import { User, UserToken, Workspace } from '@docmost/db/types/entity.types';
import { UserTokenType } from '../auth.constants';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InjectKysely } from 'nestjs-kysely';
import { executeTx } from '@docmost/db/utils';
import { WsService } from '../../../ws/ws.service';
import { VerifyUserTokenDto } from '../dto/verify-user-token.dto';
import { DomainService } from '../../../integrations/environment/domain.service';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { WorkspaceService } from '../../workspace/services/workspace.service';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { UserRole } from '../../../common/helpers/types/permission';
import { getWorkspaceDefaultPageEditMode } from '../../workspace/workspace.util';
import { isUserAllowed } from '../dauth-whitelist';
import { DAuthUserProfile } from './dauth.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private signupService: SignupService,
    private tokenService: TokenService,
    private sessionService: SessionService,
    private userSessionRepo: UserSessionRepo,
    private userRepo: UserRepo,
    private userTokenRepo: UserTokenRepo,
    private mailService: MailService,
    private domainService: DomainService,
    private environmentService: EnvironmentService,
    private eventEmitter: EventEmitter2,
    @InjectKysely() private readonly db: KyselyDB,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
    private wsService: WsService,
    private workspaceRepo: WorkspaceRepo,
    private workspaceService: WorkspaceService,
    private groupUserRepo: GroupUserRepo,
  ) {}

  async handleDAuthLogin(profile: DAuthUserProfile): Promise<
    | { allowed: false; email: string }
    | { allowed: true; authToken: string; user: User; workspace: Workspace }
  > {
    const email = profile.email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Email was not provided by DAuth');
    }

    let workspace = await this.workspaceRepo.findFirst();
    const existingUser = workspace
      ? await this.userRepo.findByEmail(email, workspace.id)
      : null;

    // Safety Admin Bypass: instance administrators or superusers are never locked out
    const isAdmin = existingUser
      ? existingUser.role === UserRole.OWNER ||
        existingUser.role === UserRole.ADMIN
      : !workspace;

    const rollNumber = profile.rollNumber || '';
    const isAllowed = isUserAllowed(
      email,
      rollNumber,
      isAdmin,
      this.environmentService.getDAuthEnforceAllowlist(),
      this.environmentService.getDAuthAllowedUsers(),
      this.environmentService.getDAuthAllowedUsersFile(),
    );

    if (!isAllowed) {
      this.logger.warn(`User ${email} is not in the DAuth allowlist`);
      return { allowed: false, email };
    }

    let user: User;

    if (!workspace) {
      // First-time setup: automatically initialize workspace with this user as OWNER
      const { workspace: newWorkspace, user: newUser } =
        await this.signupService.initialSetup({
          workspaceName: 'Docmost',
          name: profile.name || email.split('@')[0],
          email,
          password: crypto.randomBytes(32).toString('hex'),
        });
      workspace = newWorkspace;
      user = newUser;

      if (profile.avatar) {
        await this.userRepo.updateUser(
          { avatarUrl: profile.avatar },
          user.id,
          workspace.id,
        );
        user.avatarUrl = profile.avatar;
      }
    } else {
      if (existingUser) {
        user = existingUser;
        if (isUserDisabled(user)) {
          throw new UnauthorizedException('Your account has been deactivated.');
        }

        user.lastLoginAt = new Date();
        await this.userRepo.updateLastLogin(user.id, workspace.id);

        if (!user.avatarUrl && profile.avatar) {
          await this.userRepo.updateUser(
            { avatarUrl: profile.avatar },
            user.id,
            workspace.id,
          );
          user.avatarUrl = profile.avatar;
        }
      } else {
        // Register new user in existing workspace
        const ownerCount = await this.userRepo.roleCountByWorkspaceId(
          UserRole.OWNER,
          workspace.id,
        );
        const role = ownerCount === 0 ? UserRole.OWNER : UserRole.MEMBER;

        user = await executeTx(this.db, async (trx) => {
          const newUser = await this.userRepo.insertUser(
            {
              name: profile.name || email.split('@')[0],
              email,
              password: crypto.randomBytes(32).toString('hex'),
              role,
              avatarUrl: profile.avatar || null,
              emailVerifiedAt: new Date(),
              workspaceId: workspace.id,
            },
            trx,
            { pageEditMode: getWorkspaceDefaultPageEditMode(workspace) },
          );

          await this.workspaceService.addUserToWorkspace(
            newUser.id,
            workspace.id,
            undefined,
            trx,
          );

          await this.groupUserRepo.addUserToDefaultGroup(
            newUser.id,
            workspace.id,
            trx,
          );

          return newUser;
        });

        this.auditService.log({
          event: AuditEvent.USER_CREATED,
          resourceType: AuditResource.USER,
          resourceId: user.id,
          changes: {
            after: {
              name: user.name,
              email: user.email,
              role: user.role,
            },
          },
          metadata: { source: 'dauth' },
        });
      }
    }

    this.auditService.log({
      event: AuditEvent.USER_LOGIN,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: { source: 'dauth' },
    });

    const authToken = await this.sessionService.createSessionAndToken(user);
    return { allowed: true, authToken, user, workspace };
  }

  async login(loginDto: LoginDto, workspaceId: string) {
    throw new BadRequestException(
      'Password login is disabled. Please sign in with DAuth.',
    );
  }

  async register(createUserDto: CreateUserDto, workspaceId: string) {
    throw new BadRequestException(
      'Password registration is disabled. Please sign in with DAuth.',
    );
  }

  async setup(createAdminUserDto: CreateAdminUserDto) {
    throw new BadRequestException(
      'Password setup is disabled. Please sign in with DAuth.',
    );
  }

  async changePassword(
    dto: ChangePasswordDto,
    userId: string,
    workspaceId: string,
    currentSessionId?: string,
  ): Promise<void> {
    throw new BadRequestException(
      'Password management is disabled. Authentication is managed via DAuth.',
    );
  }

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
    workspace: Workspace,
  ): Promise<void> {
    throw new BadRequestException(
      'Password management is disabled. Authentication is managed via DAuth.',
    );
  }

  async passwordReset(
    passwordResetDto: PasswordResetDto,
    workspace: Workspace,
  ): Promise<{ requiresLogin: boolean; authToken: string }> {
    throw new BadRequestException(
      'Password management is disabled. Authentication is managed via DAuth.',
    );
  }

  async verifyUserToken(
    userTokenDto: VerifyUserTokenDto,
    workspaceId: string,
  ): Promise<void> {
    const userToken: UserToken = await this.userTokenRepo.findById(
      userTokenDto.token,
      workspaceId,
    );

    if (
      !userToken ||
      userToken.type !== userTokenDto.type ||
      userToken.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired token');
    }
  }

  async getCollabToken(user: User, workspaceId: string) {
    const token = await this.tokenService.generateCollabToken(
      user,
      workspaceId,
    );
    return { token };
  }
}
