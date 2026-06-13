import { signOut, getAuth } from 'firebase/auth';

export default function SignOut() {
  return (
    <button onClick={() => signOut(getAuth())}>
      Sign out
    </button>
  );
}
