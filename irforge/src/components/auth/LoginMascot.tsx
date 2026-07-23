import { motion, useReducedMotion } from "framer-motion";

export interface LoginMascotProps {
  /** Length of the email field's current value — drives the pupil's horizontal glide. */
  emailLength: number;
  /** Whether the email field currently has focus (pupils only track while it does). */
  emailFocused: boolean;
  /** Whether the password field currently has focus. */
  passwordFocused: boolean;
  /** Length of the password field's current value. */
  passwordLength: number;
  /** V1's show/hide toggle state — true means the password is currently revealed. */
  showPassword: boolean;
  className?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// A shade darker than the body fill so the hands read as a distinct shape
// even while overlapping the same-hue face (matching fills alone would make
// them invisible against each other).
const HAND_FILL = "hsl(20 75% 40%)";
const HAND_STROKE = "hsl(20 70% 28%)";
const PUPIL = "hsl(0 0% 10%)";

/**
 * W7: a small charm mascot above the login/register form. Eyes track the
 * email field as it's typed; hands rise to cover the eyes once the password
 * field has content, and lower onto the cheeks (eyes visible again above
 * them) when the user reveals it via V1's toggle. Every animated value
 * snaps instantly (no glide/spring) under prefers-reduced-motion.
 *
 * The art is refreshed to match the OrangeRobot family — a little antenna,
 * cheek highlights, eye catchlights, a top sheen and a curved smile — while
 * keeping all the interaction anchor points (eye/hand coordinates) intact.
 */
export function LoginMascot({
  emailLength,
  emailFocused,
  passwordFocused,
  passwordLength,
  showPassword,
  className,
}: LoginMascotProps) {
  const reduce = useReducedMotion();

  const hasPasswordContent = passwordLength > 0;
  const handsUp = passwordFocused && hasPasswordContent && !showPassword; // fully covering
  const handsPeek = passwordFocused && hasPasswordContent && showPassword; // lowered onto the cheeks, eyes visible above
  // Eyelids only do the "closed" job for the brief moment the field is
  // focused but still empty — once there's content, the hands take over as
  // the covering mechanism (per spec: hands "instead of just closed eyelids").
  const eyelidScale = passwordFocused && !hasPasswordContent ? 1 : 0;
  const pupilX = passwordFocused ? 0 : clamp((emailFocused ? emailLength : 0) * 1.1 - 6, -8, 8);

  const springT = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 300, damping: 22 };
  const quickT = reduce ? { duration: 0 } : { duration: 0.16 };

  // Hands rest at the sides (their own cx/cy below the face); these are the
  // *additional* translate offsets layered on top via framer-motion's x/y.
  const leftHandTarget = handsUp
    ? { x: 15, y: -33 }
    : handsPeek
      ? { x: 15, y: -18 }
      : { x: 0, y: 0 };
  const rightHandTarget = handsUp
    ? { x: -15, y: -33 }
    : handsPeek
      ? { x: -15, y: -18 }
      : { x: 0, y: 0 };

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-hidden="true"
    >
      {/* antenna (ties the mascot into the robot family) */}
      <circle cx="50" cy="8" r="6" className="fill-primary" opacity="0.28" />
      <line x1="50" y1="18" x2="50" y2="10" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="8" r="3" className="fill-primary" />

      {/* face */}
      <circle cx="50" cy="54" r="38" className="fill-primary/15" />
      <circle cx="50" cy="52" r="34" className="fill-primary" />

      {/* top sheen + cheek highlights */}
      <ellipse cx="50" cy="40" rx="26" ry="15" fill="#fff" opacity="0.09" />
      <ellipse cx="31" cy="60" rx="6.5" ry="4.2" fill="#fff" opacity="0.16" />
      <ellipse cx="69" cy="60" rx="6.5" ry="4.2" fill="#fff" opacity="0.16" />

      {/* eye whites */}
      <ellipse cx="36" cy="48" rx="9" ry="11" fill="white" />
      <ellipse cx="64" cy="48" rx="9" ry="11" fill="white" />

      {/* pupils + catchlight — glide horizontally (as a transform, not the raw
          SVG attribute) while the email field is being typed */}
      <motion.g animate={{ x: pupilX }} transition={springT}>
        <circle cx="36" cy="48" r="4.3" fill={PUPIL} />
        <circle cx="37.5" cy="46.2" r="1.4" fill="#fff" />
      </motion.g>
      <motion.g animate={{ x: pupilX }} transition={springT}>
        <circle cx="64" cy="48" r="4.3" fill={PUPIL} />
        <circle cx="65.5" cy="46.2" r="1.4" fill="#fff" />
      </motion.g>

      {/* eyelids — close only for the "focused but still empty" moment, scale from the top edge */}
      <motion.rect
        x="27" y="37" width="18" height="22" rx="9"
        className="fill-primary"
        style={{ originX: 0.5, originY: 0 }}
        animate={{ scaleY: eyelidScale }}
        transition={quickT}
      />
      <motion.rect
        x="55" y="37" width="18" height="22" rx="9"
        className="fill-primary"
        style={{ originX: 0.5, originY: 0 }}
        animate={{ scaleY: eyelidScale }}
        transition={quickT}
      />

      {/* hands — rest at the sides, rise to cover the eyes while a password is
          being typed, lower onto the cheeks (eyes visible above) when revealed.
          Darker fill + stroke so they read as distinct shapes over the same-hue face. */}
      <motion.ellipse
        cx="16" cy="82" rx="11" ry="9"
        fill={HAND_FILL}
        stroke={HAND_STROKE}
        strokeWidth="1.5"
        animate={leftHandTarget}
        transition={springT}
      />
      <motion.ellipse
        cx="84" cy="82" rx="11" ry="9"
        fill={HAND_FILL}
        stroke={HAND_STROKE}
        strokeWidth="1.5"
        animate={rightHandTarget}
        transition={springT}
      />

      {/* mouth — curved smile (painted last so it stays visible above the cheeks) */}
      <path
        d="M41 62 Q50 68.5 59 62"
        fill="none"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}
