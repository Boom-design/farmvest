import { useState } from 'react';
import { IonIcon, IonSpinner } from '@ionic/react';
import {
  alertCircleOutline,
  checkmarkCircle,
  cloudUploadOutline,
  idCardOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import FaceCapture, { type CaptureResult } from './FaceCapture';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { loadImage, readFaceFromPhoto, similarity } from '../lib/face';
import { checkIdType } from '../lib/idText';
import './IdentityVerification.css';

export type VerificationOutcome = 'Approved' | 'Flagged' | 'Rejected';

type IdentityVerificationProps = {
  onDone: (outcome: VerificationOutcome) => void;
};

const MAX_ID_BYTES = 5 * 1024 * 1024;

/**
 * The IDs FarmVest accepts, matching what the Admin used to review by hand.
 *
 * Any of them carries a photograph, which is the only property that matters
 * here: the face on it is what the live capture is compared against.
 */
const VALID_ID_TYPES = [
  "Driver's License",
  'PhilSys National ID',
  'UMID',
  'SSS ID',
  'GSIS ID',
  'Postal ID',
  'Passport',
  "Voter's ID",
  'PRC ID',
  'Senior Citizen ID',
];

/**
 * Identity verification, done on the device.
 *
 * Two faces, one question: is the person holding the camera the person on the
 * government ID. The ID never leaves the browser to be scored, the live capture
 * is uploaded only as evidence, and the outcome is written by a database
 * function so the page cannot approve itself.
 *
 * The threshold lives in SQL rather than here, because a number that decides
 * who gets in should not be editable by the thing being decided about.
 */
const IdentityVerification: React.FC<IdentityVerificationProps> = ({ onDone }) => {
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [idType, setIdType] = useState('');
  const [busy, setBusy] = useState(false);
  /** Shown while the two slow steps run, because together they take seconds. */
  const [step, setStep] = useState('');
  /**
   * Whether the document has been read and agrees with the chosen type.
   *
   * Checked when the file is picked rather than after the camera, because a
   * customer who chose the wrong line from a list of ten should be told so
   * immediately. Sending that to an Admin was making a person do work the page
   * could do in three seconds.
   */
  const [typeChecked, setTypeChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ outcome: VerificationOutcome; score: number } | null>(
    null
  );

  const pickFile = async (chosen: File | null) => {
    if (!chosen) return;

    if (chosen.size > MAX_ID_BYTES) {
      setError('The ID file must be 5 MB or smaller.');
      return;
    }

    setError(null);
    setFile(chosen);
    setTypeChecked(false);

    if (!idType) return;

    setBusy(true);
    setStep('Reading the document');

    const check = await checkIdType(chosen, idType);

    setBusy(false);
    setStep('');

    if (check.verdict === 'mismatch') {
      setError(
        `You chose ${idType}, but this document reads as ${check.looksLike}. Change the type above, or upload your ${idType}.`
      );
      setFile(null);
      return;
    }

    // 'unreadable' passes. OCR on a photographed Philippine ID fails often --
    // laminate glare, holograms over the text, a card held at an angle -- and
    // refusing on a failed read would turn away the honest majority to catch
    // the careless few. The face match is the check that matters.
    setTypeChecked(true);
  };

  const handleCapture = async (capture: CaptureResult) => {
    if (!file) return;

    setBusy(true);
    setError(null);
    setStep('Reading the face on your ID');

    let idUrl: string | null = null;

    try {
      // Read the ID first. A PDF or a photograph with no readable face is a
      // dead end, and finding that out before an upload saves the round trip.
      idUrl = URL.createObjectURL(file);
      const idImage = await loadImage(idUrl);
      const idFace = await readFaceFromPhoto(idImage);

      if (!idFace) {
        setError(
          'No face could be found on that ID. Photograph it flat, in good light, with no glare across the picture.'
        );
        setBusy(false);
        setStep('');
        return;
      }

      const score = similarity(idFace.descriptor, capture.reading.descriptor);

      // Everything is uploaded whatever the score says. A refused attempt is
      // exactly the case an Admin may later be asked to look at, and no single
      // picture is any use to them on its own.
      setStep('Saving');
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const idPath = `ids/${crypto.randomUUID()}.${extension}`;

      const framePaths = capture.captures.map((entry) => ({
        step: entry.step,
        path: `selfies/${crypto.randomUUID()}.jpg`,
        blob: entry.blob,
      }));

      const uploads = await Promise.all([
        supabase.storage
          .from('valid-ids')
          .upload(idPath, file, { contentType: file.type || undefined }),
        ...framePaths.map((frame) =>
          supabase.storage
            .from('valid-ids')
            .upload(frame.path, frame.blob, { contentType: 'image/jpeg' })
        ),
      ]);

      const failed = uploads.find((upload) => upload.error);
      if (failed?.error) throw new Error(failed.error.message);

      // All three frames are filed as evidence. The frontal one is what the
      // match was computed from, so it is also the selfie on the account.
      const { error: framesError } = await supabase.from('identity_captures').insert(
        framePaths.map((frame) => ({
          users_id: profile?.users_id,
          step: frame.step,
          file_url: frame.path,
        }))
      );

      if (framesError) throw new Error(framesError.message);

      const selfiePath =
        framePaths.find((frame) => frame.step === 'front')?.path ?? framePaths[0].path;

      const { data, error: rpcError } = await supabase.rpc('submit_identity_verification', {
        p_selfie_url: selfiePath,
        p_match_score: Number(score.toFixed(3)),
        p_liveness_ok: capture.livenessPassed,
        p_valid_id_url: idPath,
        p_valid_id_type: idType,
        // The document was already read and accepted when the file was
        // picked, so a mismatch cannot reach here through the form. The
        // parameters stay because the function must not trust that.
        p_id_text_check: null,
        p_id_looks_like: null,
      });

      if (rpcError) throw new Error(rpcError.message);

      const outcome = data as VerificationOutcome;
      setResult({ outcome, score });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Verification could not be completed.');
    } finally {
      if (idUrl) URL.revokeObjectURL(idUrl);
      setBusy(false);
      setStep('');
    }
  };

  if (result) {
    const { outcome, score } = result;

    return (
      <div className={`verify-result verify-result--${outcome.toLowerCase()}`}>
        <IonIcon icon={outcome === 'Approved' ? checkmarkCircle : alertCircleOutline} />

        <h2 className="verify-result__title">
          {outcome === 'Approved'
            ? 'Identity verified'
            : outcome === 'Flagged'
              ? 'Sent for review'
              : 'That did not match'}
        </h2>

        <p className="verify-result__body">
          {outcome === 'Approved'
            ? 'The face in your photo matched the face on your ID. Your account is active and you can start using FarmVest now.'
            : outcome === 'Flagged'
              ? 'The match was close but not certain, which happens often with an older ID photograph. An administrator compares the two by eye, usually within a day.'
              : 'The face in your photo does not match the face on the ID you uploaded. Check you uploaded your own ID, then try again in better light.'}
        </p>

        <p className="verify-result__score">Match score {(score * 100).toFixed(0)}%</p>

        <button
          type="button"
          className="dash-btn dash-btn--primary"
          onClick={() => (outcome === 'Rejected' ? setResult(null) : onDone(outcome))}
        >
          {outcome === 'Rejected' ? 'Try again' : 'Continue'}
        </button>
      </div>
    );
  }

  return (
    <div className="verify">
      <div className="verify__intro">
        <IonIcon icon={shieldCheckmarkOutline} />
        <div>
          <h2 className="verify__title">Verify it is you</h2>
          <p className="verify__lead">
            Posting a project means asking other people for money, so FarmVest checks who you
            are first. The face on your government ID is compared with a live photo, on this
            device. Neither picture is sent anywhere to be scored, and you only do this once.
          </p>
        </div>
      </div>

      {error && <p className="dash-error">{error}</p>}

      <div className="verify__step">
        <span className="verify__step-label">Step 1 — Your government ID</span>

        <select
          className="dash-select"
          value={idType}
          onChange={(event) => {
            setIdType(event.target.value);
            setTypeChecked(false);
            setFile(null);
            setError(null);
          }}
          aria-label="Which ID are you uploading"
        >
          <option value="">Which ID are you uploading?</option>
          {VALID_ID_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <label className="dash-upload" htmlFor="verify-id">
          <IonIcon icon={file ? idCardOutline : cloudUploadOutline} />
          <span>{file ? file.name : 'Choose a photo of your valid ID'}</span>
        </label>
        <input
          id="verify-id"
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
        />

        <p className="dash-row__meta">
          Photograph it flat and in good light. Glare across the picture is the usual reason a
          face cannot be read.
        </p>
      </div>

      <div className="verify__step">
        <span className="verify__step-label">Step 2 — A live photo of you</span>

        {!idType || !file || !typeChecked ? (
          <p className="dash-row__meta">
            {!idType
              ? 'Choose which ID you are uploading first.'
              : !file
                ? 'Now choose the ID file.'
                : 'Reading the document.'}
          </p>
        ) : busy ? (
          <div className="dash-loading">
            <IonSpinner name="crescent" />
            <p className="dash-row__meta">{step || 'Working'}</p>
          </div>
        ) : (
          <FaceCapture onCapture={handleCapture} onError={setError} />
        )}
      </div>
    </div>
  );
};

export default IdentityVerification;
