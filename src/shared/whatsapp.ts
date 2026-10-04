/**
 * Gera links "click to chat" do WhatsApp (wa.me). Não é uma integração com a API:
 * apenas abre a conversa no aparelho de quem clica, com a mensagem preenchida.
 */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 13) return digits;
  return null;
}

export function whatsAppLink(phone: string | null | undefined, message: string): string | null {
  const number = toWhatsAppNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
