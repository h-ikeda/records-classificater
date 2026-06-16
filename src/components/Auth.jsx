import { SignInButton } from '@clerk/clerk-react';

// 認証は Clerk が提供するモーダルに委譲する。
export default function Auth() {
  return (
    <div className="flex gap-2">
      <SignInButton mode="modal">
        <button className="text-white font-medium px-3 py-1.5 rounded-lg border border-white/60 active:bg-lime-600">
          サインイン
        </button>
      </SignInButton>
    </div>
  );
}
