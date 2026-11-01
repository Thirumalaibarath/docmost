import React, { useState } from "react";
import { Button } from "@mantine/core";
import { DeltaTriangleIcon } from "@/components/icons/delta-triangle-icon";
import { getRedirectParam } from "@/lib/app-route";

interface DAuthLoginButtonProps {
  label?: string;
  fullWidth?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}

export function DAuthLoginButton({
  label = "Sign in with DAuth",
  fullWidth = true,
  size = "md",
}: DAuthLoginButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    setLoading(true);
    const redirect = getRedirectParam();
    const targetUrl = redirect
      ? `/api/auth/dauth/login?redirect=${encodeURIComponent(redirect)}`
      : `/api/auth/dauth/login`;
    window.location.href = targetUrl;
  };

  return (
    <Button
      onClick={handleClick}
      loading={loading}
      fullWidth={fullWidth}
      size={size}
      leftSection={<DeltaTriangleIcon size={22} />}
      styles={{
        root: {
          backgroundColor: "#18181b",
          color: "#ffffff",
          border: "1px solid rgba(33, 192, 15, 0.45)",
          fontWeight: 600,
          letterSpacing: "0.2px",
          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow:
            "0 2px 8px rgba(0, 0, 0, 0.12), 0 0 12px rgba(33, 192, 15, 0.15)",
        },
      }}
    >
      {label}
    </Button>
  );
}
