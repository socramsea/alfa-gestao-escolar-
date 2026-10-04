import test from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:4000";

async function login(email) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password: process.env.ADMIN_PASSWORD
    })
  });

  assert.equal(response.status, 200, `Login falhou para ${email}`);

  const body = await response.json();

  assert.ok(body.token);
  assert.ok(body.user?.school_id);

  return body;
}

async function listUsers(token) {
  const response = await fetch(`${BASE_URL}/api/users`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  assert.equal(response.status, 200);

  return response.json();
}

test("Alfa e Escola B possuem tenants diferentes", async () => {
  const alfa = await login("admin@alfareis.test");
  const beta = await login("admin@escola-b.test");

  assert.notEqual(
    alfa.user.school_id,
    beta.user.school_id
  );
});

test("tenant Alfa só recebe usuários da própria escola", async () => {
  const alfa = await login("admin@alfareis.test");
  const body = await listUsers(alfa.token);

  assert.ok(body.users.length > 0);

  for (const user of body.users) {
    assert.equal(user.school_id, alfa.user.school_id);
  }

  assert.equal(
    body.users.some(
      (user) => user.email === "admin@escola-b.test"
    ),
    false
  );
});

test("tenant B só recebe usuários da própria escola", async () => {
  const beta = await login("admin@escola-b.test");
  const body = await listUsers(beta.token);

  assert.ok(body.users.length > 0);

  for (const user of body.users) {
    assert.equal(user.school_id, beta.user.school_id);
  }

  assert.equal(
    body.users.some(
      (user) => user.email === "admin@alfareis.test"
    ),
    false
  );
});

test("rota protegida rejeita requisição sem token", async () => {
  const response = await fetch(`${BASE_URL}/api/users`);

  assert.equal(response.status, 401);
});

test("rota protegida rejeita token adulterado", async () => {
  const alfa = await login("admin@alfareis.test");

  const parts = alfa.token.split(".");
  assert.equal(parts.length, 3);

  const signature = parts[2];
  const first = signature[0];
  const replacement = first === "a" ? "b" : "a";

  parts[2] = replacement + signature.slice(1);

  const tamperedToken = parts.join(".");

  const response = await fetch(`${BASE_URL}/api/users`, {
    headers: {
      Authorization: `Bearer ${tamperedToken}`
    }
  });

  assert.equal(response.status, 401);
});
