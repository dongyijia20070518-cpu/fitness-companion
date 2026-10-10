export type SyncStatus = "saved" | "saving" | "offline" | "conflict";

export type Profile = {
  nickname: string;
  age: number;
  heightCm: number;
  startingWeightKg: number;
  experience: "beginner" | "regular" | "advanced";
  healthNotes: string;
  contraindications: string;
  goal: "fat_loss" | "recomp" | "strength" | "health";
  targetWeightKg: number | null;
  equipment: string[];
  updatedAt: number;
};

export type Exercise = {
  id: string;
  zh: string;
  en: string;
  body: "上肢" | "下肢" | "核心" | "全身" | "有氧";
  equipment: "徒手" | "哑铃" | "杠铃" | "绳索" | "固定器械" | "弹力带" | "有氧器械";
  kind: "复合" | "孤立" | "核心" | "有氧";
  priority: number;
  cue: string;
  caution: string;
  custom?: boolean;
  updatedAt?: number;
};

export type QueueItem = Exercise & { queueId: string; sets: number; reps: number };
export type WorkoutSet = {
  id: string;
  weightKg: number;
  reps: number;
  rir: number;
  quality: "待记录" | "稳定" | "勉强" | "需调整";
  completedAt: number | null;
};
export type SessionExercise = QueueItem & { sessionSets: WorkoutSet[] };
export type ActiveSession = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  exercises: SessionExercise[];
  rest: { active: boolean; endAt: number; durationSec: number } | null;
  updatedAt: number;
};
export type WeightLog = { id: string; date: string; value: number; updatedAt: number };
export type MealLog = { id: string; date: string; type: string; note: string; updatedAt: number };
export type WorkoutHistory = { id: string; date: string; durationSec: number; totalVolumeKg: number; exerciseCount: number; updatedAt: number };

export type AppState = {
  schemaVersion: 2;
  brandName: string;
  profile: Profile | null;
  weights: WeightLog[];
  meals: MealLog[];
  workoutHistory: WorkoutHistory[];
  customExercises: Exercise[];
  trainingQueue: QueueItem[];
  queueUpdatedAt: number;
  activeSession: ActiveSession | null;
  plan: { weeklyDays: number; sessionMinutes: number; note: string; updatedAt: number };
  readiness: { sleep: number; fatigue: number; soreness: number; updatedAt: number };
  notificationsEnabled: boolean;
  updatedAt: number;
};

export type StateEnvelope = { state: AppState; version: number; updatedAt: number };

export function emptyState(): AppState {
  const now = Date.now();
  return {
    schemaVersion: 2,
    brandName: "向好 · Wellward",
    profile: null,
    weights: [], meals: [], workoutHistory: [], customExercises: [], trainingQueue: [],
    queueUpdatedAt: now,
    activeSession: null,
    plan: { weeklyDays: 3, sessionMinutes: 45, note: "", updatedAt: now },
    readiness: { sleep: 3, fatigue: 2, soreness: 1, updatedAt: now },
    notificationsEnabled: false,
    updatedAt: now,
  };
}
