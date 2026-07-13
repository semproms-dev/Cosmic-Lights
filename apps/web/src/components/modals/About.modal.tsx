import { Badge, SimpleGrid, Text, Title } from '@mantine/core';
import { SiLens } from 'react-icons/si';
import {
  IconAdjustments,
  IconPhoto,
  IconBrandGithub,
  IconWorld,
} from '@tabler/icons-react';
import classes from './styles/About.modal.module.css';

const APP_VERSION = '1.0.0';

const features = [
  {
    icon: IconAdjustments,
    label: 'RAW Processing',
    description: 'Fine-tune exposure, white balance, tone curves, and more',
  },
  {
    icon: IconPhoto,
    label: 'Non-Destructive',
    description: 'Edit freely with full undo/redo support',
  },
] as const;

/**
 * About dialog body. Displays app branding, feature highlights, useful links,
 * and copyright information. Rendered inside a Mantine modal by the NavBar.
 */
export function AboutModal() {
  return (
    <div>
      <div className={classes.hero}>
        <div className={classes.logo}>
          <SiLens size={40} />
        </div>
        <Title order={3}>CosmicLights</Title>
        <Text className={classes.tagline}>
          Professional RAW photo processing in your browser
        </Text>
        <Badge
          variant="light"
          color="blue"
          size="lg"
          className={classes.versionBadge}
        >
          v{APP_VERSION}
        </Badge>
      </div>

      <div className={classes.links}>
        <a
          className={classes.link}
          href="https://github.com/semproms/CosmicLights"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconBrandGithub size={16} stroke={1.5} />
          Source Code
        </a>
        <a
          className={classes.link}
          href="https://cosmiclights.app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconWorld size={16} stroke={1.5} />
          Website
        </a>
      </div>

      <div className={classes.footer}>
        <Text className={classes.footerText}>
          Built with React, Mantine, and Vite
        </Text>
        <Text className={classes.footerText}>
          &copy; {new Date().getFullYear()} CosmicLights. All rights reserved.
        </Text>
      </div>
    </div>
  );
}
