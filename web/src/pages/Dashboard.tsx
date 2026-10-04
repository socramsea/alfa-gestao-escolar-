import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorAlert, Loading } from '../components/ui';
import { useLoad } from '../hooks';
import { formatDate } from '../labels';

type Overview = {
  active_students: number;
  students_without_class: number;
  classes: number;
  guardians: number;
  guardians_with_phone: number;
  open_campaigns: { id: string; title: string; kind: string; ends_on: string; total: number; responded: number; approved: number }[];
};

type Funnel = {
  total: number;
  funnel: { stage: string; label: string; count: number }[];
  new_waiting: number;
  conversion_rate: number;
  visits_next_7_days: number;
  by_source: { source: string; total: number; enrolled: number }[];
};

const SOURCE_LABELS: Record<string, string> = {
  site: 'Site',
  whatsapp: 'WhatsApp',
  referral: 'Indicação',
  instagram: 'Instagram',
  walk_in: 'Na escola',
  other: 'Outro',
};

type CampaignStats = {
  campaign: { id: string; title: string; ends_on: string; days_left: number };
  total: number;
  by_status: Record<string, number>;
  response_rate: number;
  approval_rate: number;
  by_class: { class_name: string; total: number; responded: number; approved: number }[];
  timeline: { day: string; submissions: number }[];
};

const SEGMENTS = [
  { key: 'approved', label: 'Aprovados', color: 'var(--success)' },
  { key: 'submitted', label: 'Para analisar', color: 'var(--info)' },
  { key: 'changes_requested', label: 'Em correção', color: 'var(--warning)' },
  { key: 'rejected', label: 'Rejeitados', color: 'var(--danger)' },
  { key: 'pending', label: 'Sem resposta', color: 'var(--border)' },
];

export function Dashboard() {
  const { api, me, can } = useAuth();
  const overview = useLoad(() => api<Overview>('/api/dashboard'), [api]);
  const campaignId = overview.data?.open_campaigns.find((campaign) => campaign.kind === 'renewal')?.id;
  const funnel = useLoad(() => (can('admissions:read') ? api<Funnel>('/api/dashboard/admissions') : Promise.resolve(null)), [api]);
  const stats = useLoad(
    () => (campaignId ? api<CampaignStats>(`/api/dashboard/renewals/${campaignId}`) : Promise.resolve(null)),
    [api, campaignId],
  );

  if (overview.loading && !overview.data) return <Loading />;
  const data = overview.data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Painel</h1>
          <p className="muted">{me?.school.name}: visão geral em tempo real</p>
        </div>
      </div>
      <ErrorAlert message={overview.error ?? stats.error} />

      {data && (
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">Alunos ativos</div>
            <div className="kpi-value">{data.active_students}</div>
            <div className="kpi-hint">{data.students_without_class} sem turma</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Turmas</div>
            <div className="kpi-value">{data.classes}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Responsáveis com WhatsApp</div>
            <div className="kpi-value">
              {data.guardians ? Math.round((data.guardians_with_phone / data.guardians) * 100) : 0}%
            </div>
            <div className="kpi-hint">
              {data.guardians_with_phone} de {data.guardians}
            </div>
          </div>
          {stats.data && (
            <div className="kpi">
              <div className="kpi-label">Renovação respondida</div>
              <div className="kpi-value">{stats.data.response_rate}%</div>
              <div className="kpi-hint">{stats.data.campaign.days_left} dias para o fim do prazo</div>
            </div>
          )}
        </div>
      )}

      {data && !campaignId && (
        <div className="card empty">
          Nenhuma renovação em andamento. <Link to="/app/renovacao">Abrir período de renovação</Link>
        </div>
      )}

      {stats.data && (
        <div className="grid grid-2">
          <div className="card">
            <h2>{stats.data.campaign.title}</h2>
            <p className="muted small">Prazo final: {formatDate(stats.data.campaign.ends_on)}</p>
            <div className="progress" role="img" aria-label="Situação das renovações">
              {SEGMENTS.map((segment) => (
                <span
                  key={segment.key}
                  title={`${segment.label}: ${stats.data!.by_status[segment.key]}`}
                  style={{
                    width: `${stats.data!.total ? (stats.data!.by_status[segment.key] / stats.data!.total) * 100 : 0}%`,
                    background: segment.color,
                  }}
                />
              ))}
            </div>
            <div className="legend">
              {SEGMENTS.map((segment) => (
                <span key={segment.key}>
                  <i style={{ background: segment.color }} />
                  {segment.label}: <strong>{stats.data!.by_status[segment.key]}</strong>
                </span>
              ))}
            </div>
            <div className="actions" style={{ marginTop: '1rem' }}>
              <Link className="btn btn-primary" to={`/app/renovacao?status=submitted`}>
                Analisar {stats.data.by_status.submitted} envios
              </Link>
              <Link className="btn" to={`/app/renovacao?status=pending`}>
                Lembrar {stats.data.by_status.pending} sem resposta
              </Link>
            </div>
          </div>

          <div className="card">
            <h2>Respostas por turma</h2>
            {stats.data.by_class.map((row) => (
              <div className="bar-row" key={row.class_name}>
                <span>{row.class_name}</span>
                <div className="progress">
                  <span style={{ width: `${(row.approved / row.total) * 100}%`, background: 'var(--success)' }} />
                  <span
                    style={{ width: `${((row.responded - row.approved) / row.total) * 100}%`, background: 'var(--info)' }}
                  />
                </div>
                <span className="num">
                  {row.responded}/{row.total}
                </span>
              </div>
            ))}
            <div className="legend">
              <span>
                <i style={{ background: 'var(--success)' }} />
                Aprovados
              </span>
              <span>
                <i style={{ background: 'var(--info)' }} />
                Respondidos, em análise
              </span>
            </div>
          </div>
        </div>
      )}
      {funnel.data && funnel.data.total > 0 && (
        <div className="grid grid-2" style={{ marginTop: '1rem' }}>
          <div className="card">
            <h2>Captação de novos alunos</h2>
            <p className="muted small">
              {funnel.data.conversion_rate}% dos contatos viraram matrícula · {funnel.data.visits_next_7_days} visitas nos próximos 7 dias
            </p>
            {funnel.data.funnel.map((stage) => (
              <div className="bar-row" key={stage.stage}>
                <span>{stage.label}</span>
                <div className="progress">
                  <span style={{ width: `${(stage.count / funnel.data!.total) * 100}%`, background: 'var(--primary)' }} />
                </div>
                <span className="num">{stage.count}</span>
              </div>
            ))}
            <div className="actions" style={{ marginTop: '1rem' }}>
              <Link className="btn btn-primary" to="/app/captacao">
                {funnel.data.new_waiting} contatos novos aguardando
              </Link>
              <Link className="btn" to="/app/visitas">
                Agenda de visitas
              </Link>
            </div>
          </div>
          <div className="card">
            <h2>De onde vêm as famílias</h2>
            {funnel.data.by_source.map((row) => (
              <div className="bar-row" key={row.source}>
                <span>{SOURCE_LABELS[row.source] ?? row.source}</span>
                <div className="progress">
                  <span style={{ width: `${(row.enrolled / funnel.data!.total) * 100}%`, background: 'var(--success)' }} />
                  <span style={{ width: `${((row.total - row.enrolled) / funnel.data!.total) * 100}%`, background: 'var(--info)' }} />
                </div>
                <span className="num">{row.total}</span>
              </div>
            ))}
            <div className="legend">
              <span>
                <i style={{ background: 'var(--success)' }} />
                Matriculados
              </span>
              <span>
                <i style={{ background: 'var(--info)' }} />
                Em atendimento ou perdidos
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
