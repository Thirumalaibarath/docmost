import * as fs from 'fs';

export function parseAllowedTokens(data: any): string[] {
  const tokens: string[] = [];

  if (typeof data === 'string') {
    tokens.push(...data.split(/[\s,\n;]+/));
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string' || typeof item === 'number') {
        tokens.push(String(item));
      } else if (item && typeof item === 'object') {
        if (item.email) tokens.push(String(item.email));
        if (item.rollNumber) tokens.push(String(item.rollNumber));
        if (item.roll_number) tokens.push(String(item.roll_number));
        if (item.username) tokens.push(String(item.username));
        if (item.user) tokens.push(String(item.user));
        if (item.id) tokens.push(String(item.id));
      }
    }
  } else if (data && typeof data === 'object') {
    const candidateKeys = [
      'allowedUsers',
      'allowed_users',
      'users',
      'allowlist',
      'whitelist',
    ];
    for (const key of candidateKeys) {
      if (data[key]) {
        tokens.push(...parseAllowedTokens(data[key]));
      }
    }
  }

  return tokens;
}

export function loadAllowedUsersSet(
  filePath?: string,
  rawEnv?: string,
): Set<string> {
  const allowedSet = new Set<string>();

  // 1. Load from mounted JSON file if path provided or DAUTH_ALLOWED_USERS_FILE is set
  const targetFilePath =
    filePath ||
    process.env.DAUTH_ALLOWED_USERS_FILE ||
    (fs.existsSync('./allowed_users.json') ? './allowed_users.json' : '');

  if (targetFilePath && fs.existsSync(targetFilePath)) {
    try {
      const fileContent = fs.readFileSync(targetFilePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      const fileTokens = parseAllowedTokens(parsed);
      for (const t of fileTokens) {
        const cleaned = t.trim().toLowerCase();
        if (cleaned) allowedSet.add(cleaned);
      }
    } catch (err) {
      console.error(
        `Failed to parse DAuth allowed users file from ${targetFilePath}:`,
        err,
      );
    }
  }

  // 2. Also incorporate rawEnv / DAUTH_ALLOWED_USERS if provided
  const rawAllowed =
    rawEnv !== undefined ? rawEnv : process.env.DAUTH_ALLOWED_USERS || '';

  if (rawAllowed) {
    const envTokens = rawAllowed.split(/[\s,\n;]+/);
    for (const t of envTokens) {
      const cleaned = t.trim().toLowerCase();
      if (cleaned) allowedSet.add(cleaned);
    }
  }

  return allowedSet;
}

export function isUserAllowed(
  email: string,
  rollNumber: string = '',
  isAdmin: boolean = false,
  customEnforce?: boolean,
  customAllowed?: string,
  filePath?: string,
): boolean {
  const enforceAllowlist =
    customEnforce !== undefined
      ? customEnforce
      : ['1', 'true'].includes(
          (process.env.DAUTH_ENFORCE_ALLOWLIST || '0').trim().toLowerCase(),
        );

  if (!enforceAllowlist || isAdmin) {
    return true;
  }

  const allowedSet = loadAllowedUsersSet(filePath, customAllowed);

  const userEmail = email.trim().toLowerCase();
  let userRoll = rollNumber.trim().toLowerCase();

  if (!userRoll && userEmail.includes('@')) {
    const localPart = userEmail.split('@')[0];
    if (/^\d{7,10}$/.test(localPart)) {
      userRoll = localPart;
    }
  }

  const localEmail = userEmail.includes('@') ? userEmail.split('@')[0] : '';

  return (
    allowedSet.has(userEmail) ||
    (Boolean(userRoll) && allowedSet.has(userRoll)) ||
    (Boolean(localEmail) && allowedSet.has(localEmail))
  );
}
