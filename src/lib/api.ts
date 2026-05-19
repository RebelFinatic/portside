import { useAuthStore } from '../store/useAuthStore';

const BASE_URL = '/api';

async function parseResponseBody(response: Response): Promise<{ data: any; isJson: boolean; text: string }> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  if (isJson) {
    const data = await response.json().catch(() => ({}));
    return { data, isJson: true, text: '' };
  }

  const text = await response.text().catch(() => '');
  return { data: {}, isJson: false, text };
}

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as any),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });
  const parsed = await parseResponseBody(response);

  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().logout();
    }
    if (parsed.isJson && parsed.data?.error) {
      throw new Error(parsed.data.error);
    }
    if (!parsed.isJson && parsed.text.trim().startsWith('<')) {
      throw new Error('Unexpected non-API response from server. Please reload and sign in again.');
    }
    throw new Error(`Request failed with status ${response.status}`);
  }

  if (parsed.isJson) {
    return parsed.data;
  }
  if (parsed.text.trim().startsWith('<')) {
    throw new Error('Unexpected non-API response from server. Please reload and try again.');
  }
  throw new Error('Unexpected API response format.');
}

export function hasPermission(permission: string) {
  return useAuthStore.getState().hasPermission(permission);
}
