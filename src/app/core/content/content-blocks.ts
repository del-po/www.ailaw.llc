// ==========================================================
// The website's editable text (Admin Panel → Content)
// Every block the admin can change: where it shows, what kind it is, and
// its text as the website was written. Pages ask ContentService for a
// block and get the published text, or this default when nothing is
// published, so a block never shows empty.
// Kinds:
//   text      one line or paragraph, as typed
//   markdown  formatted text (headings, lists, bold, links)
//   list      several items with the same fields (slides, FAQs, principles)
//   fields    one set of named fields (contact details, the announcement)
// Layouts, styles and links between pages stay in the code.
// ==========================================================

export type BlockType = 'text' | 'markdown' | 'list' | 'fields';

export interface BlockField {
  key: string;
  label: string;
  // markdown: formatted; long: several lines of plain text; check: on/off
  kind?: 'text' | 'long' | 'markdown' | 'check';
}

export type BlockValue =
  string | Record<string, string | boolean> | Record<string, string | boolean>[];

export interface ContentBlock {
  key: string;
  page: string;
  label: string;
  hint?: string;
  type: BlockType;
  // list and fields: the fields of an item
  fields?: BlockField[];
  // list: a fixed number of items (e.g. the three home slides)
  fixed?: number;
  default: BlockValue;
}

export const CONTENT_BLOCKS: ContentBlock[] = [
  // ---------- Homepage ----------
  {
    key: 'home.slides',
    page: 'Homepage',
    label: 'Rotating intro',
    hint: 'The three texts on the left of the homepage. Their buttons keep their links.',
    type: 'list',
    fixed: 3,
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'tag', label: 'Tag' },
      { key: 'text', label: 'Text', kind: 'long' },
      { key: 'cta', label: 'Button' },
    ],
    default: [
      {
        title: '24/7 Online',
        tag: 'Always available',
        text: 'Access professional legal assistance anytime, with round-the-clock availability whenever you need us.',
        cta: 'Start chat',
      },
      {
        title: 'Top Quality',
        tag: 'Expertise + AI',
        text: 'We bring together exceptional legal expertise and advanced technology to deliver outstanding legal services.',
        cta: 'Our services',
      },
      {
        title: 'Fair Prices',
        tag: 'Fixed prices',
        text: 'We believe quality legal services should be accessible to everyone, offering professional assistance at competitive prices.',
        cta: 'See prices',
      },
    ],
  },
  {
    key: 'home.chatCard',
    page: 'Homepage',
    label: 'Chat card',
    type: 'fields',
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'placeholder', label: 'Text in the empty box' },
    ],
    default: { title: 'Ask AI Law', placeholder: 'Describe your legal question…' },
  },
  {
    key: 'home.motto',
    page: 'Homepage',
    label: 'Motto under the frame',
    type: 'text',
    default: 'WE WILL ALWAYS HELP YOU',
  },

  // ---------- About ----------
  {
    key: 'about.lead',
    page: 'About AI Law',
    label: 'Introduction',
    type: 'text',
    default:
      'AI Law is a forward-thinking Georgian law firm dedicated to modernizing the legal experience. We offer comprehensive legal counsel across a wide spectrum of practice areas, from high-stakes litigation and corporate transactions to intricate tax and accounting matters, complemented by expert legal document drafting.',
  },
  {
    key: 'about.principles',
    page: 'About AI Law',
    label: 'Principles',
    type: 'list',
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'text', label: 'Text', kind: 'long' },
    ],
    default: [
      {
        title: 'An Unwavering Commitment to Excellence',
        text: 'We deliver the highest caliber of legal service, ensuring meticulous attention to every detail.',
      },
      {
        title: 'Elite Talent',
        text: 'We recruit and nurture the brightest legal minds emerging from academia.',
      },
      {
        title: 'Technological Innovation',
        text: 'We are pioneering the future of legal services through intelligent automation, aiming to make legal support more efficient and accessible.',
      },
    ],
  },
  {
    key: 'about.model',
    page: 'About AI Law',
    label: 'Legal products, not billable hours',
    type: 'fields',
    fields: [
      { key: 'title', label: 'Heading' },
      { key: 'text', label: 'Text', kind: 'markdown' },
    ],
    default: {
      title: 'Legal products, not billable hours',
      text: 'This ambition drives us to innovate beyond the traditional legal model. Instead of billing by the hour, we offer our expertise through clearly defined legal products. This product-based approach ensures absolute transparency, predictable costs, and exceptional value, giving our clients peace of mind.\n\nWe invite you to discover a new standard in legal services.',
    },
  },
  {
    key: 'about.channels',
    page: 'About AI Law',
    label: 'From our channels',
    type: 'fields',
    fields: [
      { key: 'title', label: 'Heading' },
      { key: 'text', label: 'Text', kind: 'markdown' },
    ],
    default: {
      title: 'From our channels',
      text: 'Some of the content we create for our social media platforms is designed to be interesting, entertaining, and hopefully educational. Follow us to see it as it comes out.',
    },
  },
  {
    key: 'about.founder',
    page: 'About AI Law',
    label: 'The founder',
    type: 'fields',
    fields: [
      { key: 'title', label: 'Heading' },
      { key: 'text', label: 'Text', kind: 'markdown' },
    ],
    default: {
      title: 'The founder',
      text: 'To learn more about our founder, [read his story](/bio).',
    },
  },
  {
    key: 'about.faq',
    page: 'About AI Law',
    label: 'Frequently asked questions',
    hint: 'Shown at the end of the About page once there is at least one question.',
    type: 'list',
    fields: [
      { key: 'question', label: 'Question' },
      { key: 'answer', label: 'Answer', kind: 'markdown' },
    ],
    default: [],
  },

  // ---------- Contacts ----------
  {
    key: 'site.contacts',
    page: 'Contacts',
    label: 'Contact details',
    hint: 'Shown on the About page; an empty field isn’t shown.',
    type: 'fields',
    fields: [
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'address', label: 'Address' },
      { key: 'hours', label: 'Working hours' },
      { key: 'telegram', label: 'Telegram link' },
      { key: 'whatsapp', label: 'WhatsApp link' },
    ],
    default: {
      email: 'info@ailaw.llc',
      phone: '(+995) 591 893 893',
      address: '83 Chavchavadze Avenue, Tbilisi, GEO 0162',
      hours: 'Every day, 9:00 to 21:00',
      telegram: '',
      whatsapp: '',
    },
  },
  {
    key: 'site.social',
    page: 'Contacts',
    label: 'Social media links',
    hint: 'The icons in the footer, on the homepage and the About page. An empty link hides its icon.',
    type: 'fields',
    fields: [
      { key: 'facebook', label: 'Facebook' },
      { key: 'instagram', label: 'Instagram' },
      { key: 'youtube', label: 'YouTube' },
      { key: 'tiktok', label: 'TikTok' },
    ],
    default: {
      facebook: 'https://www.facebook.com/ailawllc',
      instagram: 'https://www.instagram.com/ailawllc/',
      youtube: '#',
      tiktok: '#',
    },
  },

  // ---------- Announcement ----------
  {
    key: 'site.announcement',
    page: 'Announcement',
    label: 'Announcement bar',
    hint: 'A line at the top of every page while it is switched on. Visitors can close it.',
    type: 'fields',
    fields: [
      { key: 'text', label: 'Text', kind: 'markdown' },
      { key: 'active', label: 'Show it', kind: 'check' },
    ],
    default: { text: '', active: false },
  },

  // ---------- Legal ----------
  {
    key: 'legal.privacy',
    page: 'Legal',
    label: 'Privacy policy',
    hint: '"#" starts a part (it appears in the contents list), "##" a sub-heading.',
    type: 'markdown',
    // The admin page fills this in from legal-defaults.ts
    default: '',
  },
  {
    key: 'legal.terms',
    page: 'Legal',
    label: 'Terms and conditions',
    hint: '"#" starts a part (it appears in the contents list), "##" a sub-heading.',
    type: 'markdown',
    default: '',
  },
];

export const BLOCKS_BY_KEY: Record<string, ContentBlock> = Object.fromEntries(
  CONTENT_BLOCKS.map((b) => [b.key, b]),
);

// The fields of a list or fields block written in Markdown (rendered by the backend)
export const markdownFields = (block: ContentBlock): string[] =>
  (block.fields ?? []).filter((f) => f.kind === 'markdown').map((f) => f.key);
