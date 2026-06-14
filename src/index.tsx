import { ClerkProvider } from '@clerk/clerk-react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Clerk の Vercel 統合は NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY を自動注入する。
// ローカルや手動設定向けに CLERK_PUBLISHABLE_KEY もフォールバックとして許可する。
const publishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? '';

const container = document.getElementById('root')!;
createRoot(container).render(
  <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
    <App />
  </ClerkProvider>,
);
