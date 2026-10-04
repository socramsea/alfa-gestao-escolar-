import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./modules/auth/auth.routes.js";
import schoolsRoutes from "./modules/schools/schools.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import structureRoutes from './modules/structure/structure.routes.js';
import peopleRoutes from './modules/people/people.routes.js';
import enrollmentsRoutes from './modules/enrollments/enrollments.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import { pool } from './config/db.js';

import { errorHandler } from "./middlewares/errorHandler.js";

dotenv.config();

const app = express();

app.disable("x-powered-by");
const origins = (process.env.CORS_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
if (origins.includes("*")) throw new Error("CORS_ORIGINS nao permite wildcard");
app.use(cors({
  origin: (origin, callback) => callback(null, !!origin && origins.includes(origin)),
  credentials: false
}));

app.use(express.json({ limit: "2mb" }));
app.use('/api', (_req,res,next) => { res.set('Cache-Control','no-store'); next(); });
app.get('/api/ready', async (_req,res) => {
  try { await pool.query({ text: 'SELECT 1', query_timeout: 2000 }); res.json({status:'ok'}); }
  catch { res.status(503).json({status:'unavailable'}); }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Alfa Gestão Escolar",
    environment: process.env.NODE_ENV || "development"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/schools", schoolsRoutes);
app.use("/api/users", usersRoutes);
app.use('/api/structure', structureRoutes);
app.use('/api/people', peopleRoutes);
app.use('/api/enrollments', enrollmentsRoutes);
app.use('/api/staff', staffRoutes);

app.use((req, res) => res.status(404).json({ error: "Rota nao encontrada" }));
app.use(errorHandler);

export default app;
