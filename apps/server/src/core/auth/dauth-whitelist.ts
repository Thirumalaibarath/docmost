import * as fs from 'fs';
import * as path from 'path';

export function resolveAllowedUsersFilePath(
  customPath?: string,
): string | null {
  const candidatePaths = [
    customPath,
    process.env.DAUTH_ALLOWED_USERS_FILE,
    '/app/members.json',
    path.resolve(process.cwd(), 'members.json'),
    path.resolve(process.cwd(), '../../members.json'),
    path.resolve(process.cwd(), '../members.json'),
    '/app/allowed_users.json',
    path.resolve(process.cwd(), 'allowed_users.json'),
    path.resolve(process.cwd(), '../../allowed_users.json'),
    path.resolve(process.cwd(), '../allowed_users.json'),
    '/app/data/members.json',
    '/app/data/storage/members.json',
    './members.json',
    './allowed_users.json',
  ];

  for (const candidate of candidatePaths) {
    if (candidate && fs.existsSync(candidate)) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          return candidate;
        }
      } catch {}
    }
  }

  return null;
}

export function parseAllowedTokens(data: any): string[] {
  const tokens: string[] = [];
  if (!data) return tokens;

  if (typeof data === 'string' || typeof data === 'number') {
    tokens.push(...String(data).split(/[\s,\n;]+/));
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string' || typeof item === 'number') {
        tokens.push(String(item));
      } else if (item && typeof item === 'object') {
        if (item.email) tokens.push(String(item.email));
        if (item.rollNumber) tokens.push(String(item.rollNumber));
        if (item.roll_number) tokens.push(String(item.roll_number));
        if (item.roll) tokens.push(String(item.roll));
        if (item.username) tokens.push(String(item.username));
        if (item.user) tokens.push(String(item.user));
        if (item.id) tokens.push(String(item.id));
        if (item.webmail) tokens.push(String(item.webmail));
      }
    }
  } else if (typeof data === 'object') {
    const candidateKeys = [
      'members',
      'allowedUsers',
      'allowed_users',
      'users',
      'allowlist',
      'whitelist',
      'data',
    ];
    let foundArray = false;
    for (const key of candidateKeys) {
      if (data[key]) {
        foundArray = true;
        tokens.push(...parseAllowedTokens(data[key]));
      }
    }
    // If none of candidateKeys found, check if keys themselves look like emails or roll numbers
    if (!foundArray) {
      for (const [key, val] of Object.entries(data)) {
        if (key.includes('@') || /^\d{7,10}$/.test(key)) {
          tokens.push(key);
        } else if (val && typeof val === 'object') {
          tokens.push(...parseAllowedTokens(val));
        }
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

  // 1. Resolve and load from mounted JSON file (members.json, allowed_users.json, etc.)
  const targetFilePath = resolveAllowedUsersFilePath(filePath);

  if (targetFilePath) {
    try {
      const fileContent = fs.readFileSync(targetFilePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      const fileTokens = parseAllowedTokens(parsed);
      for (const t of fileTokens) {
        const cleaned = t.trim().toLowerCase();
        if (cleaned) allowedSet.add(cleaned);
      }
      console.log(
        `[DAuth Whitelist] Successfully loaded ${allowedSet.size} allowed token(s) from ${targetFilePath}`,
      );
    } catch (err) {
      console.error(
        `[DAuth Whitelist] Failed to parse DAuth allowed users file from ${targetFilePath}:`,
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
  // If customEnforce is explicitly passed, respect it
  let enforceAllowlist: boolean;
  const rawEnforce = (process.env.DAUTH_ENFORCE_ALLOWLIST || '').trim().toLowerCase();

  if (customEnforce !== undefined) {
    enforceAllowlist = customEnforce;
  } else if (rawEnforce === '0' || rawEnforce === 'false') {
    enforceAllowlist = false;
  } else if (rawEnforce === '1' || rawEnforce === 'true') {
    enforceAllowlist = true;
  } else {
    // Auto-detect: if a members.json/allowed_users.json file exists or DAUTH_ALLOWED_USERS has entries,
    // automatically enforce allowlist!
    const foundPath = resolveAllowedUsersFilePath(filePath);
    const hasEnvUsers = Boolean(
      process.env.DAUTH_ALLOWED_USERS && process.env.DAUTH_ALLOWED_USERS.trim(),
    );
    enforceAllowlist = Boolean(foundPath || hasEnvUsers);
  }

  if (!enforceAllowlist || isAdmin) {
    return true;
  }

  const allowedSet = loadAllowedUsersSet(filePath, customAllowed);

  // If allowlist enforcement is active but 0 users were defined, reject for security
  if (allowedSet.size === 0) {
    console.warn(
      '[DAuth Whitelist] Allowlist is enforced but no allowed users were found in members.json or environment.',
    );
    return false;
  }

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
