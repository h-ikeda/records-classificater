import { ClerkProvider } from '@clerk/clerk-react';
import { createRoot } from 'react-dom/client';
import App from './App';

const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? '';

const container = document.getElementById('root')!;
createRoot(container).render(
  <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
    <App />
  </ClerkProvider>,
);
