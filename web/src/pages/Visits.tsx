import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { ErrorAlert, Loading } from '../components/ui';
import { useLoad } from '../hooks';
import { SCHOOL_TIME_ZONE, formatPhone } from '../labels';

type Slot = {
  id: string;
  unit_id: string;
  unit_name: string;
  starts_at: string;
  capacity: number;
  visits: { visit_id: string; lead_id: string; student_name: string; guardian_name: string; guardian_phone: string }[];
};
type Unit = { id: string; name: string; accepting_enrollments: boolean };

const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

const isoLocal = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function Visits() {
  const { api, can } = useAuth();
  const units = useLoad(() => api<{ data: Unit[] }>('/api/units').then((r) => r.data), [api]);
  const [unitId, setUnitId] = useState('');
  const selectedUnit = unitId || units.data?.find((unit) => unit.accepting_enrollments)?.id || units.data?.[0]?.id || '';
  const slots = useLoad(
    () => (selectedUnit ? api<{ data: Slot[] }>(`/api/visit-slots?unit_id=${selectedUnit}`).then((r) => r.data) : Promise.resolve([])),
    [api, selectedUnit],
  );
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const slot of slots.data ?? []) {
      const label = new Date(slot.starts_at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: SCHOOL_TIME_ZONE });
      const key = label.charAt(0).toUpperCase() + label.slice(1);
      groups.set(key, [...(groups.get(key) ?? []), slot]);
    }
    return [...groups.entries()];
  }, [slots.data]);

  const cancel = async (slot: Slot) => {
    setError(null);
    try {
      await api(`/api/visit-slots/${slot.id}`, { method: 'DELETE' });
      slots.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  if (units.loading && !units.data) return <Loading />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Agenda de visitas</h1>
          <p className="muted">Os horários livres aparecem no site para as famílias escolherem.</p>
        </div>
        {units.data && units.data.length > 1 && (
          <select value={selectedUnit} onChange={(event) => setUnitId(event.target.value)} style={{ width: 'auto' }} aria-label="Unidade">
            {units.data.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <ErrorAlert message={error ?? slots.error} />

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2>Próximas visitas</h2>
          {slots.loading && !slots.data ? (
            <Loading />
          ) : days.length ? (
            days.map(([day, items]) => (
              <div key={day} style={{ marginBottom: '1.25rem' }}>
                <div className="section-title" style={{ marginTop: 0, textTransform: 'none', fontSize: '0.85rem' }}>
                  {day}
                </div>
                {items.map((slot) => (
                  <div key={slot.id} style={{ borderBottom: '1px solid var(--border)', padding: '0.5rem 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong>{new Date(slot.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: SCHOOL_TIME_ZONE })}</strong>
                      <span className="muted small">
                        {slot.visits.length}/{slot.capacity} famílias
                        {can('admissions:manage') && !slot.visits.length && (
                          <button className="btn btn-small" style={{ marginLeft: '0.5rem' }} onClick={() => cancel(slot)}>
                            Fechar horário
                          </button>
                        )}
                      </span>
                    </div>
                    {slot.visits.map((visit) => (
                      <div key={visit.visit_id} className="small">
                        <Link to={`/app/captacao/${visit.lead_id}`}>{visit.student_name}</Link> · {visit.guardian_name} ·{' '}
                        {formatPhone(visit.guardian_phone)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="empty">Nenhum horário aberto. Crie horários ao lado.</div>
          )}
        </div>
        {can('admissions:manage') && selectedUnit && <SlotsForm unitId={selectedUnit} onCreated={slots.reload} />}
      </div>
    </>
  );
}

function SlotsForm({ unitId, onCreated }: { unitId: string; onCreated: () => void }) {
  const { api } = useAuth();
  const [weeks, setWeeks] = useState(3);
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);
  const [times, setTimes] = useState('09:00, 14:30');
  const [capacity, setCapacity] = useState(3);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const today = new Date();
    const dates = Array.from({ length: weeks * 7 }, (_, index) => addDays(today, index + 1))
      .filter((date) => weekdays.includes(date.getDay()))
      .map(isoLocal);
    const timeList = times.split(/[,\s]+/).filter(Boolean);

    try {
      const result = await api<{ created: number }>('/api/visit-slots', {
        method: 'POST',
        body: { unit_id: unitId, dates, times: timeList, capacity },
      });
      setMessage(`${result.created} horários abertos.`);
      onCreated();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>Abrir horários</h2>
      <ErrorAlert message={error} />
      {message && <div className="alert alert-success">{message}</div>}
      <div className="field">
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Dias da semana</span>
        <div className="actions">
          {WEEKDAYS.map((day) => (
            <button
              type="button"
              key={day.value}
              className={`tab ${weekdays.includes(day.value) ? 'active' : ''}`}
              onClick={() =>
                setWeekdays(weekdays.includes(day.value) ? weekdays.filter((item) => item !== day.value) : [...weekdays, day.value])
              }
            >
              {day.label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="s-times">Horários</label>
          <input id="s-times" value={times} onChange={(event) => setTimes(event.target.value)} />
          <span className="hint">Separe por vírgula. Ex.: 09:00, 14:30</span>
        </div>
        <div className="field">
          <label htmlFor="s-weeks">Próximas semanas</label>
          <input id="s-weeks" type="number" min={1} max={8} value={weeks} onChange={(event) => setWeeks(Number(event.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="s-capacity">Famílias por horário</label>
          <input id="s-capacity" type="number" min={1} max={20} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} />
        </div>
      </div>
      <button className="btn btn-primary" disabled={!weekdays.length}>
        Abrir horários
      </button>
    </form>
  );
}
