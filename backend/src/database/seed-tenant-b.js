import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { pool } from "../config/admin-db.js";

dotenv.config();

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed de teste bloqueado em produção");
}

const password = process.env.ADMIN_PASSWORD;

const SCHOOL_NAME = "Escola B Teste";
const SCHOOL_EMAIL = "contato@escola-b.test";
const ADMIN_EMAIL = "admin@escola-b.test";

if (!password || password.length < 12) {
  throw new Error("ADMIN_PASSWORD deve possuir pelo menos 12 caracteres");
}

const client = await pool.connect();

try {
  await client.query("BEGIN");

  let schoolResult = await client.query(
    `
      SELECT id
      FROM schools
      WHERE lower(email) = lower($1)
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [SCHOOL_EMAIL]
  );

  let schoolId;
  let schoolCreated = false;

  if (schoolResult.rows.length) {
    schoolId = schoolResult.rows[0].id;
  } else {
    schoolResult = await client.query(
      `
        INSERT INTO schools (
          name,
          legal_name,
          email,
          status
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [
        SCHOOL_NAME,
        "Escola B Teste LTDA",
        SCHOOL_EMAIL,
        "trial"
      ]
    );

    schoolId = schoolResult.rows[0].id;
    schoolCreated = true;
  }

  const userResult = await client.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND lower(email) = lower($2)
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [schoolId, ADMIN_EMAIL]
  );

  let userCreated = false;

  if (!userResult.rows.length) {
    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `
        INSERT INTO users (
          school_id,
          name,
          email,
          password_hash,
          role
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        schoolId,
        "Administrador Escola B",
        ADMIN_EMAIL,
        passwordHash,
        "school_admin"
      ]
    );

    userCreated = true;
  }

  await client.query("COMMIT");

  console.log(
    schoolCreated ? "Escola B criada:" : "Escola B já existente:",
    schoolId
  );

  console.log(
    userCreated ? "Administrador B criado:" : "Administrador B já existente:",
    ADMIN_EMAIL
  );
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Erro no seed do tenant B:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
