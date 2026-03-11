/**
 * GitHub OAuth Device Flow (RFC 8628)
 *
 * Reference: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubAccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubAccessTokenError {
  error: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied';
  error_description?: string;
  error_uri?: string;
}

export type GitHubTokenPollResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'authorized'; accessToken: string; scope: string };

export interface GitHubUserInfo {
  login: string;
  id: number;
  email: string | null;
}

/**
 * GitHub OAuth Device Flow client
 */
export class GitHubDeviceFlow {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly deviceAuthUrl = 'https://github.com/login/device/code';
  private readonly accessTokenUrl = 'https://github.com/login/oauth/access_token';

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Initiate device flow
   *
   * @param scope - OAuth scopes (e.g., 'repo read:org')
   * @returns Device code response with user_code and verification_uri
   */
  async initiateDeviceFlow(scope: string = 'repo read:org'): Promise<GitHubDeviceCodeResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope,
    });

    const response = await fetch(this.deviceAuthUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`GitHub device flow initiation failed: ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubDeviceCodeResponse;

    // Validate all required response fields
    if (
      !data.device_code ||
      !data.user_code ||
      !data.verification_uri ||
      !data.expires_in ||
      !data.interval
    ) {
      throw new Error('Invalid response from GitHub device authorization endpoint');
    }

    return data;
  }

  /**
   * Poll for access token
   *
   * @param deviceCode - Device code from initiation
   * @returns Poll result (pending, authorized, expired, etc.)
   */
  async pollForToken(deviceCode: string): Promise<GitHubTokenPollResult> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    const response = await fetch(this.accessTokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`GitHub token poll failed: ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubAccessTokenResponse | GitHubAccessTokenError;

    // Check if it's an error response
    if ('error' in data) {
      switch (data.error) {
        case 'authorization_pending':
          return { status: 'pending' };
        case 'slow_down':
          return { status: 'slow_down' };
        case 'expired_token':
          return { status: 'expired' };
        case 'access_denied':
          return { status: 'denied' };
        default:
          throw new Error(`Unknown GitHub OAuth error: ${data.error}`);
      }
    }

    // Success - validate access_token exists before using it
    if (
      !data ||
      typeof (data as GitHubAccessTokenResponse).access_token !== 'string' ||
      !(data as GitHubAccessTokenResponse).access_token ||
      typeof (data as GitHubAccessTokenResponse).scope !== 'string'
    ) {
      throw new Error(
        "Malformed GitHub access token response: missing or invalid 'access_token' or 'scope'"
      );
    }

    return {
      status: 'authorized',
      accessToken: (data as GitHubAccessTokenResponse).access_token,
      scope: (data as GitHubAccessTokenResponse).scope,
    };
  }

  /**
   * Get user information using access token
   *
   * @param accessToken - GitHub access token
   * @returns User information
   */
  async getUserInfo(accessToken: string): Promise<GitHubUserInfo> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Forj/1.0 (https://forj.sh)',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get GitHub user info: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      login: string;
      id: number;
      email: string | null;
    };

    return {
      login: data.login,
      id: data.id,
      email: data.email,
    };
  }
}
