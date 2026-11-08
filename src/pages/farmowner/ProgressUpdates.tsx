import { useCallback, useEffect, useMemo, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { cloudUploadOutline, locationOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { NONE, orNone, shortDate } from '../../lib/format';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type ProjectOption = {
  projects_id: string;
  title: string;
  status: string;
};

type UpdateRow = {
  progress_updates_id: string;
  projects_id: string;
  photo_url: string | null;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
};

type Coords = { latitude: number; longitude: number };

/** Matches the file size limit set on the progress-photos storage bucket. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const stamp = (value: string) =>
  new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Statuses a project can still take progress updates in. A completed,
 * cancelled or rejected project is a record: its updates stay listed below,
 * but nothing new is added to it.
 */
const POSTABLE = ['Open', 'Funded', 'In Progress', 'Under Investigation'];

const ProgressUpdates: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('projects_id, title, status')
      .eq('customers_id', profile.users_id)
      .order('created_at', { ascending: false });

    if (projectError) {
      setError(projectError.message);
      setLoading(false);
      return;
    }

    const rows = (projectData ?? []) as ProjectOption[];
    setProjects(rows);
    // Only a running project takes new updates; keep the choice if it still is one.
    const running = rows.filter((row) => POSTABLE.includes(row.status));
    setProjectId((current) =>
      running.some((row) => row.projects_id === current) ? current : running[0]?.projects_id || ''
    );

    if (rows.length === 0) {
      setUpdates([]);
      setLoading(false);
      return;
    }

    const { data: updateData, error: updateError } = await supabase
      .from('progress_updates')
      .select('progress_updates_id, projects_id, photo_url, captured_at, latitude, longitude, notes')
      .in(
        'projects_id',
        rows.map((row) => row.projects_id)
      )
      .order('captured_at', { ascending: false });

    if (updateError) {
      setError(updateError.message);
    } else {
      setUpdates((updateData ?? []) as UpdateRow[]);
    }

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const projectTitle = useCallback(
    (id: string) => projects.find((project) => project.projects_id === id)?.title ?? 'Project',
    [projects]
  );

  const visibleUpdates = useMemo(
    () => (projectId ? updates.filter((update) => update.projects_id === projectId) : updates),
    [updates, projectId]
  );

  // Geotagging is what lets an investor trust the photo, so the coordinates are
  // read from the device rather than typed in.
  const captureLocation = () => {
    if (!navigator.geolocation) {
      setError('This device does not support location capture.');
      return;
    }

    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
        });
        setLocating(false);
      },
      (positionError) => {
        setError(`Could not read your location: ${positionError.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const submit = async () => {
    if (!profile) return;

    if (!projectId) {
      setError('Please choose a project.');
      return;
    }

    if (!photo) {
      setError('Please attach a photo of the current progress.');
      return;
    }

    if (photo.size > MAX_PHOTO_BYTES) {
      setError('The photo must be 5 MB or smaller.');
      return;
    }

    if (!coords) {
      setError('Please capture the location so investors can verify where the photo was taken.');
      return;
    }

    setSaving(true);
    setError(null);

    // Stored under the user's own id, which is what the storage policy checks.
    const extension = photo.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${profile.users_id}/${projectId}-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('progress-photos')
      .upload(path, photo, { contentType: photo.type || undefined });

    if (uploadError) {
      setError(uploadError.message);
      setSaving(false);
      return;
    }

    const { data: publicUrl } = supabase.storage.from('progress-photos').getPublicUrl(path);

    const { error: insertError } = await supabase.from('progress_updates').insert({
      projects_id: projectId,
      photo_url: publicUrl.publicUrl,
      captured_at: new Date().toISOString(),
      latitude: coords.latitude,
      longitude: coords.longitude,
      notes: notes.trim() || NONE,
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setPhoto(null);
      setNotes('');
      setCoords(null);
      showSuccess('Progress update posted.');
      await load();
    }

    setSaving(false);
  };

  return (
    <IonPage>
      <DashboardHeader
        title="Progress Updates"
        subtitle="Post timestamped and geotagged photos so investors can verify progress."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          {!loading && projects.length === 0 ? (
            <section className="dash-panel">
              <div className="dash-panel__body">
                <EmptyState
                  title="No project to update yet"
                  message="Post a livestock project first; a progress update is always attached to one."
                />
              </div>
            </section>
          ) : (
            <>
              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">New Update</h2>
                </div>

                <div className="dash-panel__body">
                  {!projects.some((project) => POSTABLE.includes(project.status)) ? (
                    <EmptyState
                      title="No running project to update"
                      message="Every project of yours is completed or closed. Its updates are kept below, and a new project takes updates once it is posted."
                    />
                  ) : (
                  <>
                  <div className="dash-form">
                    <div className="dash-field">
                      <label htmlFor="update-project">Project</label>
                      <select
                        id="update-project"
                        className="dash-select"
                        value={projectId}
                        onChange={(event) => setProjectId(event.target.value)}
                      >
                        {projects.filter((project) => POSTABLE.includes(project.status)).map((project) => (
                          <option key={project.projects_id} value={project.projects_id}>
                            {project.title} ({project.status})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="dash-field">
                      <label htmlFor="update-photo">Photo</label>
                      <label className="dash-upload" htmlFor="update-photo">
                        <IonIcon icon={cloudUploadOutline} />
                        <span>{photo ? photo.name : 'Choose an image, up to 5 MB'}</span>
                      </label>
                      <input
                        id="update-photo"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        hidden
                        onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                      />
                    </div>

                    <div className="dash-field">
                      <label>Location</label>
                      <button
                        type="button"
                        className="dash-btn dash-btn--slate"
                        disabled={locating}
                        onClick={captureLocation}
                      >
                        <IonIcon icon={locationOutline} />
                        {locating ? 'Reading location...' : 'Capture Location'}
                      </button>
                      <p className="dash-stat__hint">
                        {coords
                          ? `${coords.latitude}, ${coords.longitude}`
                          : 'Not captured yet'}
                      </p>
                    </div>
                  </div>

                  <div className="dash-field dash-field--full">
                    <label htmlFor="update-notes">Notes</label>
                    <textarea
                      id="update-notes"
                      className="dash-textarea"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Feed schedule, head count, weight, health, or anything investors should know."
                    />
                  </div>

                  <div className="dash-actions dash-actions--end">
                    <button
                      type="button"
                      className="dash-btn dash-btn--primary"
                      disabled={saving}
                      onClick={submit}
                    >
                      {saving ? 'Posting...' : 'Post Update'}
                    </button>
                  </div>
                  </>
                  )}
                </div>
              </section>

              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Posted Updates</h2>
                  <span className="dash-stat__hint">{visibleUpdates.length} shown</span>
                </div>

                <div className="dash-panel__body">
                  {loading ? (
                    <Skeleton />
                  ) : visibleUpdates.length === 0 ? (
                    <EmptyState title="No update posted for this project yet" size={130} />
                  ) : (
                    <div className="dash-cards">
                      {visibleUpdates.map((update) => (
                        <article key={update.progress_updates_id} className="dash-card">
                          {update.photo_url && (
                            <img
                              className="dash-card__photo"
                              src={update.photo_url}
                              alt={`Progress on ${projectTitle(update.projects_id)}`}
                              loading="lazy"
                            />
                          )}

                          <p className="dash-row__title">{projectTitle(update.projects_id)}</p>
                          <p className="dash-row__meta">{stamp(update.captured_at)}</p>

                          {update.latitude !== null && update.longitude !== null && (
                            <p className="dash-row__meta">
                              <IonIcon icon={locationOutline} /> {update.latitude},{' '}
                              {update.longitude}
                            </p>
                          )}

                          <p className="dash-row__meta">{orNone(update.notes)}</p>
                          <p className="dash-stat__hint">Posted {shortDate(update.captured_at)}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ProgressUpdates;
