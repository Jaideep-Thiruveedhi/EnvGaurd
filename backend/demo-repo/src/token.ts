// Bracket-notation + destructuring patterns (scanner must catch these too).
const { JWT_SECRET } = process.env;

export function signToken(payload: string): string {
  const secret = process.env["JWT_SECRET"] || JWT_SECRET;
  return `${payload}.${secret}`;
}
