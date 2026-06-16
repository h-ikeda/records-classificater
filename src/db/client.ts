// Neon Data API（PostgREST 互換）をブラウザから直接呼び出すクライアント。
// Clerk の JWT を Bearer トークンとして送ると、Neon が authenticated ロールへ切り替え、
// RLS ポリシーで行を保護する。
// （Data API 構成では authenticated ロールが NOLOGIN のため SQL ドライバ直結はできず、
//   公式のブラウザ直結ルートである Data API(REST) を使う）
const baseUrl = (process.env.NEXT_PUBLIC_NEON_DATA_API_URL ?? '').replace(/\/$/, '');

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  // PostgREST の Prefer ヘッダ（upsert や返却内容の制御に使う）
  prefer?: string;
}

/**
 * Data API へリクエストを送る。エラーは本文付きで投げ、診断できるようにする。
 */
export async function dataApi<T = unknown>(
  token: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (!baseUrl) {
    throw new Error(
      'NEXT_PUBLIC_NEON_DATA_API_URL が設定されていません。Vercel の環境変数を確認してください。',
    );
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.prefer) headers['Prefer'] = options.prefer;

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // PostgREST はエラーを JSON（message/details/hint）で返す
    throw new Error(`Data API ${res.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}
