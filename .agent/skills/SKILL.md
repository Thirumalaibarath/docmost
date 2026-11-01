---
name: dauth-oauth-whitelisting
description: Complete step-by-step implementation guide and reference for integrating Delta DAuth (OAuth 2.0) login with flexible user and email whitelisting into any web application or backend.
---

# Delta DAuth (OAuth 2.0) Integration & Whitelisting Skill

This guide provides end-to-end instructions, architecture, protocol details, and reference implementations for integrating **DAuth** (`https://auth.delta.nitt.edu`) with **User Whitelisting / Allowlist Enforcement** into any project (Node.js/Express/Next.js, Python/Django/FastAPI, Go, etc.).

---

## 1. DAuth Protocol & Architecture

DAuth uses standard **OAuth 2.0 Authorization Code Flow**, but with one critical quirk: the **user resource endpoint requires an HTTP POST request** rather than a GET request.

### Core Endpoints
| Purpose | Method | Endpoint URL | Headers / Parameters |
| :--- | :---: | :--- | :--- |
| **Authorize** | `GET` | `${DAUTH_HOST}/authorize` | Query: `client_id`, `redirect_uri`, `response_type=code`, `grant_type=authorization_code`, `state`, `scope`, `nonce` |
| **Token Exchange** | `POST` | `${DAUTH_HOST}/api/oauth/token` | Form/Body: `client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `redirect_uri` |
| **User Profile** | `POST` ⚠️ | `${DAUTH_HOST}/api/resources/user` | Header: `Authorization: Bearer <access_token>` |

> [!IMPORTANT]
> Unlike Google or GitHub OAuth, DAuth expects **POST** requests to `/api/resources/user`. Sending a `GET` request will result in an HTTP 405 Method Not Allowed error.

### Required OAuth Scope
```text
email openid profile user
```

### DAuth User Profile Response Format
```json
{
  "id": "12345",
  "name": "Barath Thirumalai",
  "email": "106121001@nitt.edu",
  "phoneNumber": "9876543210",
  "gender": "male",
  "rollNumber": "106121001",
  "avatar": "https://auth.delta.nitt.edu/path/to/avatar.png"
}
```

---

## 2. Environment Variables (.env)

Add the following configuration variables to your project's `.env`:

```env
# DAuth OAuth Configuration
DAUTH_HOST="https://auth.delta.nitt.edu"
DAUTH_CLIENT_ID="your_dauth_client_id"
DAUTH_CLIENT_SECRET="your_dauth_client_secret"
DAUTH_REDIRECT_URI="https://your-app.delta.nitt.edu/auth/dauth/callback"

# Allowlist / Whitelisting Configuration
# Set to 1, true, or True to restrict access to whitelisted users only
DAUTH_ENFORCE_ALLOWLIST=1

# Comma, space, or newline-separated list of allowed emails, roll numbers, or usernames
DAUTH_ALLOWED_USERS="barath@delta.nitt.edu, 106121001, admin@nitt.edu, 108121050"
```

---

## 3. Whitelist / Allowlist Enforcement Logic

The whitelisting engine should flexibly check:
1. Full email (e.g., `106121001@nitt.edu` or `barath@delta.nitt.edu`)
2. Roll number (e.g., `106121001`)
3. Username / email local part (e.g., `barath`)
4. **Safety Admin Bypass**: Superusers or existing instance administrators should never be locked out even if omitted from the allowlist string.

### Universal Whitelist Verification Algorithm (Python & TypeScript)

#### Python Implementation:
```python
import os
import re

def is_user_allowed(email: str, roll_number: str = "", is_admin: bool = False) -> bool:
    enforce_allowlist = str(os.environ.get("DAUTH_ENFORCE_ALLOWLIST", "0")).strip().lower() in ("1", "true")
    
    # If allowlist enforcement is disabled or user is admin, allow login
    if not enforce_allowlist or is_admin:
        return True

    allowed_raw = os.environ.get("DAUTH_ALLOWED_USERS", "")
    # Parse tokens separated by spaces, commas, semicolons, or newlines
    tokens = re.split(r"[\s,\n;]+", allowed_raw.strip())
    allowed_set = {t.lower().strip() for t in tokens if t.strip()}

    user_email = email.lower().strip()
    user_roll = (roll_number or "").lower().strip()
    
    # Extract roll number from email local part if rollNumber field is empty
    if not user_roll and "@" in user_email:
        local_part = user_email.split("@")[0]
        if re.match(r"^\d{7,10}$", local_part):
            user_roll = local_part
            
    local_email = user_email.split("@")[0] if "@" in user_email else ""

    return (
        user_email in allowed_set
        or (bool(user_roll) and user_roll in allowed_set)
        or (bool(local_email) and local_email in allowed_set)
    )
```

#### TypeScript / Node.js Implementation:
```typescript
export function isUserAllowed(email: string, rollNumber: string = "", isAdmin: boolean = false): boolean {
  const enforceAllowlist = ["1", "true"].includes(
    (process.env.DAUTH_ENFORCE_ALLOWLIST || "0").trim().toLowerCase()
  );

  if (!enforceAllowlist || isAdmin) {
    return true;
  }

  const rawAllowed = process.env.DAUTH_ALLOWED_USERS || "";
  const allowedSet = new Set(
    rawAllowed
      .split(/[\s,\n;]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  );

  const userEmail = email.trim().toLowerCase();
  let userRoll = rollNumber.trim().toLowerCase();

  if (!userRoll && userEmail.includes("@")) {
    const localPart = userEmail.split("@")[0];
    if (/^\d{7,10}$/.test(localPart)) {
      userRoll = localPart;
    }
  }

  const localEmail = userEmail.includes("@") ? userEmail.split("@")[0] : "";

  return (
    allowedSet.has(userEmail) ||
    (Boolean(userRoll) && allowedSet.has(userRoll)) ||
    (Boolean(localEmail) && allowedSet.has(localEmail))
  );
}
```

---

## 4. Backend Implementation Guide

### A. Python / Django Implementation

#### 1. OAuth Provider Service (`dauth.py`):
```python
import os
import re
import uuid
import requests
from urllib.parse import urlencode

class DAuthService:
    def __init__(self):
        self.dauth_host = os.environ.get("DAUTH_HOST", "https://auth.delta.nitt.edu").rstrip("/")
        self.client_id = os.environ.get("DAUTH_CLIENT_ID")
        self.client_secret = os.environ.get("DAUTH_CLIENT_SECRET")
        self.redirect_uri = os.environ.get("DAUTH_REDIRECT_URI")
        self.scope = "email openid profile user"

    def get_authorization_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "grant_type": "authorization_code",
            "state": state,
            "scope": self.scope,
            "nonce": uuid.uuid4().hex,
        }
        return f"{self.dauth_host}/authorize?{urlencode(params)}"

    def exchange_code_for_token(self, code: str) -> dict:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri,
        }
        res = requests.post(f"{self.dauth_host}/api/oauth/token", data=data, timeout=15)
        res.raise_for_status()
        return res.json()

    def get_user_profile(self, access_token: str) -> dict:
        # Note: MUST be POST
        headers = {"Authorization": f"Bearer {access_token}"}
        res = requests.post(f"{self.dauth_host}/api/resources/user", headers=headers, timeout=15)
        res.raise_for_status()
        return res.json()
```

#### 2. Views & Endpoints:
```python
from django.shortcuts import redirect
from django.http import HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.contrib.auth import login
from .models import User

def dauth_login_initiate(request):
    state = uuid.uuid4().hex
    request.session["dauth_state"] = state
    service = DAuthService()
    return redirect(service.get_authorization_url(state))

def dauth_callback(request):
    code = request.GET.get("code")
    state = request.GET.get("state")
    saved_state = request.session.get("dauth_state")

    if not code or not state or state != saved_state:
        return HttpResponseBadRequest("Invalid OAuth state or authorization code.")

    service = DAuthService()
    try:
        tokens = service.exchange_code_for_token(code)
        user_info = service.get_user_profile(tokens["access_token"])
    except Exception as e:
        return HttpResponseBadRequest(f"Authentication with DAuth failed: {str(e)}")

    email = user_info.get("email")
    if not email:
        return HttpResponseBadRequest("Email not provided by DAuth.")

    roll_number = user_info.get("rollNumber") or user_info.get("roll_number") or ""
    name = (user_info.get("name") or "").strip()

    # Whitelist validation
    if not is_user_allowed(email, roll_number):
        return HttpResponseForbidden(
            f"Access Denied: Your account ({email}) is not authorized to access this service. "
            "Please contact an administrator to be added to the whitelist."
        )

    # Get or create local user
    user, created = User.objects.get_or_create(
        email=email.lower().strip(),
        defaults={
            "username": email.split("@")[0],
            "first_name": name.split(" ")[0] if " " in name else name,
            "last_name": name.split(" ", 1)[1] if " " in name else "",
        }
    )

    login(request, user)
    return redirect("/")
```

---

### B. TypeScript / Next.js (App Router) Implementation

#### 1. OAuth Initiate Route (`app/api/auth/dauth/route.ts`):
```typescript
import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(request: Request) {
  const dauthHost = (process.env.DAUTH_HOST || "https://auth.delta.nitt.edu").replace(/\/$/, "");
  const clientId = process.env.DAUTH_CLIENT_ID!;
  const redirectUri = process.env.DAUTH_REDIRECT_URI!;
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = new URL(`${dauthHost}/authorize`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("grant_type", "authorization_code");
  authUrl.searchParams.set("scope", "email openid profile user");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", crypto.randomBytes(16).toString("hex"));

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("dauth_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });

  return response;
}
```

#### 2. Callback Route (`app/api/auth/dauth/callback/route.ts`):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { isUserAllowed } from "@/lib/whitelist";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = request.cookies.get("dauth_oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.json({ error: "Invalid state parameter or authorization code" }, { status: 400 });
  }

  const dauthHost = (process.env.DAUTH_HOST || "https://auth.delta.nitt.edu").replace(/\/$/, "");
  const clientId = process.env.DAUTH_CLIENT_ID!;
  const clientSecret = process.env.DAUTH_CLIENT_SECRET!;
  const redirectUri = process.env.DAUTH_REDIRECT_URI!;

  // 1. Exchange code for access token
  const tokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch(`${dauthHost}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Failed to exchange token with DAuth" }, { status: 400 });
  }

  const tokenData = await tokenRes.json();

  // 2. Fetch User Profile using POST
  const userRes = await fetch(`${dauthHost}/api/resources/user`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userRes.ok) {
    return NextResponse.json({ error: "Failed to retrieve user profile from DAuth" }, { status: 400 });
  }

  const user = await userRes.json();
  const { email, rollNumber, name } = user;

  // 3. Verify against Allowlist
  if (!isUserAllowed(email, rollNumber)) {
    return NextResponse.redirect(
      new URL("/auth/error?code=NOT_WHITELISTED&message=" + encodeURIComponent("Your account is not whitelisted."), request.url)
    );
  }

  // 4. Create session / JWT and redirect to dashboard
  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.delete("dauth_oauth_state");
  // Set your session cookie here...

  return response;
}
```

---

## 5. Frontend "Sign in with DAuth" Button

Use the official Delta Force branding for the sign-in button:

```tsx
import React from "react";

export function DAuthLoginButton({ redirectPath = "/api/auth/dauth" }: { redirectPath?: string }) {
  return (
    <a
      href={redirectPath}
      className="inline-flex w-full items-center justify-center gap-3 rounded-lg border border-subtle bg-[#1b1b1b] px-4 py-2.5 text-14 font-medium text-white shadow-sm transition-all hover:bg-[#252525] focus:outline-none focus:ring-2 focus:ring-[#00b55c]/50"
    >
      {/* Delta Green Triangle / Logo Icon */}
      <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12 2L2 22H22L12 2Z"
          fill="#00B55C"
        />
        <path
          d="M12 8L6.5 19H17.5L12 8Z"
          fill="#1B1B1B"
        />
      </svg>
      <span>Sign in with DAuth</span>
    </a>
  );
}
```

---

## 6. Production Security Checklist

- [ ] **Enforce HTTPS**: OAuth 2.0 redirect URIs must strictly use `https://` in staging and production.
- [ ] **State Parameter Validation**: Always generate a cryptographically random `state` stored in an `httpOnly`, `SameSite=Lax`, `Secure` cookie to mitigate CSRF attacks.
- [ ] **HTTP POST for Userinfo**: Verify that userinfo fetch uses `POST ${DAUTH_HOST}/api/resources/user`.
- [ ] **Whitelist Case-Insensitivity**: Always `.toLowerCase().trim()` both user input and the allowlist configuration.
- [ ] **Graceful Access Denied UX**: When `isUserAllowed()` returns false, present a clear, branded error screen explaining that the user is authenticated via DAuth but not yet on the approved user list, with a contact email for access requests.
- [ ] **Admin Bypass Protection**: Ensure that system administrators maintain access even if an allowlist typo or omission occurs.
