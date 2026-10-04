export async function enrollmentRequest(token,path,options={}){
  let response;
  try{response=await fetch(`/api/enrollments/${path}`,{...options,
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...options.headers},
    signal:options.signal||AbortSignal.timeout(15000)});
  }catch{throw new Error('Não foi possível conectar. Tente novamente; o reenvio não duplica a matrícula.');}
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const messages={400:'Selecione aluno, turma e grupo/série válidos.',401:'Sessão expirada. Entre novamente.',
      403:'Seu perfil não pode matricular alunos.',404:'Aluno, turma ou grupo/série não está disponível na sua escola.',
      409:'Este aluno já possui matrícula neste período, ou o reenvio conflita com a solicitação anterior.'};
    const error=new Error(messages[response.status]||'Não foi possível concluir a matrícula. Tente novamente.');error.status=response.status;throw error;
  }
  if(!data||typeof data!=='object')throw new Error('Resposta inválida do servidor.');
  return data;
}
