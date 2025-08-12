import { Router, Request, Response } from "express";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  return res.json({ status: "ok", time: new Date().toISOString() });
});

export default router;
