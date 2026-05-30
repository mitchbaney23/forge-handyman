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

        {/* claw hammer (jabs down on each advance).
            Shape: Phosphor "hammer" (fill weight), MIT-licensed — recolored to
            the Workshop palette and rotated to strike the nail. (Sourced via the
            vector-assets skill so it reads as a hammer at every size.) */}
        <g
          key={`${step}-${done}`}
          className={`nail-hammer ${step > 0 || done ? "striking" : ""}`}
        >
          <g transform="translate(124 26) rotate(95) scale(0.19) translate(-128 -128)">
            <path
              fill="#BF5700"
              stroke="#24211B"
              strokeWidth="10"
              strokeLinejoin="round"
              d="M251.34,112,183.88,44.08a96.1,96.1,0,0,0-135.77,0l-.09.09L34.25,58.4A8,8,0,0,0,45.74,69.53L59.47,55.35a79.92,79.92,0,0,1,18.71-13.9L124.68,88l-96,96a16,16,0,0,0,0,22.63l20.69,20.69a16,16,0,0,0,22.63,0l96-96,32,32a16,16,0,0,0,22.63,0l28.69-28.69A16,16,0,0,0,251.34,112Zm-89,2.33L140,136.67,119.31,116l22.35-22.35a8,8,0,0,0,0-11.32L94.32,35a80,80,0,0,1,78.23,20.41l44.22,44.51L188,128.66l-14.34-14.34A8,8,0,0,0,162.34,114.32Zm49,37.66-12-12L228,111.25l12,12Z"
            />
          </g>
        </g>
      </svg>
      <span className="font-sans text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">
        {done ? "Nailed it!" : `Step ${current} of ${totalSteps}`}
      </span>
    </div>
  );
}
