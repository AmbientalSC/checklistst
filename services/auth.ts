import { firebaseApiKey } from '../firebase.ts';

interface SignUpResult {
  idToken: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
  localId: string; // uid
}

export async function createUserWithPassword(email: string, password: string, displayName?: string): Promise<SignUpResult> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseApiKey}`;
  const body = {
    email,
    password,
    returnSecureToken: true,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create auth user: ${res.status} ${text}`);
  }
  const data = await res.json() as SignUpResult;

  // Optionally set displayName via update endpoint (requires idToken)
  if (displayName) {
    const updateUrl = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseApiKey}`;
    await fetch(updateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: data.idToken, displayName, returnSecureToken: false })
    });
  }

  return data;
}

// NOTE: Deleting/disabling users requires privileged credentials (Admin SDK or Cloud Function).
// For production, implement callable Cloud Functions to perform delete/disable in Auth.
