process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://alfa:alfa_dev_password@localhost:5432/alfa_gestao_test';
process.env.TEST_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.PUBLIC_APP_URL = 'http://escola.test';
