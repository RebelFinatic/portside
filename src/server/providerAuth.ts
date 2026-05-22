import crypto from 'crypto';
import type { PortsideStore } from './store';

export type ProviderName = 'cfx';
export type ProviderFlowMode = 'login' | 'link';

export type ProviderProfile = {
  provider: ProviderName;
  providerUserId: string;
  displayName: string;
  identifiers: string[];
};

export type CfxProviderConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  redirectUri: string;
  scope: string;
};

const normalizeUrl = (value: string) => value.trim();

const buildPublicUrl = () => {
  const configured = process.env.PORTSIDE_PUBLIC_URL || process.env.TXHOST_TXA_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, '');
  const port = process.env.PORTSIDE_PORT || process.env.TXHOST_TXA_PORT || '3000';
  return `http://127.0.0.1:${port}`;
};

export const getCfxProviderConfig = (): CfxProviderConfig => {
  const publicUrl = buildPublicUrl();
  const redirectUri = process.env.PORTSIDE_CFX_REDIRECT_URI?.trim() || `${publicUrl}/api/auth/cfx/callback`;
  const config: CfxProviderConfig = {
    enabled: Boolean(process.env.PORTSIDE_CFX_CLIENT_ID && process.env.PORTSIDE_CFX_CLIENT_SECRET),
    clientId: process.env.PORTSIDE_CFX_CLIENT_ID?.trim() || '',
    clientSecret: process.env.PORTSIDE_CFX_CLIENT_SECRET?.trim() || '',
    authUrl: normalizeUrl(process.env.PORTSIDE_CFX_AUTH_URL || 'https://forum.cfx.re/session/sso_provider'),
    tokenUrl: normalizeUrl(process.env.PORTSIDE_CFX_TOKEN_URL || 'https://forum.cfx.re/user-api-key/sso'),
    userInfoUrl: normalizeUrl(process.env.PORTSIDE_CFX_USERINFO_URL || 'https://forum.cfx.re/session/current.json'),
    redirectUri,
    scope: process.env.PORTSIDE_CFX_SCOPE?.trim() || 'openid profile',
  };
  return config;
};

export const getProviderSummary = () => {
  const cfx = getCfxProviderConfig();
  return {
    cfx: {
      enabled: cfx.enabled,
      configured: cfx.enabled,
      redirectUri: cfx.redirectUri,
    },
  };
};

const ensureRedirectAllowed = (redirectUri: string) => {
  const whitelist = [
    process.env.PORTSIDE_PUBLIC_URL?.trim(),
    process.env.TXHOST_TXA_URL?.trim(),
    buildPublicUrl(),
  ].filter((value): value is string => Boolean(value)).map(value => value.replace(/\/+$/, '').toLowerCase());

  const normalizedRedirect = redirectUri.replace(/\/+$/, '').toLowerCase();
  if (!whitelist.some(base => normalizedRedirect.startsWith(base))) {
    throw new Error('Configured Cfx callback URI is outside the allowed public URL scope');
  }
};

export const createProviderAuthStartUrl = (
  store: PortsideStore,
  input: {
    mode: ProviderFlowMode;
    actorAdminId?: string | null;
    targetAdminId?: string | null;
    returnTo?: string | null;
  },
) => {
  const config = getCfxProviderConfig();
  if (!config.enabled) throw new Error('Cfx provider login is not configured');
  ensureRedirectAllowed(config.redirectUri);

  const stateId = crypto.randomUUID();
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  store.createProviderAuthState({
    id: stateId,
    provider: 'cfx',
    mode: input.mode,
    nonce,
    actorAdminId: input.actorAdminId || null,
    targetAdminId: input.targetAdminId || null,
    returnTo: input.returnTo || null,
    expiresAt,
  });

  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', `${stateId}.${nonce}`);
  return url.toString();
};

const parseProviderProfile = (payload: any): ProviderProfile => {
  const providerUserId = String(payload?.sub || payload?.id || payload?.user_id || payload?.uid || '').trim();
  if (!providerUserId) throw new Error('Provider profile did not include a user id');
  const displayName = String(payload?.preferred_username || payload?.username || payload?.name || `cfx:${providerUserId}`).trim();
  const rawIdentifiers = Array.isArray(payload?.identifiers) ? payload.identifiers : [];
  const identifiers = rawIdentifiers
    .filter((value: unknown) => typeof value === 'string')
    .map((value: string) => value.trim())
    .filter(Boolean);
  return {
    provider: 'cfx',
    providerUserId,
    displayName,
    identifiers,
  };
};

const exchangeCodeForToken = async (config: CfxProviderConfig, code: string) => {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status})${text ? `: ${text.slice(0, 120)}` : ''}`);
  }

  const tokenPayload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = typeof tokenPayload.access_token === 'string' ? tokenPayload.access_token : '';
  if (!accessToken) throw new Error('Token exchange did not return access_token');
  return accessToken;
};

const fetchUserInfo = async (config: CfxProviderConfig, accessToken: string) => {
  const response = await fetch(config.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`User profile fetch failed (${response.status})${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  return response.json().catch(() => ({}));
};

export const resolveCfxProviderProfile = async (code: string) => {
  const config = getCfxProviderConfig();
  if (!config.enabled) throw new Error('Cfx provider login is not configured');
  const accessToken = await exchangeCodeForToken(config, code);
  const payload = await fetchUserInfo(config, accessToken);
  return parseProviderProfile(payload);
};
