import { isUserAllowed } from './dauth-whitelist';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('isUserAllowed (DAuth Whitelist)', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dauth-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows all users when allowlist enforcement is disabled', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '0';
    process.env.DAUTH_ALLOWED_USERS = 'allowed@delta.nitt.edu';

    expect(isUserAllowed('stranger@gmail.com')).toBe(true);
  });

  it('allows superusers or instance administrators regardless of allowlist', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    process.env.DAUTH_ALLOWED_USERS = 'whitelisted@delta.nitt.edu';

    expect(isUserAllowed('admin@example.com', '', true)).toBe(true);
  });

  it('allows user if email is in the allowlist env string', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    process.env.DAUTH_ALLOWED_USERS =
      'barath@delta.nitt.edu, 106121001, member@nitt.edu';

    expect(isUserAllowed('barath@delta.nitt.edu')).toBe(true);
    expect(isUserAllowed('BARATH@DELTA.NITT.EDU')).toBe(true);
  });

  it('allows user if roll number matches an allowlist entry', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    process.env.DAUTH_ALLOWED_USERS = '106121001, 108121050';

    expect(isUserAllowed('student@nitt.edu', '106121001')).toBe(true);
  });

  it('extracts roll number from email local part if rollNumber is omitted', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    process.env.DAUTH_ALLOWED_USERS = '106121001';

    expect(isUserAllowed('106121001@nitt.edu', '')).toBe(true);
  });

  it('allows user if email local part username is in allowlist', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    process.env.DAUTH_ALLOWED_USERS = 'delta_admin, dev_user';

    expect(isUserAllowed('delta_admin@somedomain.com')).toBe(true);
  });

  it('rejects unauthorized users when allowlist is enforced', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    process.env.DAUTH_ALLOWED_USERS = 'barath@delta.nitt.edu, 106121001';

    expect(isUserAllowed('unauthorized@example.com', '999999999')).toBe(false);
  });

  it('loads allowed users from a mounted JSON array file', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    const jsonPath = path.join(tempDir, 'allowed_users.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(['json_user@delta.nitt.edu', '107121002']),
    );

    process.env.DAUTH_ALLOWED_USERS_FILE = jsonPath;

    expect(isUserAllowed('json_user@delta.nitt.edu')).toBe(true);
    expect(isUserAllowed('someone@nitt.edu', '107121002')).toBe(true);
    expect(isUserAllowed('other@nitt.edu', '999999')).toBe(false);
  });

  it('loads allowed users from a JSON object with allowedUsers key', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    const jsonPath = path.join(tempDir, 'allowed_users.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        allowedUsers: ['delta_lead@nitt.edu', '109121003'],
      }),
    );

    expect(
      isUserAllowed(
        'delta_lead@nitt.edu',
        '',
        false,
        undefined,
        undefined,
        jsonPath,
      ),
    ).toBe(true);
    expect(
      isUserAllowed(
        'random@nitt.edu',
        '109121003',
        false,
        undefined,
        undefined,
        jsonPath,
      ),
    ).toBe(true);
    expect(
      isUserAllowed(
        'stranger@nitt.edu',
        '',
        false,
        undefined,
        undefined,
        jsonPath,
      ),
    ).toBe(false);
  });

  it('loads allowed users from an array of structured user objects', () => {
    process.env.DAUTH_ENFORCE_ALLOWLIST = '1';
    const jsonPath = path.join(tempDir, 'allowed_users.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify([
        { name: 'Alice', email: 'alice@delta.nitt.edu', rollNumber: '106121099' },
        { name: 'Bob', email: 'bob@delta.nitt.edu', rollNumber: '106121088' },
      ]),
    );

    process.env.DAUTH_ALLOWED_USERS_FILE = jsonPath;

    expect(isUserAllowed('alice@delta.nitt.edu')).toBe(true);
    expect(isUserAllowed('student@nitt.edu', '106121088')).toBe(true);
    expect(isUserAllowed('charlie@nitt.edu')).toBe(false);
  });
});
