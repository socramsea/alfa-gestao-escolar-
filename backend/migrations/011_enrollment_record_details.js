// Dados da ficha aprovada passam a compor o cadastro: CPF, nome social, saúde e endereço do aluno,
// CPF do responsável e o papel financeiro no vínculo. Colunas opcionais: cadastros manuais
// e registros anteriores continuam válidos sem esses dados (nulo = não informado).
exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE public.students
      ADD COLUMN social_name varchar(150) CHECK (social_name IS NULL OR length(btrim(social_name)) > 0),
      ADD COLUMN cpf varchar(11) CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),
      ADD COLUMN health_notes varchar(2000) CHECK (health_notes IS NULL OR length(btrim(health_notes)) > 0),
      ADD COLUMN address_zip_code varchar(9) CHECK (address_zip_code IS NULL OR address_zip_code ~ '^[0-9]{5}-?[0-9]{3}$'),
      ADD COLUMN address_street varchar(160) CHECK (address_street IS NULL OR length(btrim(address_street)) > 0),
      ADD COLUMN address_number varchar(20) CHECK (address_number IS NULL OR length(btrim(address_number)) > 0),
      ADD COLUMN address_complement varchar(80) CHECK (address_complement IS NULL OR length(btrim(address_complement)) > 0),
      ADD COLUMN address_district varchar(80) CHECK (address_district IS NULL OR length(btrim(address_district)) > 0),
      ADD COLUMN address_city varchar(80) CHECK (address_city IS NULL OR length(btrim(address_city)) > 0),
      ADD COLUMN address_state varchar(2) CHECK (address_state IS NULL OR address_state ~ '^[A-Z]{2}$');
    ALTER TABLE public.guardians
      ADD COLUMN cpf varchar(11) CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');
    ALTER TABLE public.student_guardians
      ADD COLUMN is_financial boolean;

    -- Um CPF identifica uma única pessoa na escola: evita aluno duplicado e permite reaproveitar o responsável.
    CREATE UNIQUE INDEX students_school_cpf ON public.students(school_id, cpf) WHERE cpf IS NOT NULL;
    CREATE UNIQUE INDEX guardians_school_cpf ON public.guardians(school_id, cpf) WHERE cpf IS NOT NULL;
  `);
};

exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
