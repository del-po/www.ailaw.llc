import { IconName } from '../icon/icons';

export interface SocialLink {
  icon: IconName;
  label: string;
  url: string;
}

// Every network the site links to. Add a URL here once and it is available
// to every <app-social> on the site.
export const SOCIAL_LINKS = {
  facebook: { icon: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/ailawllc' },
  instagram: { icon: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/ailawllc/' },
  youtube: { icon: 'youtube', label: 'YouTube', url: '#' },
  tiktok: { icon: 'tiktok', label: 'TikTok', url: '#' },
} satisfies Record<string, SocialLink>;

export type SocialName = keyof typeof SOCIAL_LINKS;
