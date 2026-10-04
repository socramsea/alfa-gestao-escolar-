import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { pool } from "../config/admin-db.js";

dotenv.config();

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed de desenvolvimento bloqueado em produção");
}

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;

const SCHOOL_NAME = "Escola Alfa Reis";
const SCHOOL_LEGAL_NAME = "Escola Alfa Reis LTDA";
const SCHOOL_EMAIL = "contato@alfareis.test";

if (!adminEmail || !adminPassword) {
  throw new Error("ADMIN_EMAIL e ADMIN_PASSWORD são obrigatórios");
}

if (adminPassword.length < 12) {
  throw new Error(
    "A senha do administrador deve ter pelo menos 12 caracteres"
  );
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

  if (schoolResult.rows.length > 0) {
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
        SCHOOL_LEGAL_NAME,
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
    [schoolId, adminEmail]
  );

  let userCreated = false;

  if (userResult.rows.length === 0) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);

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
        "Administrador Alfa",
        adminEmail,
        passwordHash,
        "platform_admin"
      ]
    );

    userCreated = true;
  }

  await client.query("COMMIT");

  console.log(
    schoolCreated
      ? "Escola de desenvolvimento criada:"
      : "Escola de desenvolvimento já existente:",
    schoolId
  );

  console.log(
    userCreated
      ? "Administrador criado:"
      : "Administrador já existente:",
    adminEmail
  );
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Erro ao executar seed:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
