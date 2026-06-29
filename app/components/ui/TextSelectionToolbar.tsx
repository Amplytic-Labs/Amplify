/**
 * TextSelectionToolbar
 *
 * A floating toolbar that appears when the user selects text anywhere on the
 * page (scope="global") or within a specified container (scope="parent").
 *
 * Adapted from the Framer TextSelectionActions component — all Framer-specific
 * APIs removed. Works in any React 18 / Remix environment.
 */
import * as React from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Icons ────────────────────────────────────────────────────────────────────

const Icons = {
  copy: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  search: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  x: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
      <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
    </svg>
  ),
  share: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  highlight: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l-6 6v3h9l3-3" />
      <path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  ),
  readAloud: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  stopAudio: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ),
  ai: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2z" />
    </svg>
  ),
  whatsapp: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  ),
  telegram: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  ),
  link: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  native: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
  perplexity: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M8 .188a.5.5 0 0 1 .503.5V4.03l3.022-2.92.059-.048a.51.51 0 0 1 .49-.054.5.5 0 0 1 .306.46v3.247h1.117l.1.01a.5.5 0 0 1 .403.49v5.558a.5.5 0 0 1-.503.5H12.38v3.258a.5.5 0 0 1-.312.462.51.51 0 0 1-.55-.11l-3.016-3.018v3.448c0 .275-.225.5-.503.5a.5.5 0 0 1-.503-.5v-3.448l-3.018 3.019a.51.51 0 0 1-.548.11.5.5 0 0 1-.312-.463v-3.258H2.503a.5.5 0 0 1-.503-.5V5.215l.01-.1c.047-.229.25-.4.493-.4H3.62V1.469l.006-.074a.5.5 0 0 1 .302-.387.51.51 0 0 1 .547.102l3.023 2.92V.687c0-.276.225-.5.503-.5M4.626 9.333v3.984l2.87-2.872v-4.01zm3.877 1.113 2.871 2.871V9.333l-2.87-2.897zm3.733-1.668a.5.5 0 0 1 .145.35v1.145h.612V5.715H9.201zm-9.23 1.495h.613V9.13c0-.131.052-.257.145-.35l3.033-3.064h-3.79zm1.62-5.558H6.76L4.626 2.652zm4.613 0h2.134V2.652z"
      />
    </svg>
  ),
  chatgpt: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  ),
  claude: (
    <svg width="16" height="16" viewBox="0 0 512 509.64" fill="currentColor">
      <path
        d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.612-115.613 115.612H115.612C52.026 509.639 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z"
        fill="#D77655"
      />
      <path
        fill="#FCF2EE"
        fillRule="nonzero"
        d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474z"
      />
    </svg>
  ),
  grok: (
    <svg width="16" height="16" viewBox="0 0 512 509.641" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M115.612 0h280.776C459.975 0 512 52.026 512 115.612v278.416c0 63.587-52.025 115.613-115.612 115.613H115.612C52.026 509.641 0 457.615 0 394.028V115.612C0 52.026 52.026 0 115.612 0z"
        fill="#000000"
      />
      <path
        fill="#fff"
        d="M213.235 306.019l178.976-180.002v.169l51.695-51.763c-.924 1.32-1.86 2.605-2.785 3.89-39.281 54.164-58.46 80.649-43.07 146.922l-.09-.101c10.61 45.11-.744 95.137-37.398 131.836-46.216 46.306-120.167 56.611-181.063 14.928l42.462-19.675c38.863 15.278 81.392 8.57 111.947-22.03 30.566-30.6 37.432-75.159 22.065-112.252-2.92-7.025-11.67-8.795-17.792-4.263l-124.947 92.341zm-25.786 22.437l-.033.034L68.094 435.217c7.565-10.429 16.957-20.294 26.327-30.149 26.428-27.803 52.653-55.359 36.654-94.302-21.422-52.112-8.952-113.177 30.724-152.898 41.243-41.254 101.98-51.661 152.706-30.758 11.23 4.172 21.016 10.114 28.638 15.639l-42.359 19.584c-39.44-16.563-84.629-5.299-112.207 22.313-37.298 37.308-44.84 102.003-1.128 143.81z"
      />
    </svg>
  ),
  quoteAsk: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h.01" />
      <path d="M12 10h.01" />
      <path d="M16 10h.01" />
    </svg>
  ),
};

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionId = 'copy' | 'quote' | 'readAloud' | 'search' | 'aiSearch' | 'x' | 'share';

interface Theme {
  background: string;
  iconColor: string;
  iconHoverBackground: string;
  highlightColor: string;
  shadow: string;
  radius: number;
}

interface SelectionState {
  text: string;
  range: Range;
}

interface PositionState {
  top: number;
  left: number;
  isFlipped: boolean;
}

interface SubMenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  action: (text: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIsMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const hasTouchScreen =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    (navigator as any).msMaxTouchPoints > 0;
  return hasTouchScreen && window.innerWidth < 768;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TextSelectionToolbarProps {
  /** Which actions to show in the toolbar */
  actions?: ActionId[];
  /** Visual theme overrides */
  theme?: Partial<Theme>;
  /**
   * 'global' = whole page (default)
   * 'parent' = scoped to the element pointed to by parentRef
   */
  scope?: 'global' | 'parent';
  /** Ref to scope selections within (only used when scope="parent") */
  parentRef?: React.RefObject<HTMLElement>;
}

// ─── Default theme (dark) ─────────────────────────────────────────────────────

const DEFAULT_THEME: Theme = {
  background: '#1A1A1A',
  iconColor: '#FFFFFF',
  iconHoverBackground: 'rgba(255,255,255,0.12)',
  highlightColor: 'rgba(255, 235, 59, 0.4)',
  shadow: 'none',
  radius: 8,
};

const DEFAULT_ACTIONS: ActionId[] = ['copy', 'quote', 'readAloud', 'search', 'aiSearch', 'x', 'share'];

// ─── Component ────────────────────────────────────────────────────────────────

export function TextSelectionToolbar({
  actions = DEFAULT_ACTIONS,
  theme: themeProp,
  scope = 'global',
  parentRef,
}: TextSelectionToolbarProps) {
  const theme: Theme = { ...DEFAULT_THEME, ...themeProp };

  const [selection, setSelection] = React.useState<SelectionState | null>(null);
  const [position, setPosition] = React.useState<PositionState | null>(null);
  const [isCopied, setIsCopied] = React.useState(false);
  const [activeMenu, setActiveMenu] = React.useState<'share' | 'ai' | null>(null);
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [isSpeaking, setIsSpeaking] = React.useState(false);

  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // ── Inject Custom Highlight CSS ──────────────────────────────────────────
  React.useEffect(() => {
    const styleId = 'text-selection-toolbar-highlight';
    let el = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = styleId;
      document.head.appendChild(el);
    }
    el.innerHTML = `::highlight(framer-custom-highlight) { background-color: ${theme.highlightColor}; color: inherit; }`;
  }, [theme.highlightColor]);

  // ── Share options ────────────────────────────────────────────────────────
  const shareOptions: SubMenuItem[] = React.useMemo(() => {
    const opts: SubMenuItem[] = [
      {
        id: 'whatsapp',
        label: 'WhatsApp',
        icon: Icons.whatsapp,
        color: '#25D366',
        action: (text) => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank'),
      },
      {
        id: 'telegram',
        label: 'Telegram',
        icon: Icons.telegram,
        color: '#0088cc',
        action: (text) =>
          window.open(
            `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(text)}`,
            '_blank',
          ),
      },
      {
        id: 'copylink',
        label: linkCopied ? 'Copied!' : 'Copy Link',
        icon: linkCopied ? Icons.check : Icons.link,
        color: linkCopied ? '#22c55e' : '#6B7280',
        action: () => {
          navigator.clipboard.writeText(window.location.href);
          setLinkCopied(true);
          setTimeout(() => setLinkCopied(false), 2000);
        },
      },
    ];
    if (typeof navigator !== 'undefined' && navigator.share) {
      opts.push({
        id: 'native',
        label: 'More…',
        icon: Icons.native,
        color: '#8855FF',
        action: async (text) => {
          try {
            await navigator.share({ text, url: window.location.href });
          } catch { /* user dismissed */ }
        },
      });
    }
    return opts;
  }, [linkCopied]);

  // ── AI options ───────────────────────────────────────────────────────────
  const aiOptions: SubMenuItem[] = React.useMemo(
    () => [
      {
        id: 'perplexity',
        label: 'Ask Perplexity',
        icon: Icons.perplexity,
        color: '#20B8CD',
        action: (text) => window.open(`https://www.perplexity.ai/search?q=${encodeURIComponent(text)}`, '_blank'),
      },
      {
        id: 'chatgpt',
        label: 'Ask ChatGPT',
        icon: Icons.chatgpt,
        color: '#10A37F',
        action: (text) => window.open(`https://chatgpt.com/?q=${encodeURIComponent(text)}`, '_blank'),
      },
      {
        id: 'claude',
        label: 'Ask Claude',
        icon: Icons.claude,
        color: '#D97757',
        action: (text) => window.open(`https://claude.ai/new?q=${encodeURIComponent(text)}`, '_blank'),
      },
      {
        id: 'grok',
        label: 'Ask Grok',
        icon: Icons.grok,
        color: '#1A1A1A',
        action: (text) => window.open(`https://grok.com/?q=${encodeURIComponent(text)}`, '_blank'),
      },
    ],
    [],
  );

  // ── Close submenu on outside click ──────────────────────────────────────
  React.useEffect(() => {
    if (!activeMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [activeMenu]);

  // ── Clear state when selection disappears ───────────────────────────────
  React.useEffect(() => {
    if (!selection) {
      setActiveMenu(null);
      if (isSpeaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // ── Dismiss submenu on scroll ────────────────────────────────────────────
  React.useEffect(() => {
    if (!activeMenu) return;
    const handle = () => setActiveMenu(null);
    window.addEventListener('scroll', handle, true);
    return () => window.removeEventListener('scroll', handle, true);
  }, [activeMenu]);

  // ── Cleanup speech on unmount ────────────────────────────────────────────
  React.useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  // ── Selection change handler ─────────────────────────────────────────────
  const updateSelection = React.useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
      setSelection(null);
      setPosition(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;

    // Scope check
    if (scope === 'parent' && parentRef?.current) {
      const nodeToCheck =
        ancestor.nodeType === Node.TEXT_NODE
          ? (ancestor as Text).parentElement
          : (ancestor as Element);
      if (!nodeToCheck || !parentRef.current.contains(nodeToCheck)) {
        setSelection(null);
        setPosition(null);
        return;
      }
    }

    setSelection({ text: sel.toString(), range });

    const rect = range.getBoundingClientRect();
    const TOOLBAR_WIDTH = 340;
    const TOOLBAR_HEIGHT = 46;
    const GAP = 10;

    let top = rect.top - TOOLBAR_HEIGHT - GAP;
    let isFlipped = false;
    if (top < 10) {
      top = rect.bottom + GAP;
      isFlipped = true;
    }

    let left = rect.left + rect.width / 2;
    const minLeft = TOOLBAR_WIDTH / 2 + 16;
    const maxLeft = window.innerWidth - (TOOLBAR_WIDTH / 2 + 16);
    left = Math.max(minLeft, Math.min(maxLeft, left));

    setPosition({ top, left, isFlipped });
  }, [scope, parentRef]);

  React.useEffect(() => {
    document.addEventListener('selectionchange', updateSelection);
    window.addEventListener('resize', updateSelection);
    window.addEventListener('scroll', updateSelection, true);
    return () => {
      document.removeEventListener('selectionchange', updateSelection);
      window.removeEventListener('resize', updateSelection);
      window.removeEventListener('scroll', updateSelection, true);
    };
  }, [updateSelection]);

  // ── Submenu positioning ──────────────────────────────────────────────────
  const getSubmenuStyle = (): React.CSSProperties => {
    if (!toolbarRef.current || !position) return {};
    const toolbarRect = toolbarRef.current.getBoundingClientRect();
    const MENU_WIDTH = 200;
    const GAP = 8;
    const VP = 12;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const itemCount = activeMenu === 'share' ? shareOptions.length : aiOptions.length;
    const MENU_NAT_H = itemCount * 44 + 48;
    const isNarrow = viewW < 640;

    if (isNarrow) {
      let menuLeft = toolbarRect.left + toolbarRect.width / 2 - MENU_WIDTH / 2;
      menuLeft = Math.max(VP, Math.min(menuLeft, viewW - MENU_WIDTH - VP));
      const spaceAbove = toolbarRect.top - VP;
      const spaceBelow = viewH - toolbarRect.bottom - VP;
      let menuTop: number, maxH: number;
      if (spaceAbove >= MENU_NAT_H || spaceAbove > spaceBelow) {
        maxH = Math.min(MENU_NAT_H, spaceAbove - GAP);
        menuTop = toolbarRect.top - maxH - GAP;
      } else {
        maxH = Math.min(MENU_NAT_H, spaceBelow - GAP);
        menuTop = toolbarRect.bottom + GAP;
      }
      return {
        position: 'fixed',
        top: Math.max(VP, menuTop),
        left: menuLeft,
        width: MENU_WIDTH,
        maxHeight: Math.max(100, maxH),
        zIndex: 100000,
      };
    }

    const spaceRight = viewW - toolbarRect.right - VP;
    const spaceLeft = toolbarRect.left - VP;
    let menuLeft: number;

    if (spaceRight >= MENU_WIDTH + GAP) {
      menuLeft = toolbarRect.right + GAP;
    } else if (spaceLeft >= MENU_WIDTH + GAP) {
      menuLeft = toolbarRect.left - MENU_WIDTH - GAP;
    } else {
      menuLeft = toolbarRect.left + toolbarRect.width / 2 - MENU_WIDTH / 2;
      menuLeft = Math.max(VP, Math.min(menuLeft, viewW - MENU_WIDTH - VP));
      const spaceBelow = viewH - toolbarRect.bottom - VP;
      const spaceAbove = toolbarRect.top - VP;
      let menuTop: number, maxH: number;
      if (spaceBelow >= MENU_NAT_H || spaceBelow > spaceAbove) {
        maxH = Math.min(MENU_NAT_H, spaceBelow - GAP);
        menuTop = toolbarRect.bottom + GAP;
      } else {
        maxH = Math.min(MENU_NAT_H, spaceAbove - GAP);
        menuTop = toolbarRect.top - maxH - GAP;
      }
      return {
        position: 'fixed',
        top: Math.max(VP, menuTop),
        left: menuLeft,
        width: MENU_WIDTH,
        maxHeight: Math.max(100, maxH),
        zIndex: 100000,
      };
    }

    let menuTop = toolbarRect.top;
    let maxH = Math.min(MENU_NAT_H, viewH - VP * 2);
    if (menuTop + maxH > viewH - VP) menuTop = viewH - maxH - VP;
    if (menuTop < VP) { menuTop = VP; maxH = viewH - VP * 2; }

    return {
      position: 'fixed',
      top: menuTop,
      left: menuLeft,
      width: MENU_WIDTH,
      maxHeight: Math.max(100, maxH),
      zIndex: 100000,
    };
  };

  // ── Action handlers ──────────────────────────────────────────────────────
  const preventDeselect = (e: React.MouseEvent) => e.preventDefault();

  const handleCopy = () => {
    if (!selection) return;
    navigator.clipboard.writeText(selection.text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSearch = () => {
    if (!selection) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(selection.text)}`, '_blank');
  };

  const handleXShare = () => {
    if (!selection) return;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(selection.text)}`, '_blank');
  };

  const handleReadAloud = () => {
    if (!selection) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(selection.text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  const handleQuote = () => {
    if (!selection) return;
    // Dispatch a custom event that Chat.client.tsx listens for
    window.dispatchEvent(
      new CustomEvent('amplify:quote-text', { detail: selection.text }),
    );
    // Clear the selection so the toolbar disappears
    window.getSelection()?.removeAllRanges();
  };

  const toggleMenu = (menuName: 'share' | 'ai') => {
    setActiveMenu((prev) => (prev === menuName ? null : menuName));
  };

  // ── Submenu items renderer ───────────────────────────────────────────────
  const renderSubmenuItems = (items: SubMenuItem[]) =>
    items.map((option, index) => (
      <motion.button
        key={option.id}
        onMouseDown={preventDeselect}
        onClick={() => {
          if (selection) option.action(selection.text);
          if (option.id !== 'copylink') setActiveMenu(null);
        }}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.035, duration: 0.2 }}
        whileHover={{ backgroundColor: theme.iconHoverBackground }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          border: 'none',
          background: 'transparent',
          color: theme.iconColor,
          cursor: 'pointer',
          borderRadius: Math.max(theme.radius - 4, 4),
          fontSize: 13,
          fontWeight: 500,
          fontFamily: 'Inter, system-ui, sans-serif',
          textAlign: 'left',
          width: '100%',
          transition: 'background 0.15s ease',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            minWidth: 28,
            minHeight: 28,
            borderRadius: 8,
            backgroundColor: option.id === 'grok' ? 'rgba(255,255,255,0.15)' : option.color + '18',
            color: option.id === 'grok' ? '#ffffff' : option.color,
            flexShrink: 0,
          }}
        >
          {option.icon}
        </span>
        <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{option.label}</span>
      </motion.button>
    ));

  // ── Action button renderer ───────────────────────────────────────────────
  const renderAction = (type: ActionId) => {
    const btnStyle: React.CSSProperties = {
      background: 'transparent',
      border: 'none',
      color: theme.iconColor,
      cursor: 'pointer',
      padding: '8px 10px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Math.max(theme.radius - 4, 4),
      transition: 'background 0.2s ease',
    };

    const commonProps = {
      onMouseDown: preventDeselect,
      style: btnStyle,
      whileHover: { backgroundColor: theme.iconHoverBackground },
      whileTap: { scale: 0.95 },
    };

    switch (type) {
      case 'copy':
        return (
          <motion.button key="copy" onClick={handleCopy} title="Copy" {...commonProps}>
            {isCopied ? Icons.check : Icons.copy}
          </motion.button>
        );
      case 'quote':
        return (
          <motion.button key="quote" onClick={handleQuote} title="Ask about this" {...commonProps}>
            {Icons.quoteAsk}
          </motion.button>
        );
      case 'search':
        return (
          <motion.button key="search" onClick={handleSearch} title="Search Google" {...commonProps}>
            {Icons.search}
          </motion.button>
        );
      case 'x':
        return (
          <motion.button key="x" onClick={handleXShare} title="Post to X" {...commonProps}>
            {Icons.x}
          </motion.button>
        );
      case 'readAloud':
        return (
          <motion.button
            key="readAloud"
            onClick={handleReadAloud}
            onMouseDown={preventDeselect}
            style={{
              ...btnStyle,
              backgroundColor: isSpeaking ? theme.iconHoverBackground : 'transparent',
            }}
            whileHover={{ backgroundColor: theme.iconHoverBackground }}
            whileTap={{ scale: 0.95 }}
            title={isSpeaking ? 'Stop' : 'Read Aloud'}
          >
            {isSpeaking ? (
              <motion.span
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                style={{ display: 'flex' }}
              >
                {Icons.stopAudio}
              </motion.span>
            ) : (
              Icons.readAloud
            )}
          </motion.button>
        );
      case 'share':
        return (
          <motion.button
            key="share"
            onClick={() => toggleMenu('share')}
            onMouseDown={preventDeselect}
            style={{
              ...btnStyle,
              backgroundColor: activeMenu === 'share' ? theme.iconHoverBackground : 'transparent',
            }}
            whileHover={{ backgroundColor: theme.iconHoverBackground }}
            whileTap={{ scale: 0.95 }}
            title="Share"
          >
            {Icons.share}
          </motion.button>
        );
      case 'aiSearch':
        return (
          <motion.button
            key="aiSearch"
            onClick={() => toggleMenu('ai')}
            onMouseDown={preventDeselect}
            style={{
              ...btnStyle,
              backgroundColor: activeMenu === 'ai' ? theme.iconHoverBackground : 'transparent',
            }}
            whileHover={{ backgroundColor: theme.iconHoverBackground }}
            whileTap={{ scale: 0.95 }}
            title="Ask AI"
          >
            {Icons.ai}
          </motion.button>
        );
      default:
        return null;
    }
  };

  // ── SSR guard ────────────────────────────────────────────────────────────
  if (typeof document === 'undefined') return null;

  const activeMenuTitle =
    activeMenu === 'share' ? 'Share via' : activeMenu === 'ai' ? 'Search with AI' : '';
  const activeMenuItems =
    activeMenu === 'share' ? shareOptions : activeMenu === 'ai' ? aiOptions : [];

  return (
    <>
      {/* ── Floating toolbar ─────────────────────────────────────────── */}
      {ReactDOM.createPortal(
        <AnimatePresence>
          {position && selection && (
            <motion.div
              ref={toolbarRef}
              onMouseDown={preventDeselect}
              initial={{ opacity: 0, y: position.isFlipped ? -10 : 10, scale: 0.95, x: '-50%' }}
              animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
              exit={{ opacity: 0, scale: 0.95, y: position.isFlipped ? -5 : 5, x: '-50%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                padding: 4,
                background: theme.background,
                borderRadius: theme.radius,
                pointerEvents: 'auto',
              }}
            >
              {actions.map(renderAction)}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* ── Submenu (share / AI) ──────────────────────────────────────── */}
      {ReactDOM.createPortal(
        <AnimatePresence>
          {activeMenu && position && selection && (
            <motion.div
              ref={menuRef}
              onMouseDown={preventDeselect}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ type: 'spring', damping: 25, stiffness: 400 }}
              style={{
                ...getSubmenuStyle(),
                background: theme.background,
                borderRadius: theme.radius,
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                overflowY: 'auto',
                overflowX: 'hidden',
                pointerEvents: 'auto',
              }}
            >
              <div
                style={{
                  padding: '4px 8px 6px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: theme.iconColor,
                  opacity: 0.45,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  flexShrink: 0,
                }}
              >
                {activeMenuTitle}
              </div>
              {renderSubmenuItems(activeMenuItems)}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

export default TextSelectionToolbar;
