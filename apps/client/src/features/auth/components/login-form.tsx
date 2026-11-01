import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Container,
  Title,
  Text,
  Box,
  Alert,
  Stack,
  ThemeIcon,
  Group,
} from "@mantine/core";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import { useRedirectIfAuthenticated } from "@/features/auth/hooks/use-redirect-if-authenticated.ts";
import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query.ts";
import { Error404 } from "@/components/ui/error-404.tsx";
import { AuthLayout } from "./auth-layout.tsx";
import { DAuthLoginButton } from "./dauth-button.tsx";
import classes from "./auth.module.css";

export function LoginForm() {
  const { t } = useTranslation();
  useRedirectIfAuthenticated();
  const {
    data: workspace,
    isLoading: isDataLoading,
    isError,
    error,
  } = useWorkspacePublicDataQuery();

  const searchParams = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );

  const errorCode = searchParams.get("error");
  const errorMsg = searchParams.get("message");
  const userEmail = searchParams.get("email");

  const errorDetails = useMemo(() => {
    if (!errorCode) return null;

    if (errorCode === "NOT_WHITELISTED") {
      return {
        title: t("Access Denied"),
        color: "red",
        message: userEmail
          ? t(
              "Your account ({{email}}) is not authorized to access this workspace. Please contact an administrator to be added to the whitelist.",
              { email: userEmail },
            )
          : t(
              "Your account is not authorized to access this workspace. Please contact an administrator to be added to the whitelist.",
            ),
      };
    }

    if (errorCode === "DAUTH_CONFIG_ERROR") {
      return {
        title: t("Configuration Error"),
        color: "yellow",
        message:
          errorMsg ||
          t(
            "DAuth is not properly configured. Please check environment settings.",
          ),
      };
    }

    if (errorCode === "INVALID_STATE") {
      return {
        title: t("Session Expired"),
        color: "orange",
        message: t(
          "Your authentication session was invalid or expired. Please click below to sign in again.",
        ),
      };
    }

    return {
      title: t("Authentication Failed"),
      color: "red",
      message:
        errorMsg ||
        t("An unexpected error occurred during sign-in. Please try again."),
    };
  }, [errorCode, errorMsg, userEmail, t]);

  if (isDataLoading) {
    return null;
  }

  if (isError && error?.["response"]?.status === 404) {
    return <Error404 />;
  }

  return (
    <AuthLayout>
      <Container size={440} className={classes.container}>
        <Box p="xl" className={classes.containerBox}>
          <Group justify="center" mb="sm">
            <ThemeIcon
              size={48}
              radius="xl"
              variant="light"
              color="green"
              style={{
                backgroundColor: "rgba(33, 192, 15, 0.12)",
                border: "1px solid rgba(33, 192, 15, 0.25)",
              }}
            >
              <IconShieldLock size={26} color="#21C00F" />
            </ThemeIcon>
          </Group>

          <Title order={1} size="h3" ta="center" fw={600} mb={6}>
            {workspace?.name ? workspace.name : t("Welcome to Docmost")}
          </Title>

          <Text c="dimmed" size="sm" ta="center" mb="lg">
            {t("Sign in with your Delta DAuth account to continue")}
          </Text>

          {errorDetails && (
            <Alert
              icon={<IconAlertCircle size={18} />}
              title={errorDetails.title}
              color={errorDetails.color}
              variant="light"
              mb="lg"
              radius="md"
            >
              {errorDetails.message}
            </Alert>
          )}

          <Stack gap="md" mt="md">
            <DAuthLoginButton
              size="lg"
              label={t("Sign in with DAuth")}
              fullWidth
            />

            <Text size="xs" c="dimmed" ta="center" mt="xs">
              {t("Single sign-on powered by Delta DAuth")}
            </Text>
          </Stack>
        </Box>
      </Container>
    </AuthLayout>
  );
}
