import { useCallback, useEffect, useRef, useState } from 'react';
import { IonIcon, IonSpinner } from '@ionic/react';
import { cameraOutline, checkmarkCircle, refreshOutline } from 'ionicons/icons';
import {
  CHALLENGE_LABEL,
  CHALLENGE_PROMPT,
  CHALLENGE_SEQUENCE,
  LivenessWatcher,
  MIN_FACE_RATIO,
  canvasToBlob,
  faceWidthRatio,
  frameToCanvas,
  loadFaceModels,
  readFace,
  readLandmarks,
  type Challenge,
  type FaceReading,
} from '../lib/face';
import './FaceCapture.css';

export type StepCapture = {
  step: Challenge;
  blob: Blob;
  /** Preview URL for the strip. Revoked by the consumer when it is done. */
  preview: string;
};

export type CaptureResult = {
  /** One frame per step, in sequence order. */
  captures: StepCapture[];
  /** Read from the frontal frame, which is the one worth matching. */
  reading: FaceReading;
  livenessPassed: boolean;
};

type FaceCaptureProps = {
  /**
   * A one-time code burned into each frame.
   *
   * Used at project posting rather than at verification: it is what makes the
   * picture impossible to have taken beforehand or lifted from elsewhere.
   */
  stamp?: string;
  facing?: 'user' | 'environment';
  onCapture: (result: CaptureResult) => void;
  onError?: (message: string) => void;
};

/**
 * Live camera capture through a three-step liveness sequence.
 *
 * Right, left, front, blink -- in that order, with a frame kept at each step.
 * Deliberately has no file input and no shutter button: a verification
 * photograph chosen from a gallery proves nothing, and a person holding a phone
 * at arm's length with their head turned sideways cannot reach for a button
 * without losing the pose they just proved.
 *
 * One random challenge proved a face moved once. Four frames from three angles
 * plus a blink is a far harder thing to fake, and it gives the Admin reviewing a
 * flagged account something to actually look at: four pictures of the same
 * printed photograph are obvious at a glance in a way one is not.
 */
const FaceCapture: React.FC<FaceCaptureProps> = ({
  stamp,
  facing = 'user',
  onCapture,
  onError,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watcherRef = useRef<LivenessWatcher | null>(null);
  const loopRef = useRef<number | null>(null);
  const capturesRef = useRef<StepCapture[]>([]);
  /** The frontal reading, which is the one the ID match depends on. */
  const frontReadingRef = useRef<FaceReading | null>(null);
  /** Guards the per-step capture so one frame cannot be taken twice. */
  const takingRef = useRef(false);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'watching' | 'saving' | 'done'>('loading');
  const [faceSeen, setFaceSeen] = useState(false);
  const [closeEnough, setCloseEnough] = useState(false);
  const [blinks, setBlinks] = useState(0);
  const [taken, setTaken] = useState<StepCapture[]>([]);

  const challenge = CHALLENGE_SEQUENCE[Math.min(index, CHALLENGE_SEQUENCE.length - 1)];

  const stop = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearTimeout(loopRef.current);
      loopRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      // getUserMedia exists only in a secure context. Opening the dev server
      // over a LAN address rather than localhost leaves mediaDevices undefined,
      // and the resulting TypeError looks nothing like the real cause.
      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.(
          `The camera is unavailable because this page is not on a secure origin (${window.location.origin}). Open it on localhost, or serve it over HTTPS.`
        );
        return;
      }

      try {
        await loadFaceModels();
      } catch (failure) {
        if (cancelled) return;
        onError?.(
          `The face models could not be loaded from /models: ${
            failure instanceof Error ? failure.message : 'unknown error'
          }`
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        watcherRef.current = new LivenessWatcher(CHALLENGE_SEQUENCE[0]);
        setPhase('watching');
      } catch (failure) {
        if (cancelled) return;

        const name = failure instanceof DOMException ? failure.name : '';

        onError?.(
          name === 'NotAllowedError'
            ? 'Camera access was refused. Allow the camera in your browser, then try again.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera was found on this device.'
              : name === 'NotReadableError'
                ? 'The camera is already in use by another app. Close it and try again.'
                : `The camera could not be opened: ${
                    failure instanceof Error ? `${failure.name}: ${failure.message}` : 'unknown error'
                  }`
        );
      }
    };

    start();

    return () => {
      cancelled = true;
      stop();
      capturesRef.current.forEach((entry) => URL.revokeObjectURL(entry.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, stop]);

  /**
   * Keep the frame for the step just completed, then move on.
   *
   * The frontal frame is read for its descriptor because it is the one the
   * match depends on; the others are evidence and do not need one.
   */
  const takeStep = useCallback(
    async (step: Challenge) => {
      if (!videoRef.current || takingRef.current) return;

      takingRef.current = true;
      setPhase('saving');

      try {
        const canvas = frameToCanvas(videoRef.current);

        // Read before stamping, so an overlay cannot sit on the face and change
        // what the model sees.
        const reading = step === 'front' ? await readFace(canvas) : null;

        if (step === 'front' && !reading) {
          onError?.('Your face was lost on the straight-ahead shot. Start again in better light.');
          restart();
          return;
        }

        if (stamp) drawStamp(canvas, stamp);

        const blob = await canvasToBlob(canvas);
        const entry: StepCapture = { step, blob, preview: URL.createObjectURL(blob) };

        capturesRef.current = [...capturesRef.current, entry];
        setTaken(capturesRef.current);

        if (reading) frontReadingRef.current = reading;

        const next = index + 1;

        if (next >= CHALLENGE_SEQUENCE.length) {
          const front = frontReadingRef.current;

          if (!front) {
            onError?.('The straight-ahead shot was not usable. Start again.');
            restart();
            return;
          }

          stop();
          setPhase('done');
          onCapture({ captures: capturesRef.current, reading: front, livenessPassed: true });
          return;
        }

        setIndex(next);
        setBlinks(0);
        watcherRef.current = new LivenessWatcher(CHALLENGE_SEQUENCE[next]);
        setPhase('watching');
      } catch (failure) {
        onError?.(failure instanceof Error ? failure.message : 'The capture failed.');
        setPhase('watching');
      } finally {
        takingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, stamp, stop, onCapture, onError]
  );

  const restart = useCallback(() => {
    capturesRef.current.forEach((entry) => URL.revokeObjectURL(entry.preview));
    capturesRef.current = [];
    frontReadingRef.current = null;
    takingRef.current = false;

    setTaken([]);
    setIndex(0);
    setBlinks(0);
    setCloseEnough(false);
    watcherRef.current = new LivenessWatcher(CHALLENGE_SEQUENCE[0]);
    setPhase('watching');
  }, []);

  // Watch for the current step being performed. A timeout loop rather than
  // requestAnimationFrame: the model takes longer than a frame, and queueing
  // work faster than it completes only makes the preview stutter.
  useEffect(() => {
    if (phase !== 'watching') return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
        loopRef.current = window.setTimeout(tick, 200);
        return;
      }

      try {
        const landmarks = await readLandmarks(videoRef.current);

        if (!cancelled) {
          setFaceSeen(Boolean(landmarks));

          const near = landmarks
            ? faceWidthRatio(landmarks, videoRef.current.videoWidth) >= MIN_FACE_RATIO
            : false;

          setCloseEnough(near);

          if (landmarks && near && watcherRef.current) {
            const done = watcherRef.current.observe(landmarks);
            setBlinks(watcherRef.current.blinkCount);

            if (done) {
              // A short beat so the person sees the step go green before the
              // shutter, rather than being surprised by it.
              window.setTimeout(() => {
                if (!cancelled) takeStep(challenge);
              }, 450);
              return;
            }
          }
        }
      } catch {
        // A dropped frame is not worth reporting; the next one will do.
      }

      // A blink lasts 100 to 300 ms, shorter than the pause the head turns can
      // afford, so the blink step polls as fast as the model allows.
      if (!cancelled) loopRef.current = window.setTimeout(tick, challenge === 'blink' ? 30 : 180);
    };

    tick();

    return () => {
      cancelled = true;
      if (loopRef.current !== null) window.clearTimeout(loopRef.current);
    };
  }, [phase, challenge, takeStep]);

  const ringClass = () => {
    if (phase === 'saving' || phase === 'done') return ' face-capture__ring--done';
    if (faceSeen && closeEnough) return ' face-capture__ring--seen';
    if (faceSeen) return ' face-capture__ring--far';
    return '';
  };

  return (
    <div className="face-capture">
      <div className="face-capture__stage">
        <video
          ref={videoRef}
          className={`face-capture__video${facing === 'user' ? ' face-capture__video--mirror' : ''}`}
          playsInline
          muted
        />

        {phase === 'loading' && (
          <div className="face-capture__veil">
            <IonSpinner name="crescent" />
            <p>Starting the camera</p>
          </div>
        )}

        <div className={`face-capture__ring${ringClass()}`} />
      </div>

      {/* The three steps, so the person knows how much is left rather than being
          asked for one thing after another with no end in sight. */}
      <ol className="face-steps">
        {CHALLENGE_SEQUENCE.map((step, position) => (
          <li
            key={step}
            className={`face-steps__item${
              position < index
                ? ' face-steps__item--done'
                : position === index
                  ? ' face-steps__item--now'
                  : ''
            }`}
          >
            <IonIcon icon={position < index ? checkmarkCircle : cameraOutline} />
            <span>{CHALLENGE_LABEL[step]}</span>
          </li>
        ))}
      </ol>

      <div className="face-capture__prompt">
        {phase === 'saving' ? (
          <p className="face-capture__done">
            <IonIcon icon={cameraOutline} /> Frame kept. Next one.
          </p>
        ) : phase === 'done' ? (
          <p className="face-capture__done">
            <IonIcon icon={checkmarkCircle} /> All three taken.
          </p>
        ) : (
          <>
            <p className="face-capture__instruction">{CHALLENGE_PROMPT[challenge]}</p>
            <p className="face-capture__hint">
              {!faceSeen
                ? 'Looking for your face. Hold the camera at arm’s length in good light.'
                : !closeEnough
                  ? 'Move closer until your face fills the oval.'
                  : challenge === 'blink'
                    ? `${blinks} of 2 blinks`
                    : 'Hold it there.'}
            </p>
          </>
        )}
      </div>

      {taken.length > 0 && (
        <div className="face-strip">
          {taken.map((entry) => (
            <figure className="face-strip__shot" key={entry.step}>
              <img src={entry.preview} alt={CHALLENGE_LABEL[entry.step]} />
              <figcaption>{CHALLENGE_LABEL[entry.step]}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="face-capture__actions">
        <button
          type="button"
          className="dash-btn dash-btn--ghost"
          onClick={restart}
          disabled={phase === 'loading' || phase === 'saving' || phase === 'done'}
        >
          <IonIcon icon={refreshOutline} />
          <span>Start over</span>
        </button>
      </div>
    </div>
  );
};

/**
 * Burn the code and the time into the picture.
 *
 * Drawn into the pixels rather than stored beside them, because the point is
 * that the photograph itself carries proof of when it was taken. A caption in a
 * database row travels separately and can be reattached to any image.
 */
const drawStamp = (canvas: HTMLCanvasElement, stamp: string) => {
  const context = canvas.getContext('2d');
  if (!context) return;

  const size = Math.max(16, Math.round(canvas.width / 32));
  const pad = Math.round(size * 0.6);
  const when = new Date().toLocaleString();
  const lines = [stamp, when];

  context.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
  const width = Math.max(...lines.map((line) => context.measureText(line).width));
  const height = lines.length * size * 1.35;

  context.fillStyle = 'rgba(12, 42, 24, 0.82)';
  context.fillRect(pad, canvas.height - height - pad * 2, width + pad * 2, height + pad);

  context.fillStyle = '#ffffff';
  context.textBaseline = 'top';
  lines.forEach((line, index) => {
    context.fillText(line, pad * 2, canvas.height - height - pad + index * size * 1.35);
  });
};

export default FaceCapture;
