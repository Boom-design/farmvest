// Every Lottie in the app is played from this one module on purpose: it is the
// only place that pulls in the engine, so the whole lot arrives as a single
// lazily loaded chunk instead of one per animation.
//
// LottieSvg rather than the full Lottie build: both animations are pure vector
// with no embedded images, so only the svg renderer is needed.
import { LottieSvg } from 'lottie-react';
import emptyAnimation from '../assets/lottie/Empty.json';
import bellAnimation from '../assets/lottie/Notification.json';
import tickAnimation from '../assets/lottie/TickPop.json';

const ANIMATIONS = {
  empty: emptyAnimation,
  bell: bellAnimation,
  tick: tickAnimation,
};

type LottiePlayerProps = {
  animation: keyof typeof ANIMATIONS;
  size: number;
  /** The bell loops while unread items wait; a one-shot would stop being noticed. */
  loop?: boolean;
};

const LottiePlayer: React.FC<LottiePlayerProps> = ({ animation, size, loop = true }) => (
  <LottieSvg
    src={ANIMATIONS[animation]}
    autoplay
    loop={loop}
    aria-hidden="true"
    style={{ width: size, height: size }}
  />
);

export default LottiePlayer;
