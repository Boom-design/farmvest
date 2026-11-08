import { useCallback, useEffect, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { closeOutline, cloudUploadOutline, imageOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import Portal from '../../components/Portal';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { hasValue, NONE, orNone, peso, pillClass, shortDate } from '../../lib/format';
import { EQUIPMENT_GROUPS } from '../../lib/equipment';
import '../../theme/dashboard.css';
import Skeleton from '../../components/Skeleton';

type EquipmentRow = {
  equipment_id: string;
  unit_code: string | null;
  name: string;
  type: string | null;
  price_per_day: number;
  availability_status: 'Available' | 'Rented' | 'Maintenance';
  condition_notes: string | null;
  image_url: string | null;
};

type MaintenanceRow = {
  maintenance_logs_id: string;
  equipment_id: string;
  service_date: string;
  service_type: string;
  description: string | null;
  cost: number | null;
  next_service_date: string | null;
};

type EquipmentForm = {
  unit_code: string;
  name: string;
  type: string;
  price_per_day: string;
  availability_status: EquipmentRow['availability_status'];
  condition_notes: string;
  /** Photo already stored for the unit being edited; empty for a new one. */
  image_url: string;
};

const emptyForm: EquipmentForm = {
  unit_code: '',
  name: '',
  type: '',
  price_per_day: '',
  availability_status: 'Available',
  condition_notes: '',
  image_url: '',
};

/** Matches the file size limit set on the equipment-photos bucket. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const emptyLog = {
  service_date: new Date().toISOString().slice(0, 10),
  service_type: 'Routine',
  description: '',
  cost: '',
  next_service_date: '',
};

const EquipmentFleet: React.FC = () => {
  const { profile } = useAuth();
  const { showSuccess } = useToast();

  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [logs, setLogs] = useState<MaintenanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<EquipmentForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [photo, setPhoto] = useState<File | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<EquipmentRow | null>(null);
  const [logForm, setLogForm] = useState(emptyLog);

  const load = useCallback(async () => {
    setError(null);

    const [equipmentRes, logsRes] = await Promise.all([
      supabase
        .from('equipment')
        .select(
          'equipment_id, unit_code, name, type, price_per_day, availability_status, condition_notes, image_url'
        )
        .order('name'),
      supabase
        .from('maintenance_logs')
        .select(
          'maintenance_logs_id, equipment_id, service_date, service_type, description, cost, next_service_date'
        )
        .order('service_date', { ascending: false }),
    ]);

    const failed = [equipmentRes, logsRes].find((result) => result.error);

    if (failed?.error) {
      setError(failed.error.message);
    } else {
      setEquipment((equipmentRes.data ?? []) as EquipmentRow[]);
      setLogs((logsRes.data ?? []) as MaintenanceRow[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setPhoto(null);
  };

  useEffect(() => {
    if (!showForm) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetForm();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  const saveEquipment = async () => {
    if (!form.name.trim() || !form.price_per_day) {
      setError('Equipment name and rate per day are required.');
      return;
    }

    if (photo && photo.size > MAX_PHOTO_BYTES) {
      setError('The equipment photo must be 5 MB or smaller.');
      return;
    }

    setSaving(true);
    setError(null);

    // A new file replaces whatever the unit had; with no file the stored photo
    // is kept, and image_url stays NULL when there has never been one.
    let imageUrl: string | null = form.image_url || null;

    if (photo) {
      const extension = photo.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${editingId ?? crypto.randomUUID()}/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('equipment-photos')
        .upload(path, photo, { contentType: photo.type || undefined, upsert: true });

      if (uploadError) {
        setError(uploadError.message);
        setSaving(false);
        return;
      }

      imageUrl = supabase.storage.from('equipment-photos').getPublicUrl(path).data.publicUrl;
    }

    const payload = {
      unit_code: form.unit_code.trim() || NONE,
      name: form.name.trim(),
      type: form.type.trim() || NONE,
      price_per_day: Number(form.price_per_day),
      availability_status: form.availability_status,
      condition_notes: form.condition_notes.trim() || NONE,
      image_url: imageUrl,
    };

    const { error: saveError } = editingId
      ? await supabase.from('equipment').update(payload).eq('equipment_id', editingId)
      : await supabase.from('equipment').insert([payload]);

    if (saveError) {
      setError(saveError.message);
    } else {
      showSuccess(editingId ? 'Equipment updated.' : 'Equipment added to the fleet.');
      resetForm();
      await load();
    }

    setSaving(false);
  };

  const editUnit = (unit: EquipmentRow) => {
    setEditingId(unit.equipment_id);
    setShowForm(true);
    setPhoto(null);
    setForm({
      unit_code: unit.unit_code ?? '',
      name: unit.name,
      type: unit.type ?? '',
      price_per_day: String(unit.price_per_day),
      availability_status: unit.availability_status,
      condition_notes: unit.condition_notes ?? '',
      image_url: unit.image_url ?? '',
    });
  };

  const removeUnit = async (unit: EquipmentRow) => {
    setSaving(true);
    setError(null);

    const { error: deleteError } = await supabase
      .from('equipment')
      .delete()
      .eq('equipment_id', unit.equipment_id);

    if (deleteError) {
      setError(
        `${deleteError.message}. A unit that already has rental records cannot be removed; set it to Maintenance instead.`
      );
    } else {
      if (selectedUnit?.equipment_id === unit.equipment_id) setSelectedUnit(null);
      await load();
    }

    setSaving(false);
  };

  const changeStatus = async (unit: EquipmentRow, status: EquipmentRow['availability_status']) => {
    setError(null);

    const { error: statusError } = await supabase
      .from('equipment')
      .update({ availability_status: status })
      .eq('equipment_id', unit.equipment_id);

    if (statusError) {
      setError(statusError.message);
    } else {
      await load();
    }
  };

  const addLog = async () => {
    if (!selectedUnit) return;

    setSaving(true);
    setError(null);

    const { error: logError } = await supabase.from('maintenance_logs').insert([
      {
        equipment_id: selectedUnit.equipment_id,
        service_date: logForm.service_date,
        service_type: logForm.service_type,
        description: logForm.description.trim() || NONE,
        cost: logForm.cost ? Number(logForm.cost) : null,
        next_service_date: logForm.next_service_date || null,
      },
    ]);

    if (logError) {
      setError(logError.message);
    } else {
      showSuccess('Maintenance record saved.');
      setLogForm(emptyLog);
      await load();
    }

    setSaving(false);
  };

  const lastServiceFor = (equipmentId: string) =>
    logs.find((log) => log.equipment_id === equipmentId)?.service_date ?? null;

  const unitLogs = selectedUnit
    ? logs.filter((log) => log.equipment_id === selectedUnit.equipment_id)
    : [];

  return (
    <IonPage>
      <DashboardHeader
        title="Equipment Fleet"
        subtitle="FarmVest owns this fleet: add units, set availability, and keep maintenance records."
        accountName={profile?.name || 'System Administrator'}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-toolbar-row">
            <button
              type="button"
              className="dash-btn dash-btn--primary"
              onClick={() => setShowForm(true)}
            >
              Add Equipment
            </button>
            <span className="dash-stat__hint">{equipment.length} units in the fleet</span>
          </div>

          {/* A dialog rather than a panel above the table. Eight fields and a
              photo picker pushed the fleet itself off the screen, so adding a
              unit meant scrolling back down to see whether it had appeared. */}
          {showForm && (
            <Portal
              className="dash-modal"
              role="dialog"
              aria-modal="true"
              aria-label={editingId ? 'Edit equipment' : 'Add equipment'}
              onClick={resetForm}
            >
              <div
                className="dash-modal__panel dash-modal__panel--wide"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="dash-modal__head">
                  <div>
                    <p className="dash-modal__eyebrow">Equipment fleet</p>
                    <h2 className="dash-modal__title">
                      {editingId ? 'Edit Equipment' : 'Add Equipment'}
                    </h2>
                  </div>

                  <button
                    type="button"
                    className="dash-modal__close"
                    onClick={resetForm}
                    aria-label="Close"
                  >
                    <IonIcon icon={closeOutline} />
                  </button>
                </div>

                <div className="dash-modal__body dash-modal__body--form">
                  <div className="dash-form">
                  <div className="dash-field">
                    <label htmlFor="unit-code">Unit Code</label>
                    <input
                      id="unit-code"
                      className="dash-input"
                      placeholder="TRAC-01"
                      value={form.unit_code}
                      onChange={(e) => setForm({ ...form, unit_code: e.target.value })}
                    />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="unit-name">Equipment Name</label>
                    <input
                      id="unit-name"
                      className="dash-input"
                      placeholder="Hand Tractor"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>

                  {/* A list rather than a text box. The weather advisory reads
                      this field to decide what to recommend, so a free-text
                      "kuliglig" and a "Hand Tractor" being two different types
                      was a correctness problem, not a tidiness one. */}
                  <div className="dash-field">
                    <label htmlFor="unit-type">Type</label>
                    <select
                      id="unit-type"
                      className="dash-select"
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value })}
                    >
                      <option value="">Select a type</option>
                      {EQUIPMENT_GROUPS.map((group) => (
                        <optgroup key={group.group} label={group.group}>
                          {group.types.map((type) => (
                            <option key={type.label} value={type.label}>
                              {type.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className="dash-field">
                    <label htmlFor="unit-rate">Rate per Day</label>
                    <input
                      id="unit-rate"
                      className="dash-input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="1200"
                      value={form.price_per_day}
                      onChange={(e) => setForm({ ...form, price_per_day: e.target.value })}
                    />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="unit-status">Availability</label>
                    <select
                      id="unit-status"
                      className="dash-select"
                      value={form.availability_status}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          availability_status: e.target.value as EquipmentRow['availability_status'],
                        })
                      }
                    >
                      <option value="Available">Available</option>
                      <option value="Rented">Rented</option>
                      <option value="Maintenance">Maintenance</option>
                    </select>
                  </div>

                  <div className="dash-field" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="unit-photo">Equipment Photo</label>

                    <div className="equipment-photo-picker">
                      {photo ? (
                        <img
                          className="equipment-photo-picker__preview"
                          src={URL.createObjectURL(photo)}
                          alt=""
                        />
                      ) : hasValue(form.image_url) ? (
                        <img
                          className="equipment-photo-picker__preview"
                          src={form.image_url}
                          alt=""
                        />
                      ) : (
                        <span className="equipment-photo-picker__empty">
                          <IonIcon icon={imageOutline} />
                        </span>
                      )}

                      <div>
                        <label className="dash-upload" htmlFor="unit-photo">
                          <IonIcon icon={cloudUploadOutline} />
                          <span>{photo ? photo.name : 'Choose an image, up to 5 MB'}</span>
                        </label>
                        <input
                          id="unit-photo"
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                        />
                        <p className="dash-row__meta">
                          Farm owners browse the fleet by picture, so a clear photo of the unit
                          helps them pick the right one.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="dash-field" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="unit-notes">Condition Notes</label>
                    <textarea
                      id="unit-notes"
                      className="dash-textarea"
                      placeholder="Engine serviced, tires replaced..."
                      value={form.condition_notes}
                      onChange={(e) => setForm({ ...form, condition_notes: e.target.value })}
                    />
                  </div>
                  </div>
                </div>

                <div className="dash-modal__foot">
                  <button type="button" className="dash-btn dash-btn--ghost" onClick={resetForm}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary"
                    disabled={saving}
                    onClick={saveEquipment}
                  >
                    {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add to Fleet'}
                  </button>
                </div>
              </div>
            </Portal>
          )}

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">Fleet Inventory</h2>
            </div>
            <div className="dash-panel__body dash-table-wrap">
              {loading ? (
                <Skeleton />
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Unit</th>
                      <th>Type</th>
                      <th>Rate / Day</th>
                      <th>Status</th>
                      <th>Last Service</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipment.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState
                            title="No equipment in the fleet yet"
                            message="Use Add Equipment to register the first unit."
                            size={120}
                          />
                        </td>
                      </tr>
                    ) : (
                      equipment.map((unit) => (
                      <tr key={unit.equipment_id}>
                        <td>
                          {hasValue(unit.image_url) ? (
                            <img className="equipment-thumb" src={unit.image_url} alt="" loading="lazy" />
                          ) : (
                            <span className="equipment-thumb equipment-thumb--empty">
                              <IonIcon icon={imageOutline} />
                            </span>
                          )}
                        </td>
                        <td>
                          <p className="dash-row__title">{unit.name}</p>
                          <p className="dash-row__meta">
                            {unit.unit_code ? `${unit.unit_code} - ` : ''}
                            {orNone(unit.condition_notes)}
                          </p>
                        </td>
                        <td className="dash-table__muted">{orNone(unit.type)}</td>
                        <td>{peso(unit.price_per_day)}</td>
                        <td>
                          <select
                            className="dash-select"
                            style={{ maxWidth: 160 }}
                            value={unit.availability_status}
                            onChange={(e) =>
                              changeStatus(
                                unit,
                                e.target.value as EquipmentRow['availability_status']
                              )
                            }
                          >
                            <option value="Available">Available</option>
                            <option value="Rented">Rented</option>
                            <option value="Maintenance">Maintenance</option>
                          </select>
                        </td>
                        <td className="dash-table__muted">
                          {shortDate(lastServiceFor(unit.equipment_id))}
                        </td>
                        <td>
                          <div className="dash-actions">
                            <button
                              type="button"
                              className="dash-btn dash-btn--slate"
                              onClick={() => setSelectedUnit(unit)}
                            >
                              Logs
                            </button>
                            <button
                              type="button"
                              className="dash-btn dash-btn--slate"
                              onClick={() => editUnit(unit)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="dash-btn dash-btn--ghost"
                              disabled={saving}
                              onClick={() => removeUnit(unit)}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {selectedUnit && (
            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2 className="dash-panel__title">
                  Maintenance Records - {selectedUnit.unit_code || selectedUnit.name}
                </h2>
                <button
                  type="button"
                  className="dash-panel__link"
                  onClick={() => setSelectedUnit(null)}
                >
                  Close
                </button>
              </div>

              <div className="dash-panel__body">
                <div className="dash-form">
                  <div className="dash-field">
                    <label htmlFor="log-date">Service Date</label>
                    <input
                      id="log-date"
                      type="date"
                      className="dash-input"
                      value={logForm.service_date}
                      onChange={(e) => setLogForm({ ...logForm, service_date: e.target.value })}
                    />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="log-type">Service Type</label>
                    <select
                      id="log-type"
                      className="dash-select"
                      value={logForm.service_type}
                      onChange={(e) => setLogForm({ ...logForm, service_type: e.target.value })}
                    >
                      <option value="Routine">Routine</option>
                      <option value="Repair">Repair</option>
                      <option value="Inspection">Inspection</option>
                    </select>
                  </div>

                  <div className="dash-field">
                    <label htmlFor="log-cost">Cost</label>
                    <input
                      id="log-cost"
                      type="number"
                      min="0"
                      step="0.01"
                      className="dash-input"
                      value={logForm.cost}
                      onChange={(e) => setLogForm({ ...logForm, cost: e.target.value })}
                    />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="log-next">Next Service</label>
                    <input
                      id="log-next"
                      type="date"
                      className="dash-input"
                      value={logForm.next_service_date}
                      onChange={(e) =>
                        setLogForm({ ...logForm, next_service_date: e.target.value })
                      }
                    />
                  </div>

                  <div className="dash-field" style={{ gridColumn: '1 / -1' }}>
                    <label htmlFor="log-desc">Description</label>
                    <input
                      id="log-desc"
                      className="dash-input"
                      placeholder="Oil change and filter replacement"
                      value={logForm.description}
                      onChange={(e) => setLogForm({ ...logForm, description: e.target.value })}
                    />
                  </div>
                </div>

                <div className="dash-actions" style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary"
                    disabled={saving}
                    onClick={addLog}
                  >
                    {saving ? 'Saving...' : 'Add Maintenance Record'}
                  </button>
                </div>

                <div className="dash-table-wrap" style={{ marginTop: 16 }}>
                  {unitLogs.length === 0 ? (
                    <EmptyState title="No maintenance logged for this unit yet" size={120} />
                  ) : (
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Service Date</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th>Cost</th>
                          <th>Next Service</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unitLogs.map((log) => (
                          <tr key={log.maintenance_logs_id}>
                            <td>{shortDate(log.service_date)}</td>
                            <td>
                              <span className={pillClass(log.service_type)}>{log.service_type}</span>
                            </td>
                            <td className="dash-table__muted">{orNone(log.description)}</td>
                            <td>{log.cost === null ? NONE : peso(log.cost)}</td>
                            <td className="dash-table__muted">
                              {shortDate(log.next_service_date)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default EquipmentFleet;
