import { app } from './app.js';
import { env } from './config/env.js';

app.listen(env.PORT, () => {
  console.log(`API Alfa Gestão Escolar executando na porta ${env.PORT}`);
});
