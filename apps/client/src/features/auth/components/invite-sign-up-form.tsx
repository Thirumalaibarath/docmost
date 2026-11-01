import * as React from "react";
import { Container, Title, Box, Stack, Text, Badge, Group } from "@mantine/core";
import { useParams } from "react-router-dom";
import classes from "@/features/auth/components/auth.module.css";
import { useGetInvitationQuery } from "@/features/workspace/queries/workspace-query.ts";
import { useRedirectIfAuthenticated } from "@/features/auth/hooks/use-redirect-if-authenticated.ts";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "./auth-layout.tsx";
import { DAuthLoginButton } from "./dauth-button.tsx";

export function InviteSignUpForm() {
  const { t } = useTranslation();
  const params = useParams();

  const { data: invitation, isError } = useGetInvitationQuery(
    params?.invitationId,
  );
  useRedirectIfAuthenticated();

  if (isError) {
    return (
      <AuthLayout>
        <Container size={420} className={classes.container}>
          <Box p="xl" className={classes.containerBox}>
            <Text c="red" ta="center">
              {t("This invitation link is invalid or has expired.")}
            </Text>
          </Box>
        </Container>
      </AuthLayout>
    );
  }

  if (!invitation) {
    return null;
  }

  return (
    <AuthLayout>
      <Container size={420} className={classes.container}>
        <Box p="xl" className={classes.containerBox}>
          <Title order={2} ta="center" fw={600} mb="xs">
            {t("Join the workspace")}
          </Title>

          <Text size="sm" c="dimmed" ta="center" mb="lg">
            {t("You have been invited to join this workspace")}
          </Text>

          <Group justify="center" mb="xl">
            <Badge size="lg" variant="light" color="blue">
              {invitation.email}
            </Badge>
          </Group>

          <Stack align="stretch" justify="center" gap="md">
            <DAuthLoginButton size="lg" label={t("Sign in with DAuth to Join")} />

            <Text size="xs" c="dimmed" ta="center">
              {t("Authenticate with your Delta DAuth account to complete registration")}
            </Text>
          </Stack>
        </Box>
      </Container>
    </AuthLayout>
  );
}
