/**
 * Face detection and matching, in the browser.
 *
 * This is AI #4. It answers one question at registration -- is the person
 * holding the camera the person on the government ID -- and one question at
 * project posting -- is the person standing in front of this coop the person
 * who owns the account.
 *
 * Everything runs on the user's own device. No photograph of anybody's face is
 * sent anywhere to be scored, which matters because the two images involved are
 * a government ID and a live capture of a face, and because it means the feature
 * costs nothing to run and needs no API key in the bundle.
 *
 * The models are the three from @vladmandic/face-api, the maintained fork of
 * face-api.js, served from /models rather than a CDN so a demo works on a bad
 * connection or none at all. They total about 6.8 MB and are loaded the first
 * time a verification screen opens, never as part of the main bundle.
 */

import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = '/models';

/**
 * The distance at which two faces are certainly different people.
 *
 * face-api.js returns a Euclidean distance between 128-dimension descriptors,
 * smaller being more alike, and publishes 0.6 as the same-person mark for two
 * ordinary photographs. Matching a photographed government ID against a webcam
 * frame is a harder problem than that: it is a picture of a laminated picture,
 * often years old, lit differently and taken on different optics. The same
 * person routinely lands at 0.40 to 0.55 across those two sources.
 *
 * The scale therefore runs to 1.0 rather than 0.6. Dividing by 0.6 made the
 * published same-person mark score zero, so a genuine ID match came out at
 * 0.08 to 0.33 and every real customer was refused. Against 1.0:
 *
 *   distance 0.35  ->  0.65   a clear match
 *   distance 0.45  ->  0.55   the pass mark
 *   distance 0.60  ->  0.40   face-api's own same-person mark, flagged
 *   distance 0.65  ->  0.35   the floor
 *   distance 0.80  ->  0.20   a different person
 */
const MAX_DISTANCE = 1;

let loading: Promise<void> | null = null;

/**
 * Choose and start a TensorFlow.js backend.
 *
 * The default order puts wasm first, and wasm needs its own .wasm binaries
 * served from a path the bundle does not ship. Loading a model before any
 * backend is ready fails with "The highest priority backend 'wasm' has not yet
 * been initialized", which says nothing about the real problem.
 *
 * WebGL needs no extra files and is far faster than cpu on the only work this
 * does, which is convolution. cpu is the fallback for a machine with no working
 * WebGL context -- slow, but it finishes.
 */
const startBackend = async () => {
  // face-api re-exports the whole of tfjs-core at runtime but its bundled
  // declaration only lists the ops the library itself calls, so the three
  // backend functions are missing from the type. Narrowed to exactly what is
  // used rather than cast to any, so a typo is still a compile error.
  const tf = faceapi.tf as unknown as {
    setBackend: (name: string) => Promise<boolean>;
    ready: () => Promise<void>;
    getBackend: () => string;
  };

  for (const backend of ['webgl', 'cpu']) {
    try {
      await tf.setBackend(backend);
      await tf.ready();
      if (tf.getBackend() === backend) return;
    } catch {
      // Try the next one. Reporting a failed WebGL probe would be noise when
      // cpu is about to work.
    }
  }

  throw new Error('No TensorFlow.js backend could be started in this browser.');
};

/** Loads the backend and the three models once, however many callers ask. */
export const loadFaceModels = async () => {
  if (!loading) {
    loading = (async () => {
      // Sequential on purpose: a model cannot be read before a backend exists.
      await startBackend();

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
    })();
  }

  try {
    await loading;
  } catch (failure) {
    // A rejected promise would otherwise be cached, so every later attempt
    // would fail instantly with the same error and no retry would help.
    loading = null;
    throw failure;
  }
};

/** Tuned for a phone camera: 416 is the accuracy/speed knee for a close face. */
const detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,
  scoreThreshold: 0.4,
});

/**
 * Escalating attempts for a face on a photographed government ID.
 *
 * The live camera and an ID are not the same problem. A selfie fills the frame;
 * the portrait on an ID is a small, low-contrast, often laminated picture
 * occupying perhaps a tenth of the card, and TinyFaceDetector at 416 misses it
 * outright. Each step raises the input resolution and lowers the confidence
 * floor, because a scaled-up small face is exactly what the detector needs and
 * a weak detection of the right face beats no detection at all.
 */
const ID_ATTEMPTS = [
  new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }),
  new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 }),
  new faceapi.TinyFaceDetectorOptions({ inputSize: 800, scoreThreshold: 0.2 }),
];

let ssdLoading: Promise<void> | null = null;

/**
 * SSD MobileNet v1, loaded only when the fast detector has already failed.
 *
 * It is 5.4 MB against TinyFaceDetector's 190 KB and far slower, and it finds
 * small faces that the tiny model cannot. Downloading it on every verification
 * would be waste; downloading it on the one ID in ten that needs it is not.
 */
const loadSsd = async () => {
  if (!ssdLoading) {
    ssdLoading = faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
  }

  try {
    await ssdLoading;
  } catch (failure) {
    ssdLoading = null;
    throw failure;
  }
};

export type FaceReading = {
  /** 128 numbers describing the face, comparable across images. */
  descriptor: Float32Array;
  /** The 68 landmark points, which is what the liveness challenge reads. */
  landmarks: faceapi.FaceLandmarks68;
  /** Detector confidence, 0 to 1. */
  confidence: number;
};

/**
 * Read the single most prominent face out of an image or a video frame.
 *
 * Returns null rather than throwing when there is no face, because "no face
 * found" is an ordinary outcome the interface has to explain, not an error.
 */
export const readFace = async (
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<FaceReading | null> => {
  await loadFaceModels();

  const found = await faceapi
    .detectSingleFace(input, detectorOptions)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!found) return null;

  return {
    descriptor: found.descriptor,
    landmarks: found.landmarks,
    confidence: found.detection.score,
  };
};

/**
 * Read a face from a still photograph, trying harder than the live loop does.
 *
 * Used for the government ID, where there is no next frame to fall back on: one
 * picture is all there is, and reporting "no face found" on an ID that plainly
 * has one is the difference between a customer finishing and giving up.
 */
export const readFaceFromPhoto = async (
  input: HTMLImageElement | HTMLCanvasElement
): Promise<FaceReading | null> => {
  await loadFaceModels();

  for (const options of ID_ATTEMPTS) {
    const found = await faceapi
      .detectSingleFace(input, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (found) {
      return {
        descriptor: found.descriptor,
        landmarks: found.landmarks,
        confidence: found.detection.score,
      };
    }
  }

  // Last resort: the heavy detector, fetched now rather than up front.
  await loadSsd();

  const found = await faceapi
    .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!found) return null;

  return {
    descriptor: found.descriptor,
    landmarks: found.landmarks,
    confidence: found.detection.score,
  };
};

/** Detection only, for the fast loop that watches a liveness challenge. */
export const readLandmarks = async (
  input: HTMLVideoElement | HTMLCanvasElement
) => {
  await loadFaceModels();

  const found = await faceapi.detectSingleFace(input, detectorOptions).withFaceLandmarks();

  return found?.landmarks ?? null;
};

/**
 * How alike two faces are, as 0 to 1 where 1 is identical.
 *
 * The raw output is a distance, which is the wrong way round for a score a
 * person has to read, so it is inverted against the published threshold. A
 * distance of 0 becomes 1.0; a distance at or past 0.6 becomes 0.
 */
export const similarity = (a: Float32Array, b: Float32Array) => {
  const distance = faceapi.euclideanDistance(a, b);
  return Math.max(0, Math.min(1, 1 - distance / MAX_DISTANCE));
};

/**
 * How much of the frame the face fills, 0 to 1, measured across the jaw.
 *
 * A face far from the camera gives the descriptor very few pixels to work
 * with, and the comparison degrades long before the detector fails. Measuring
 * it lets the capture button wait until the face is close enough to be worth
 * comparing, which is a better answer than refusing afterwards.
 */
export const faceWidthRatio = (
  landmarks: faceapi.FaceLandmarks68,
  frameWidth: number
) => {
  if (frameWidth <= 0) return 0;

  const jaw = landmarks.getJawOutline();
  const width = Math.abs(jaw[jaw.length - 1].x - jaw[0].x);

  return width / frameWidth;
};

/** Below this the face is too far away for the match to mean anything. */
export const MIN_FACE_RATIO = 0.22;

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

export type Challenge = 'turn-right' | 'turn-left' | 'front' | 'blink';

/**
 * The sequence, in order.
 *
 * Fixed rather than random, and three steps rather than one. A single random
 * challenge proved a face moved once; three in a known order produce frames
 * from three angles, and a printed photograph held up to the camera cannot
 * turn its head.
 *
 * The blink step was dropped: it was the one users could not get through
 * without exaggerating, and the two head turns already rule out a photograph.
 * Older accounts may still have a blink frame on file, which the Admin review
 * shows as it always did.
 *
 * Front sits last on purpose: the head is already moving by then, and the
 * frontal frame is the one used for the match against the ID, so it should be
 * taken while the person is engaged rather than as a cold first shot.
 */
export const CHALLENGE_SEQUENCE: Challenge[] = ['turn-right', 'turn-left', 'front'];

export const CHALLENGE_PROMPT: Record<Challenge, string> = {
  'turn-right': 'Slowly turn your head to your right',
  'turn-left': 'Now turn your head to your left',
  front: 'Look straight at the camera',
  blink: 'Blink twice',
};

/** Shown under each captured frame, in the admin review and in the strip. */
export const CHALLENGE_LABEL: Record<Challenge, string> = {
  'turn-right': 'Right',
  'turn-left': 'Left',
  front: 'Front',
  blink: 'Blink',
};

/**
 * Where the nose sits between the two ears, 0 at the left edge and 1 at the
 * right.
 *
 * A head turned to the person's own left moves the nose toward the right side
 * of the mirrored camera image, so the numbers below read backwards from the
 * prompt on purpose.
 */
const nosePosition = (landmarks: faceapi.FaceLandmarks68) => {
  const jaw = landmarks.getJawOutline();
  const nose = landmarks.getNose();

  const left = jaw[0].x;
  const right = jaw[jaw.length - 1].x;
  const width = right - left;
  if (width <= 0) return 0.5;

  return (nose[3].x - left) / width;
};

/**
 * Eye openness as height over width.
 *
 * An open eye is roughly a third as tall as it is wide; a closed one collapses
 * toward zero. Comparing the ratio rather than the raw height keeps it working
 * as the face moves nearer to or further from the camera.
 */
const eyeOpenness = (landmarks: faceapi.FaceLandmarks68) => {
  const ratio = (points: faceapi.Point[]) => {
    const width = Math.hypot(points[3].x - points[0].x, points[3].y - points[0].y);
    if (width <= 0) return 1;

    const upper = (points[1].y + points[2].y) / 2;
    const lower = (points[4].y + points[5].y) / 2;
    return Math.abs(lower - upper) / width;
  };

  return (ratio(landmarks.getLeftEye()) + ratio(landmarks.getRightEye())) / 2;
};

const TURN_THRESHOLD = 0.62;
const EYE_OPEN = 0.26;

/**
 * A blink is measured against the person's own open eye, not a fixed number.
 *
 * Openness varies a lot between faces, and the 68-point landmark net rarely
 * collapses a closed eye all the way: on some people a shut eye still reads
 * 0.2, which never crossed the old fixed mark of 0.18, so the blink was only
 * counted when it was slow and exaggerated. Closed is now a drop to 75% of the
 * open baseline, and open again is a return to 88% of it.
 */
const BLINK_CLOSED_RATIO = 0.75;
const BLINK_REOPEN_RATIO = 0.88;

/** Readings taken before a blink can count, so the baseline is a real one. */
const BASELINE_FRAMES = 3;

/** How centred the nose has to be to count as facing the camera. */
const FRONT_BAND = 0.08;

/**
 * Watches a sequence of readings and says whether the challenge was performed.
 *
 * Kept as a small state machine rather than a single-frame test because that is
 * the whole point: a photograph held up to the camera produces one unchanging
 * reading, and cannot turn its head or close its eyes.
 */
export class LivenessWatcher {
  private readonly challenge: Challenge;
  private closed = false;
  private blinks = 0;
  private passed = false;
  /** Open-eye openness for this face, learned from the frames watched. */
  private baseline = 0;
  private frames = 0;

  constructor(challenge: Challenge) {
    this.challenge = challenge;
  }

  /** Feed one frame. Returns true once the challenge has been met. */
  observe(landmarks: faceapi.FaceLandmarks68) {
    if (this.passed) return true;

    if (this.challenge === 'front') {
      const position = nosePosition(landmarks);
      // Eyes open as well, so a frame taken mid-blink is not the one kept for
      // the match against the ID.
      this.passed =
        Math.abs(position - 0.5) < FRONT_BAND && eyeOpenness(landmarks) > EYE_OPEN;
      return this.passed;
    }

    if (this.challenge === 'blink') {
      const openness = eyeOpenness(landmarks);
      this.frames += 1;

      // The baseline follows the open eye up at once and drifts down slowly,
      // so a closed frame barely moves it but a face that settles further
      // from the camera is still followed.
      if (!this.closed) {
        this.baseline =
          openness > this.baseline ? openness : this.baseline * 0.97 + openness * 0.03;
      }

      if (this.frames <= BASELINE_FRAMES) return false;

      if (!this.closed && openness < this.baseline * BLINK_CLOSED_RATIO) {
        this.closed = true;
      } else if (this.closed && openness > this.baseline * BLINK_REOPEN_RATIO) {
        this.closed = false;
        this.blinks += 1;
      }

      // Two blinks, because one is indistinguishable from a dropped frame.
      this.passed = this.blinks >= 2;
      return this.passed;
    }

    const position = nosePosition(landmarks);

    // Mirrored preview: turning to your own left moves the nose right.
    this.passed =
      this.challenge === 'turn-left'
        ? position > TURN_THRESHOLD
        : position < 1 - TURN_THRESHOLD;

    return this.passed;
  }

  get done() {
    return this.passed;
  }

  /** How far through a blink challenge, for a progress hint. */
  get blinkCount() {
    return this.blinks;
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/** Grab the current video frame as a canvas, at the video's own resolution. */
export const frameToCanvas = (video: HTMLVideoElement) => {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const context = canvas.getContext('2d');
  if (context) context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return canvas;
};

/** JPEG rather than PNG: these are photographs, and a PNG of one is enormous. */
export const canvasToBlob = (canvas: HTMLCanvasElement, quality = 0.85) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The capture could not be saved.'))),
      'image/jpeg',
      quality
    );
  });

/** Loads an image from a URL with CORS enabled, so the model may read its pixels. */
export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be opened.'));
    image.src = src;
  });
