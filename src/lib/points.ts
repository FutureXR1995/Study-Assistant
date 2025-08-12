import fs from "node:fs";
import path from "node:path";

export interface PointsConfig {
  completeTaskPoints: number;
  milestones: number[]; // streak days
}

const defaults: PointsConfig = {
  completeTaskPoints: 10,
  milestones: [3, 7, 14]
};

export function getPointsConfig(): PointsConfig {
  try {
    const file = path.resolve("config/points.json");
    if (!fs.existsSync(file)) return defaults;
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw) as Partial<PointsConfig>;
    return {
      completeTaskPoints: Number(data.completeTaskPoints ?? defaults.completeTaskPoints),
      milestones: Array.isArray(data.milestones) ? data.milestones.map(Number) : defaults.milestones
    };
  } catch {
    return defaults;
  }
}


