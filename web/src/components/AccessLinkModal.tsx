import { useEffect, useState } from 'react';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { formatDateTime } from '../labels';
import { ErrorAlert, Loading, Modal } from './ui';

type Link = { url: string; expires_at: string; message: string; whatsapp_url: string | null };

/** Gera o link pessoal do responsável e oferece o envio pelo WhatsApp. */
export function AccessLinkModal({ guardian, onClose }: { guardian: { id: string; full_name: string }; onClose: () => void }) {
  const { api } = useAuth();
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<Link>(`/api/guardians/${guardian.id}/access-links`, { method: 'POST' })
      .then(setLink)
      .catch((reason) => setError(errorMessage(reason)));
  }, [api, guardian.id]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.message);
      setCopied(true);
    } catch {
      setError('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  };

  return (
    <Modal title={`Enviar link para ${guardian.full_name}`} onClose={onClose}>
      <ErrorAlert message={error} />
      {!link && !error && <Loading />}
      {link && (
        <>
          <p className="muted small">
            Link pessoal válido até {formatDateTime(link.expires_at)}. Gerar um novo link cancela o anterior.
          </p>
          <div className="message-preview">{link.message}</div>
          <div className="actions">
            {link.whatsapp_url ? (
              <a className="btn btn-whatsapp" href={link.whatsapp_url} target="_blank" rel="noreferrer">
                Abrir no WhatsApp
              </a>
            ) : (
              <span className="alert alert-warning small">Responsável sem telefone cadastrado.</span>
            )}
            <button className="btn" onClick={copy}>
              {copied ? 'Mensagem copiada' : 'Copiar mensagem'}
            </button>
            <button className="btn" onClick={onClose}>
              Fechar
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
