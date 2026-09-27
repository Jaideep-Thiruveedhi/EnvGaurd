export function getGoogleAuthUrl() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }
  return `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}`;
}
