type Props = {
  /** 0-indexed current step. */
  step: number;
  /** Total number of steps in the wizard. */
  totalSteps: number;
  /** When true, the nail drives fully flush (form submitted). */
  done?: boolean;
};

/**
 * Hammer-and-nail progress indicator — the on-brand wizard centerpiece.
 * The nail sinks one notch per step and drives flush on submit; the hammer
 * jabs down to strike on each advance. Pure prop-driven (no refs/effects),
 * so it never interferes with the form's Places/Turnstile wiring. The strike
 * animation re-runs because the hammer <g> is keyed on step/done. Motion is
 * disabled under prefers-reduced-motion (see globals.css); progress is still
 * conveyed via role="progressbar" + the visible "Step X of Y" label.
 */
export function NailProgress({ step, totalSteps, done = false }: Props) {
  const progress = done ? 1 : Math.min(Math.max(step, 0) / totalSteps, 1);
  const sinkY = progress * 22; // px the nail travels from proud → flush
  const current = done ? totalSteps : Math.min(step + 1, totalSteps);

  return (
    <div
      className="flex flex-col items-center gap-1"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={totalSteps}
      aria-valuenow={current}
      aria-label={done ? "All steps complete" : `Step ${current} of ${totalSteps}`}
    >
      <svg
        viewBox="0 0 260 110"
        className="h-[78px] w-full max-w-[300px]"
        fill="none"
        aria-hidden="true"
      >
        {/* nail (drawn first; the board on top hides the in-wood shaft) */}
        <g
          className="nail-sink"
          style={{ transform: `translateY(${sinkY}px)` }}
        >
          <rect x="126" y="49" width="8" height="48" fill="#6B6353" />
          <rect x="114" y="40" width="32" height="10" rx="2" fill="#433D32" />
          <rect x="114" y="40" width="32" height="3" rx="1.5" fill="#6B6353" />
        </g>

        {/* board */}
        <rect x="14" y="70" width="232" height="32" rx="5" fill="#E7DCC5" />
        <rect
          x="14"
          y="70"
          width="232"
          height="32"
          rx="5"
          stroke="#24211B"
          strokeWidth="2.5"
        />
        <path
          d="M36 84H224M48 93H206"
          stroke="#CDBF9F"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        {/* claw hammer (jabs down on each advance) */}
        <g
          key={`${step}-${done}`}
          className={`nail-hammer ${step > 0 || done ? "striking" : ""}`}
        >
          {/* wood handle */}
          <rect
            x="150"
            y="-14"
            width="11"
            height="36"
            rx="4.5"
            fill="#9C6B3F"
            stroke="#24211B"
            strokeWidth="2.5"
            transform="rotate(22 155 4)"
          />
          {/* metal head: claw on the left, flat striking face on the right */}
          <path
            d="M151 14
               L162 17 Q166 18 166 22 L166 30 Q166 34 162 35 L151 38
               L126 38
               Q116 46 104 42 Q110 36 116 34
               Q108 33 103 37 Q104 29 114 27
               Q120 26 126 27
               L151 14 Z"
            fill="#BF5700"
            stroke="#24211B"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <span className="font-sans text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">
        {done ? "Nailed it!" : `Step ${current} of ${totalSteps}`}
      </span>
    </div>
  );
}
