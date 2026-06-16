import { ClerkProvider } from '@clerk/clerk-react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// Clerk の Vercel 統合は NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY を自動注入する。
// ローカルや手動設定向けに CLERK_PUBLISHABLE_KEY もフォールバックとして許可する。
const publishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? '';

const container = document.getElementById('root')!;
const root = createRoot(container);

// キー未設定で ClerkProvider が同期的に throw すると白画面になるため、明示的に案内する。
if (!publishableKey) {
  root.render(
    <div className="p-6 text-sm text-gray-800">
      <h1 className="text-lg font-bold text-red-700 mb-2">設定エラー</h1>
      <p>
        Clerk の公開キー（<code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>）が設定されていません。
        Vercel プロジェクトの環境変数を確認してください。
      </p>
    </div>,
  );
} else {
  root.render(
    <ErrorBoundary>
      <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </ErrorBoundary>,
  );
}
