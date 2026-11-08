import { Badge, Text, Title, Image } from '@mantine/core';
import {
  IconBrandGithub,
  IconWorld,
} from '@tabler/icons-react';
import classes from './styles/About.modal.module.css';
import logoCosmicLights from '../../assets/CosmicLightsLogo.png';
import { useTranslation } from 'react-i18next';

/**
 * About dialog body. Displays app branding, feature highlights, useful links,
 * and copyright information. Rendered inside a Mantine modal by the NavBar.
 */
export function AboutModal() {
  const { t } = useTranslation(['common']);

  return (
    <div>
      <div className={classes.hero}>
          <Image src={logoCosmicLights} alt='Cosmic Lights' h={160} w={160} />
        <Title order={3}>CosmicLights</Title>
        <Text className={classes.tagline}>
          {t('about.tagline')}
        </Text>
        <Badge
          variant="light"
          color="blue"
          size="lg"
          className={classes.versionBadge}
        >
          v{__APP_VERSION__}
        </Badge>
      </div>

      <div className={classes.links}>
        <a
          className={classes.link}
          href="https://github.com/semproms-dev/Cosmic-Lights"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconBrandGithub size="1rem" stroke={1.5} />
          {t('about.sourceCode')}
        </a>
      </div>

      <div className={classes.footer}>
        <Text className={classes.footerText}>
          {t('about.builtWith')}
        </Text>
        <Text className={classes.footerText}>
          &copy; {new Date().getFullYear()} {t('about.copyright')}
        </Text>
      </div>
    </div>
  );
}
