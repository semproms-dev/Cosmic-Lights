import { Anchor, Badge, Divider, Image, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import {
  IconBrandGithub,
  IconMail,
} from '@tabler/icons-react';
import classes from './styles/About.modal.module.css';
import logoCosmicLights from '../../assets/CosmicLightsLogo.png';
import { useTranslation } from 'react-i18next';

const SUPPORT_EMAIL = 'cosmiclights-support@proton.me';

/**
 * About dialog body. Displays app branding, useful links, and copyright
 * information. Rendered inside a Mantine modal by the NavBar.
 */
export function AboutModal() {
  const { t } = useTranslation(['common']);

  return (
    <Stack gap="lg">
      <div className={classes.hero}>
        <div className={classes.logoHalo}>
          <Image
            src={logoCosmicLights}
            alt="Cosmic Lights"
            h={112}
            w={112}
            fit="contain"
            className={classes.logo}
          />
        </div>
        <Title order={2} className={classes.name}>CosmicLights</Title>
        <Text className={classes.tagline}>
          {t('about.tagline')}
        </Text>
        <Badge
          variant="light"
          color="blue"
          size="lg"
          radius="xl"
          className={classes.versionBadge}
        >
          v{__APP_VERSION__}
        </Badge>
      </div>

      <SimpleGrid cols={2} spacing="sm">
        <Anchor
          className={classes.linkCard}
          href="https://github.com/semproms-dev/Cosmic-Lights"
          target="_blank"
          rel="noopener noreferrer"
        >
          <ThemeIcon variant="light" color="blue" size="lg" radius="md">
            <IconBrandGithub size="1.125rem" stroke={1.5} />
          </ThemeIcon>
          <span className={classes.linkText}>
            <Text component="span" size="sm" fw={600}>{t('about.sourceCode')}</Text>
            <Text component="span" size="xs" c="dimmed">GitHub</Text>
          </span>
        </Anchor>

        <Anchor className={classes.linkCard} href={`mailto:${SUPPORT_EMAIL}`}>
          <ThemeIcon variant="light" color="grape" size="lg" radius="md">
            <IconMail size="1.125rem" stroke={1.5} />
          </ThemeIcon>
          <span className={classes.linkText}>
            <Text component="span" size="sm" fw={600}>{t('about.email')}</Text>
            <Text component="span" size="xs" c="dimmed" className={classes.linkValue}>{SUPPORT_EMAIL}</Text>
          </span>
        </Anchor>
      </SimpleGrid>

      <Divider />

      <div className={classes.footer}>
        <Text className={classes.footerText}>
          {t('about.builtWith')}
        </Text>
        <Text className={classes.footerText}>
          &copy; {new Date().getFullYear()} {t('about.copyright')}
        </Text>
      </div>
    </Stack>
  );
}
