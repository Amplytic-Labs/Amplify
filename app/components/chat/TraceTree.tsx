import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/* ================================================================== */
/*  TRACE TREE — Collapsible tree with curved SVG connectors           */
/* ================================================================== */

/* Precise SVG connector paths from the reference */
const FIRST_CURVE_PATH = 'M13.9248 14.9347C9.45169 15.4312 0.924805 12.3128 0.924805 0';
const NEXT_CURVE_PATH = 'M13.9248 52.9347C9.45169 53.4312 0.924805 50.3128 0.924805 38';
const VERTICAL_BAR_PATH = 'M0.00292969 0H2.00293L1.8448 38H0.00292969V0Z';

export type TreeItemStatus = 'done' | 'running' | 'failed' | 'pending';
export type TreeItemType = 'bullet' | 'check';
export type TreeItemIcon = 'dot' | 'check' | 'plus' | 'modify' | 'terminal';

export interface TraceItem {
  id: string;
  text: string;
  status: TreeItemStatus;
  type: TreeItemType;
  icon?: TreeItemIcon;
  subText?: string;
  children?: React.ReactNode;
}

function getDotClass(status: TreeItemStatus): string {
  switch (status) {
    case 'done':
      return 'bg-[#8e8e8e]';
    case 'running':
      return 'bg-amber-400 ring-2 ring-amber-400/50 animate-pulse';
    case 'failed':
      return 'bg-rose-500';
    default:
      return 'bg-[#3a3a3a]';
  }
}

function getIconColor(status: TreeItemStatus): string {
  switch (status) {
    case 'done':
      return 'text-[#8e8e8e]';
    case 'running':
      return 'text-amber-400';
    case 'failed':
      return 'text-rose-500';
    default:
      return 'text-[#555555]';
  }
}

function getTextColor(status: TreeItemStatus): string {
  switch (status) {
    case 'done':
      return 'text-[#8e8e8e]';
    case 'running':
      return 'text-[#b0b0b0]';
    case 'failed':
      return 'text-rose-400';
    default:
      return 'text-[#555555]';
  }
}

function getConnectorColor(): string {
  return '#404040';
}

export function TraceTree({
  headerIcon,
  headerText,
  items,
  defaultOpen = false,
  headerBadge,
  onHeaderClick,
}: {
  headerIcon: 'plan' | 'command' | 'file';
  headerText: string;
  items: TraceItem[];
  defaultOpen?: boolean;
  headerBadge?: React.ReactNode;
  onHeaderClick?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const connColor = getConnectorColor();
  const firstTop = -2;
  const nextTop = -40;
  const leftOff = -3;

  return (
    <div>
      {/* Collapsible header */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          onHeaderClick?.();
        }}
        className="inline-flex items-center gap-2 text-sm text-left cursor-pointer group px-4 py-0 transition-colors bg-amplify-elements-background-depth-1 rounded-lg"
      >
        {/* Header icon */}
        {headerIcon === 'plan' ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="shrink-0 text-[#8e8e8e] group-hover:text-accent-500 transition-colors"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
          </svg>
        ) : headerIcon === 'file' ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="shrink-0 text-[#8e8e8e] group-hover:text-accent-500 transition-colors"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="shrink-0 text-[#8e8e8e] group-hover:text-accent-500 transition-colors"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        )}
        <span className="text-[#8e8e8e] group-hover:text-[#d0d0d0] transition-colors">{headerText}</span>
        {headerBadge}
        <motion.div animate={{ rotate: isOpen ? 0 : -90 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[#666666]"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </motion.div>
      </button>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {isOpen && items.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: {
                height: { duration: 0.25, ease: [0.25, 1, 0.5, 1] },
                opacity: { duration: 0.15 },
              },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: {
                height: { duration: 0.2, ease: [0.25, 1, 0.5, 1] },
                opacity: { duration: 0.12 },
              },
            }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{ left: 15 }}
              className="flex flex-col py-0.5 relative pl-[9px] pr-4 pb-3 max-h-80 overflow-y-auto"
            >
              {items.map((item, i) => {
                const isFirst = i === 0;
                const hasExpand = !!item.children;
                const isExpanded = expandedId === item.id;

                return (
                  <div key={item.id}>
                    <motion.div
                      initial={{ x: -4, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: i * 0.03, duration: 0.18 }}
                      className={`flex items-center group relative ${hasExpand ? 'cursor-pointer' : ''}`}
                      style={{ minHeight: 26 }}
                      onClick={() => hasExpand && setExpandedId(isExpanded ? null : item.id)}
                    >
                      {/* SVG Connector */}
                      <div className="relative shrink-0" style={{ height: 26, width: 15 }}>
                        {isFirst ? (
                          <svg
                            width="15"
                            height="16"
                            viewBox="0 0 15 16"
                            fill="none"
                            style={{ position: 'absolute', top: firstTop, left: leftOff }}
                          >
                            <path d={FIRST_CURVE_PATH} stroke={connColor} strokeWidth="1.85" />
                          </svg>
                        ) : (
                          <svg
                            width="15"
                            height="54"
                            viewBox="0 0 15 54"
                            fill="none"
                            style={{ position: 'absolute', top: nextTop, left: leftOff }}
                          >
                            <path d={NEXT_CURVE_PATH} stroke={connColor} strokeWidth="1.85" />
                            <path d={VERTICAL_BAR_PATH} fill={connColor} />
                          </svg>
                        )}
                      </div>

                      {/* Status icon */}
                      <div className="w-4 h-4 flex items-center justify-center shrink-0 z-10">
                        {(() => {
                          const icon = item.icon || (item.type === 'check' ? 'check' : 'dot');
                          const color = getIconColor(item.status);

                          switch (icon) {
                            case 'check':
                              return (
                                <svg
                                  width="15"
                                  height="15"
                                  viewBox="0 0 15 15"
                                  fill="none"
                                  className={`w-4 h-4 ${color}`}
                                >
                                  <path
                                    d="M12 3.59961L5.40002 10.1996L2.40002 7.19961"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="1.33"
                                  />
                                </svg>
                              );
                            case 'plus':
                              return (
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className={`w-3.5 h-3.5 ${color}`}
                                >
                                  <path
                                    d="M12 5v14M5 12h14"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              );
                            case 'modify':
                              return (
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className={`w-3.5 h-3.5 ${color}`}
                                >
                                  <path
                                    d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              );
                            case 'terminal':
                              return (
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className={`w-3.5 h-3.5 ${color}`}
                                >
                                  <polyline
                                    points="4 17 10 11 4 5"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <line
                                    x1="12"
                                    y1="19"
                                    x2="20"
                                    y2="19"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              );
                            default:
                              return <div className={`w-1.5 h-1.5 rounded-full ${getDotClass(item.status)}`} />;
                          }
                        })()}
                      </div>

                      {/* Item text + optional sub-text */}
                      <div className="px-1 flex-1 min-w-0 flex items-baseline gap-2">
                        <span className={`text-xs truncate ${getTextColor(item.status)}`}>{item.text}</span>
                        {item.subText && (
                          <span className="text-[10px] text-[#555555] truncate shrink-0">{item.subText}</span>
                        )}
                        {hasExpand && (
                          <span className="text-[10px] text-[#555555] ml-auto shrink-0">{isExpanded ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </motion.div>

                    {/* Expandable children */}
                    <AnimatePresence initial={false}>
                      {isExpanded && item.children && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1, transition: { duration: 0.15 } }}
                          exit={{ height: 0, opacity: 0, transition: { duration: 0.1 } }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div className="ml-[35px] py-1.5">{item.children}</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/*  CIRCULAR PROGRESS — Full-circle stacked donut chart               */
/* ================================================================== */

export interface CircularProgressSegment {
  value: number;
  color: string;
}

export function CircularProgress({
  segments,
  size = 24,
  strokeWidth = 3.5,
  children,
}: {
  segments: CircularProgressSegment[];
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const center = size / 2;

  // Build arcs for segments > 0
  const arcs: { d: string; color: string }[] = [];

  if (total === 0) {
    arcs.push({ d: describeFullCircle(center, r), color: '#3a3a3a' });
  } else if (segments.filter((s) => s.value > 0).length === 1) {
    const seg = segments.find((s) => s.value > 0)!;
    arcs.push({ d: describeFullCircle(center, r), color: seg.color });
  } else {
    const GAP_DEG = 4;
    const activeCount = segments.filter((s) => s.value > 0).length;
    const totalGap = GAP_DEG * activeCount;
    const available = 360 - totalGap;
    let angle = 0;

    segments.forEach((seg) => {
      if (seg.value <= 0) {
        return;
      }

      const segAngle = (seg.value / total) * available;
      const startAngle = angle + GAP_DEG / 2;
      const endAngle = angle + segAngle + GAP_DEG / 2;
      arcs.push({
        d: describeArc(center, r, startAngle, endAngle),
        color: seg.color,
      });
      angle += segAngle + GAP_DEG;
    });
  }

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {arcs.map((arc, i) => (
          <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={strokeWidth} strokeLinecap="round" />
        ))}
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

/** Convert a "clock" angle (0°=top, clockwise) to SVG x,y */
function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path for a clockwise arc from startAngle to endAngle (0°=top) */
function describeArc(cx: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToXY(cx, cx, r, startAngle);
  const end = polarToXY(cx, cx, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/** SVG path for a full circle (two semicircles) */
function describeFullCircle(cx: number, r: number): string {
  return `M ${cx} ${cx - r} A ${r} ${r} 0 1 1 ${cx} ${cx + r} A ${r} ${r} 0 1 1 ${cx} ${cx - r}`;
}
