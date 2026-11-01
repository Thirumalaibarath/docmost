import * as React from "react";
import { Container, Title, Box, Stack, Text, ThemeIcon, Group } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import classes from "@/features/auth/components/auth.module.css";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "./auth-layout.tsx";
import { DAuthLoginButton } from "./dauth-button.tsx";

export function SetupWorkspaceForm() {
  const { t } = useTranslation();

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
              <IconSparkles size={26} color="#21C00F" />
            </ThemeIcon>
          </Group>

          <Title order={2} ta="center" fw={600} mb="xs">
            {t("Setup Your Workspace")}
          </Title>

          <Text size="sm" c="dimmed" ta="center" mb="xl">
            {t(
              "Initialize your Docmost workspace and claim instance administrator access with DAuth",
            )}
          </Text>

          <Stack align="stretch" justify="center" gap="md">
            <DAuthLoginButton
              size="lg"
              label={t("Initialize Workspace with DAuth")}
            />

            <Text size="xs" c="dimmed" ta="center">
              {t(
                "The first authenticated user will automatically become the instance Owner",
              )}
            </Text>
          </Stack>
        </Box>
      </Container>
    </AuthLayout>
  );
}
