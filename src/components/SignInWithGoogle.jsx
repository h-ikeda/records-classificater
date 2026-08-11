import { getAuth, signInWithRedirect, GoogleAuthProvider } from 'firebase/auth';

export default function SignInWithGoogle() {
  function signIn() {
    signInWithRedirect(getAuth(), new GoogleAuthProvider());
  }

  return (
    <button onClick={signIn}>
      Sign in with Google
    </button>
  );
}
