import type { SiteContent } from '../modules/site/content.js';

/**
 * Conteúdo FICTÍCIO do site de demonstração. Serve de modelo para a escola
 * substituir pelos textos, preços e fotos reais no editor do site.
 */
export const DEMO_SITE_CONTENT: SiteContent = {
  hero: {
    title: 'Uma escola perto de você, que conhece cada aluno pelo nome',
    subtitle:
      'Educação Infantil e Ensino Fundamental I com turmas pequenas, rotina clara e família por perto. ' +
      'Agende uma visita ou comece a matrícula pelo celular.',
    image_id: null,
  },
  about: {
    title: 'Sobre a Alfa Reis',
    text:
      'A Alfa Reis nasceu no bairro e cresceu junto com as famílias que confiam em nós. ' +
      'Acreditamos em aprender com afeto, limites claros e muita conversa com a família.\n\n' +
      'Com a nova Unidade Jardim, levamos a mesma proposta para mais perto de você, agora com ' +
      'atendimento, matrícula e comunicação pelo celular.',
  },
  highlights: [
    { title: 'Turmas de até 20 alunos', text: 'A professora acompanha de perto o desenvolvimento de cada criança.' },
    { title: 'Família informada', text: 'Comunicados, rematrícula e atendimento pelo celular, sem papelada.' },
    { title: 'Alimentação balanceada', text: 'Lanche e almoço preparados na escola, com cardápio acompanhado por nutricionista.' },
    { title: 'Período integral', text: 'Opção de integral com atividades no contraturno, para quem trabalha o dia todo.' },
  ],
  routine: [
    { title: '7h – 7h30 · Acolhida', text: 'Entrada tranquila, com a professora recebendo cada criança na sala.' },
    { title: '7h30 – 9h30 · Aprendizagem', text: 'Leitura, escrita e matemática com materiais concretos e brincadeiras.' },
    { title: '9h30 – 10h · Lanche e recreio', text: 'Lanche coletivo e brincadeira no pátio, sempre com acompanhamento.' },
    { title: '10h – 11h30 · Projetos', text: 'Artes, música, educação física e projetos que mudam a cada bimestre.' },
    { title: '11h30 · Saída', text: 'Entrega individual aos responsáveis cadastrados. Integral segue para o almoço.' },
  ],
  segments: [
    { name: 'Infantil 4', ages: '4 anos', shifts: 'Manhã, tarde ou integral', description: 'Socialização, linguagem e coordenação motora com muito brincar.' },
    { name: 'Infantil 5', ages: '5 anos', shifts: 'Manhã, tarde ou integral', description: 'Preparação para a alfabetização, com letras, números e autonomia.' },
    { name: '1º Ano', ages: '6 anos', shifts: 'Manhã ou tarde', description: 'Alfabetização com acompanhamento individual da leitura.' },
    { name: '2º ao 5º Ano', ages: '7 a 10 anos', shifts: 'Manhã ou tarde', description: 'Ensino Fundamental I com projetos, leitura diária e reforço quando necessário.' },
  ],
  uniform: {
    intro:
      'O uniforme é obrigatório a partir do primeiro dia de aula e ajuda na segurança: ' +
      'na saída, sabemos rapidamente quem é aluno da escola. Marque o nome da criança em todas as peças.',
    where_to_buy: 'Venda na secretaria da escola, de segunda a sexta, das 8h às 17h. Aceitamos Pix e cartão.',
    items: [
      { name: 'Camiseta manga curta', description: 'Malha fria azul com o brasão da escola.', price: 'R$ 45,00', required: true, image_id: null },
      { name: 'Bermuda ou short-saia', description: 'Tactel azul-marinho, com elástico.', price: 'R$ 52,00', required: true, image_id: null },
      { name: 'Calça de moletom', description: 'Para os dias frios. Azul-marinho, com faixa lateral.', price: 'R$ 68,00', required: true, image_id: null },
      { name: 'Jaqueta', description: 'Moletom com zíper e capuz.', price: 'R$ 95,00', required: false, image_id: null },
      { name: 'Tênis', description: 'Qualquer modelo fechado, preferencialmente preto ou branco.', price: '', required: true, image_id: null },
    ],
  },
  faq: [
    {
      question: 'Como funciona a matrícula?',
      answer:
        'Você preenche a pré-matrícula aqui no site e agenda uma visita. Depois da visita, enviamos um link pelo WhatsApp ' +
        'para você completar os dados pelo celular. A secretaria confere e confirma a vaga. Sem papel e sem fila.',
    },
    { question: 'Quais documentos vou precisar?', answer: 'Certidão de nascimento e CPF da criança, documento com foto e CPF do responsável, comprovante de endereço e carteira de vacinação.' },
    { question: 'Tem período integral?', answer: 'Sim, para Infantil 4 e 5. O integral inclui almoço e atividades no contraturno.' },
    { question: 'Qual o tamanho das turmas?', answer: 'No máximo 20 alunos por turma, com professora e auxiliar na Educação Infantil.' },
    { question: 'Posso visitar antes de decidir?', answer: 'Claro. Escolha um horário na pré-matrícula. A visita leva cerca de 40 minutos e você conhece as salas, o pátio e a equipe.' },
  ],
  enrollment: {
    open: true,
    year: 2027,
    intro: 'Matrículas abertas para 2027 na nova Unidade Jardim. Vagas limitadas por turma.',
  },
  contact: { whatsapp: '(11) 95555-4444', email: 'contato@alfareis.demo', instagram: '@alfareis.demo' },
};
