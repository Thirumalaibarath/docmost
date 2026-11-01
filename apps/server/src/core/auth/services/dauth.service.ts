import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

export interface DAuthUserProfile {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string;
  gender?: string;
  rollNumber?: string;
  avatar?: string;
}

@Injectable()
export class DAuthService {
  private readonly logger = new Logger(DAuthService.name);

  constructor(private environmentService: EnvironmentService) {}

  getAuthorizationUrl(state: string, nonce: string): string {
    const dauthHost = this.environmentService.getDAuthHost();
    const clientId = this.environmentService.getDAuthClientId();
    const redirectUri = this.environmentService.getDAuthRedirectUri();

    if (!clientId) {
      throw new BadRequestException(
        'DAuth Client ID is not configured (DAUTH_CLIENT_ID).',
      );
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      grant_type: 'authorization_code',
      scope: 'email openid profile user',
      state,
      nonce,
    });

    return `${dauthHost}/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const dauthHost = this.environmentService.getDAuthHost();
    const clientId = this.environmentService.getDAuthClientId();
    const clientSecret = this.environmentService.getDAuthClientSecret();
    const redirectUri = this.environmentService.getDAuthRedirectUri();

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'DAuth credentials are not configured (DAUTH_CLIENT_ID / DAUTH_CLIENT_SECRET).',
      );
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const response = await fetch(`${dauthHost}/api/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Failed to exchange authorization code with DAuth: status=${response.status}, body=${errorText}`,
      );
      throw new BadRequestException(
        `Failed to exchange token with DAuth: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new BadRequestException(
        'No access token received from DAuth token endpoint.',
      );
    }

    return data.access_token;
  }

  async getUserProfile(accessToken: string): Promise<DAuthUserProfile> {
    const dauthHost = this.environmentService.getDAuthHost();

    // IMPORTANT: DAuth endpoint requires POST request
    const response = await fetch(`${dauthHost}/api/resources/user`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Failed to fetch user profile from DAuth: status=${response.status}, body=${errorText}`,
      );
      throw new UnauthorizedException(
        `Failed to retrieve user profile from DAuth: ${response.statusText}`,
      );
    }

    const profile = (await response.json()) as DAuthUserProfile;
    return profile;
  }
}
