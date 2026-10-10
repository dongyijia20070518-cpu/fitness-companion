"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bell,
  Check,
  ChevronRight,
  Cloud,
  CloudOff,
  Dumbbell,
  GripVertical,
  HeartPulse,
  Home,
  Library,
  ListChecks,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  UserRound,
  Utensils,
  X,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BODY_FILTERS,
  EQUIPMENT_FILTERS,
  EXERCISES,
} from "../../lib/exercises";
import {
  emptyState,
  type AppState,
  type Exercise,
  type Profile,
  type QueueItem,
  type StateEnvelope,
  type SyncStatus,
} from "../../lib/types";

type Tab = "today" | "plan" | "workout" | "lab" | "me";
type User = { email: string; displayName: string };

const TABS: { id: Tab; zh: string; en: string; icon: typeof Home }[] = [
  { id: "today", zh: "今日", en: "Today", icon: Home },
  { id: "plan", zh: "计划", en: "Plan", icon: ListChecks },
  { id: "workout", zh: "训练", en: "Workout", icon: Dumbbell },
  { id: "lab", zh: "实验室", en: "Lab", icon: BarChart3 },
  { id: "me", zh: "我的", en: "Me", icon: UserRound },
];
const PRODUCT_NAME = "向好 · Wellward";
const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const todayKey = (at = Date.now()) => new Date(at).toLocaleDateString("en-CA");
const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
const elapsedSeconds = (startedAt: number, now: number) =>
  Math.max(0, Math.floor((now - startedAt) / 1000));

function mergeById<T extends { id: string; updatedAt: number }>(
  a: T[],
  b: T[],
): T[] {
  const map = new Map<string, T>();
  [...a, ...b].forEach((item) => {
    const previous = map.get(item.id);
    if (!previous || item.updatedAt >= previous.updatedAt)
      map.set(item.id, item);
  });
  return [...map.values()];
}

function mergeStates(local: AppState, remote: AppState): AppState {
  const newer = local.updatedAt >= remote.updatedAt ? local : remote;
  const profile = !local.profile
    ? remote.profile
    : !remote.profile
      ? local.profile
      : local.profile.updatedAt >= remote.profile.updatedAt
        ? local.profile
        : remote.profile;
  const queueOwner =
    local.queueUpdatedAt >= remote.queueUpdatedAt ? local : remote;
  const active = !local.activeSession
    ? remote.activeSession
    : !remote.activeSession
      ? local.activeSession
      : local.activeSession.updatedAt >= remote.activeSession.updatedAt
        ? local.activeSession
        : remote.activeSession;
  return {
    ...newer,
    profile,
    weights: mergeById(local.weights, remote.weights),
    meals: mergeById(local.meals, remote.meals),
    workoutHistory: mergeById(local.workoutHistory, remote.workoutHistory),
    customExercises: mergeById(
      local.customExercises.map((x) => ({ ...x, updatedAt: x.updatedAt ?? 0 })),
      remote.customExercises.map((x) => ({
        ...x,
        updatedAt: x.updatedAt ?? 0,
      })),
    ),
    trainingQueue: queueOwner.trainingQueue,
    queueUpdatedAt: queueOwner.queueUpdatedAt,
    activeSession: active,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}

function SectionHead({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {aside}
    </div>
  );
}

function SyncPill({
  status,
  version,
}: {
  status: SyncStatus;
  version: number;
}) {
  const meta =
    status === "saved"
      ? [Cloud, "已同步"]
      : status === "saving"
        ? [RefreshCw, "同步中"]
        : status === "conflict"
          ? [RefreshCw, "正在合并"]
          : [CloudOff, "离线保存"];
  const Icon = meta[0] as typeof Cloud;
  return (
    <span className={`sync-pill ${status}`} title={`云端版本 ${version}`}>
      <Icon
        size={14}
        className={status === "saving" || status === "conflict" ? "spin" : ""}
      />
      {meta[1] as string}
    </span>
  );
}

export default function AppShell({
  user,
  initial,
  signOutUrl,
}: {
  user: User;
  initial: StateEnvelope;
  signOutUrl: string;
}) {
  const cacheKey = `mellow-fit-v2:${user.email.toLowerCase()}`;
  const [state, setState] = useState<AppState>(initial.state);
  const [tab, setTab] = useState<Tab>("today");
  const [sync, setSync] = useState<SyncStatus>("saved");
  const [version, setVersion] = useState(initial.version);
  const [now, setNow] = useState(initial.updatedAt || initial.state.updatedAt);
  const stateRef = useRef(state);
  const versionRef = useRef(initial.version);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const saveTimerRef = useRef<number | null>(null);
  const notifiedRestRef = useRef<number>(0);

  const scheduleFlush = useCallback((delay = 550) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(
      () => void flushRef.current(),
      delay,
    );
  }, []);

  const persist = useCallback(
    (next: AppState, immediate = false) => {
      const stamped = { ...next, updatedAt: Date.now() };
      stateRef.current = stamped;
      setState(stamped);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(stamped));
      } catch {
        /* cache is best effort */
      }
      dirtyRef.current = true;
      setSync(navigator.onLine ? "saving" : "offline");
      scheduleFlush(immediate ? 0 : 550);
    },
    [cacheKey, scheduleFlush],
  );

  const update = useCallback(
    (recipe: (current: AppState) => AppState, immediate = false) =>
      persist(recipe(stateRef.current), immediate),
    [persist],
  );

  const flush = useCallback(async () => {
    if (inFlightRef.current || !dirtyRef.current || !navigator.onLine) return;
    inFlightRef.current = true;
    dirtyRef.current = false;
    const sent = stateRef.current;
    const baseVersion = versionRef.current;
    setSync("saving");
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: sent, baseVersion }),
      });
      if (response.status === 409) {
        const conflict = (await response.json()) as StateEnvelope;
        versionRef.current = conflict.version;
        setVersion(conflict.version);
        const merged = mergeStates(stateRef.current, conflict.state);
        stateRef.current = merged;
        setState(merged);
        localStorage.setItem(cacheKey, JSON.stringify(merged));
        dirtyRef.current = true;
        setSync("conflict");
      } else if (!response.ok) {
        throw new Error(`sync ${response.status}`);
      } else {
        const saved = (await response.json()) as { version: number };
        versionRef.current = saved.version;
        setVersion(saved.version);
        if (stateRef.current.updatedAt > sent.updatedAt)
          dirtyRef.current = true;
        setSync(dirtyRef.current ? "saving" : "saved");
      }
    } catch {
      dirtyRef.current = true;
      setSync("offline");
    } finally {
      inFlightRef.current = false;
      if (dirtyRef.current && navigator.onLine) scheduleFlush(700);
    }
  }, [cacheKey, scheduleFlush]);
  flushRef.current = flush;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const local = JSON.parse(cached) as AppState;
        if (
          local.schemaVersion === 2 &&
          local.updatedAt > initial.state.updatedAt
        ) {
          const merged = mergeStates(local, initial.state);
          stateRef.current = merged;
          setState(merged);
          dirtyRef.current = true;
          scheduleFlush(0);
        }
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }
    const online = () => {
      setSync("saving");
      void flushRef.current();
    };
    const offline = () => setSync("offline");
    const visibility = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [cacheKey, initial.state, scheduleFlush]);

  useEffect(() => {
    const rest = state.activeSession?.rest;
    if (
      !rest?.active ||
      rest.endAt > now ||
      notifiedRestRef.current === rest.endAt
    )
      return;
    notifiedRestRef.current = rest.endAt;
    if (
      state.notificationsEnabled &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      new Notification("组间休息结束", {
        body: "准备好后开始下一组，保持动作质量。",
      });
    }
  }, [now, state.activeSession?.rest, state.notificationsEnabled]);

  useEffect(() => {
    if (stateRef.current.brandName !== PRODUCT_NAME) {
      update((current) => ({ ...current, brandName: PRODUCT_NAME }), true);
    }
  }, [update]);

  if (!state.profile)
    return (
      <Onboarding
        user={user}
        onComplete={(profile) => update((s) => ({ ...s, profile }), true)}
      />
    );

  const content =
    tab === "today" ? (
      <TodayRich
        state={state}
        update={update}
        goWorkout={() => setTab("workout")}
        goLab={() => setTab("lab")}
        now={now}
      />
    ) : tab === "plan" ? (
      <Plan state={state} update={update} />
    ) : tab === "workout" ? (
      <Workout state={state} update={update} now={now} />
    ) : tab === "lab" ? (
      <Lab state={state} />
    ) : (
      <Me
        state={state}
        update={update}
        user={user}
        signOutUrl={signOutUrl}
        sync={sync}
        version={version}
        cacheKey={cacheKey}
        onReset={() => {
          const fresh = emptyState();
          stateRef.current = fresh;
          versionRef.current = 0;
          setVersion(0);
          setState(fresh);
        }}
      />
    );

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-mark">
          <span className="brand-sprout">✦</span>
          <div>
            <strong>向好</strong>
            <small>Wellward</small>
          </div>
        </div>
        <nav aria-label="主导航">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                <Icon size={20} />
                <span>
                  {item.zh}
                  <small>{item.en}</small>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="side-foot">
          <SyncPill status={sync} version={version} />
          <span>{state.profile.nickname}</span>
        </div>
      </aside>
      <main className="main-canvas">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {TABS.find((x) => x.id === tab)?.en}
            </span>
            <h1>{TABS.find((x) => x.id === tab)?.zh}</h1>
          </div>
          <div className="top-actions">
            <SyncPill status={sync} version={version} />
            <button
              className="avatar"
              onClick={() => setTab("me")}
              aria-label="打开个人设置"
            >
              {state.profile.nickname.slice(0, 1)}
            </button>
          </div>
        </header>
        <div className="page-content">{content}</div>
      </main>
      <aside className="right-rail">
        <span className="eyebrow">LIVE SUMMARY</span>
        <h3>今天，慢慢来</h3>
        <div className="rail-stat">
          <span>训练计时</span>
          <strong>
            {state.activeSession
              ? formatClock(elapsedSeconds(state.activeSession.startedAt, now))
              : "未开始"}
          </strong>
        </div>
        <div className="rail-stat">
          <span>今日体重</span>
          <strong>
            {state.weights.find((x) => x.date === todayKey())?.value
              ? `${state.weights.find((x) => x.date === todayKey())?.value} kg`
              : "待记录"}
          </strong>
        </div>
        <div className="rail-note">
          <Sparkles size={18} />
          <p>系统只依据你的记录生成规则提示，不替代医生、营养师或教练。</p>
        </div>
      </aside>
      <nav className="bottom-nav" aria-label="移动端主导航">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              <Icon size={21} />
              <span>{item.en}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Onboarding({
  user,
  onComplete,
}: {
  user: User;
  onComplete: (profile: Profile) => void;
}) {
  const [step, setStep] = useState<"account" | "hello" | "profile">("account");
  const [nickname, setNickname] = useState("");
  const [form, setForm] = useState({
    age: "",
    height: "",
    weight: "",
    target: "",
    experience: "beginner",
    goal: "fat_loss",
    health: "",
    contraindications: "",
    equipment: ["徒手", "哑铃"],
  });
  const continueAccount = () => {
    if (!nickname.trim()) return;
    setStep("hello");
    window.setTimeout(() => setStep("profile"), 1250);
  };
  if (step === "hello")
    return (
      <div className="welcome-screen">
        <div className="welcome-orbit">✦</div>
        <span className="eyebrow">WELCOME</span>
        <h1>你好，{nickname.trim()}</h1>
        <p>我们先认识你的身体，再开始今天。</p>
      </div>
    );
  if (step === "account")
    return (
      <div className="onboarding-wrap">
        <Card className="onboarding-card">
          <div className="onboarding-visual">
            <span>✦</span>
            <h1>先建立你的真实账号档案</h1>
            <p>跨设备同步，从一个清楚的名字开始。</p>
          </div>
          <div className="onboarding-form">
            <span className="eyebrow">SECURE ACCOUNT</span>
            <h2>欢迎来到向好</h2>
            <p className="muted">
              账户由 ChatGPT 安全登录管理，本应用不会保存或接触你的密码。
            </p>
            <label>
              登录邮箱
              <input value={user.email} readOnly />
            </label>
            <label>
              昵称
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="例如：易嘉"
                autoFocus
              />
            </label>
            <button
              className="primary wide"
              onClick={continueAccount}
              disabled={!nickname.trim()}
            >
              创建我的档案 <ChevronRight size={18} />
            </button>
            <small className="privacy-note">
              同一 ChatGPT 账号可在 iPhone、iPad 与 Mac
              访问同一份数据；不同账号的数据严格分开。
            </small>
          </div>
        </Card>
      </div>
    );
  const equipmentOptions = [
    "徒手",
    "哑铃",
    "杠铃",
    "绳索",
    "固定器械",
    "弹力带",
    "跑步机",
  ];
  const valid =
    Number(form.age) >= 14 &&
    Number(form.height) > 100 &&
    Number(form.weight) > 25;
  return (
    <div className="onboarding-wrap">
      <Card className="profile-onboarding">
        <SectionHead
          eyebrow="FIRST PROFILE"
          title="建立个人档案"
          aside={<span className="step-pill">2 / 2</span>}
        />
        <p className="muted">
          这些数据只属于当前账号。疾病或运动禁忌会显示安全提醒，不用于自动诊断。
        </p>
        <div className="form-grid">
          <label>
            年龄
            <input
              type="number"
              inputMode="numeric"
              value={form.age}
              onChange={(e) => setForm({ ...form, age: e.target.value })}
              placeholder="岁"
            />
          </label>
          <label>
            身高
            <input
              type="number"
              inputMode="decimal"
              value={form.height}
              onChange={(e) => setForm({ ...form, height: e.target.value })}
              placeholder="cm"
            />
          </label>
          <label>
            当前体重
            <input
              type="number"
              inputMode="decimal"
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
              placeholder="kg"
            />
          </label>
          <label>
            目标体重（可选）
            <input
              type="number"
              inputMode="decimal"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder="kg"
            />
          </label>
          <label>
            运动基础
            <select
              value={form.experience}
              onChange={(e) => setForm({ ...form, experience: e.target.value })}
            >
              <option value="beginner">刚开始 / Beginner</option>
              <option value="regular">规律训练 / Regular</option>
              <option value="advanced">进阶训练 / Advanced</option>
            </select>
          </label>
          <label>
            个人目标
            <select
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
            >
              <option value="fat_loss">减脂 / Fat loss</option>
              <option value="recomp">塑形 / Recomposition</option>
              <option value="strength">力量 / Strength</option>
              <option value="health">健康习惯 / Wellbeing</option>
            </select>
          </label>
        </div>
        <label>
          疾病与健康情况
          <textarea
            value={form.health}
            onChange={(e) => setForm({ ...form, health: e.target.value })}
            placeholder="如无请填“无”；如有心血管、代谢、孕产或其他情况，请先向专业人员确认训练建议。"
          />
        </label>
        <label>
          运动禁忌或既往伤痛
          <textarea
            value={form.contraindications}
            onChange={(e) =>
              setForm({ ...form, contraindications: e.target.value })
            }
            placeholder="例如：右膝屈曲时疼痛；如无请填“无”"
          />
        </label>
        <fieldset>
          <legend>可用器械</legend>
          <div className="chip-row">
            {equipmentOptions.map((item) => (
              <button
                type="button"
                key={item}
                className={
                  form.equipment.includes(item) ? "chip selected" : "chip"
                }
                onClick={() =>
                  setForm({
                    ...form,
                    equipment: form.equipment.includes(item)
                      ? form.equipment.filter((x) => x !== item)
                      : [...form.equipment, item],
                  })
                }
              >
                {item}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="safety-box">
          <HeartPulse size={19} />
          <span>
            若运动中出现胸痛、明显气短、晕厥感或异常心悸，请立即停止并寻求医疗帮助。
          </span>
        </div>
        <button
          className="primary wide"
          disabled={!valid}
          onClick={() =>
            onComplete({
              nickname: nickname.trim(),
              age: Number(form.age),
              heightCm: Number(form.height),
              startingWeightKg: Number(form.weight),
              targetWeightKg: form.target ? Number(form.target) : null,
              experience: form.experience as Profile["experience"],
              goal: form.goal as Profile["goal"],
              healthNotes: form.health.trim() || "无",
              contraindications: form.contraindications.trim() || "无",
              equipment: form.equipment,
              updatedAt: Date.now(),
            })
          }
        >
          完成建档，进入空白首页
        </button>
      </Card>
    </div>
  );
}

function TodayRich({
  state,
  update,
  goWorkout,
  goLab,
  now,
}: {
  state: AppState;
  update: (r: (s: AppState) => AppState, immediate?: boolean) => void;
  goWorkout: () => void;
  goLab: () => void;
  now: number;
}) {
  const [weight, setWeight] = useState("");
  const [mealType, setMealType] = useState("早餐");
  const [mealNote, setMealNote] = useState("");
  const today = todayKey(now);
  const todayWeight = state.weights.find((entry) => entry.date === today);
  const sortedWeights = [...state.weights].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const latestWeight =
    todayWeight ?? sortedWeights.filter((entry) => entry.date <= today).at(-1);
  const previousWeight = latestWeight
    ? sortedWeights.filter((entry) => entry.date < latestWeight.date).at(-1)
    : undefined;
  const weightDelta =
    latestWeight && previousWeight
      ? latestWeight.value - previousWeight.value
      : null;
  const bmi =
    latestWeight && state.profile
      ? latestWeight.value / Math.pow(state.profile.heightCm / 100, 2)
      : null;
  const todayMeals = state.meals.filter((entry) => entry.date === today);
  const mealTypes = [
    { type: "早餐", en: "Breakfast", emoji: "☀️" },
    { type: "午餐", en: "Lunch", emoji: "🥗" },
    { type: "晚餐", en: "Dinner", emoji: "🌙" },
    { type: "零食", en: "Snack", emoji: "🍊" },
  ];
  const readinessScore =
    state.readiness.sleep * 2 -
    state.readiness.fatigue -
    state.readiness.soreness;
  const plan =
    readinessScore <= 0
      ? {
          tone: "recover",
          title: "恢复优先 · 轻松活动",
          en: "Recovery first",
          type: "恢复日",
          duration: "15–25 分钟",
          items: ["轻松步行", "呼吸与舒缓活动"],
          reason:
            "今天的睡眠、疲劳与酸痛记录提示恢复优先。若存在锐痛、胸部不适、头晕或异常气短，请停止运动。",
        }
      : readinessScore <= 3
        ? {
            tone: "light",
            title: "精简力量 + 轻有氧",
            en: "Light strength session",
            type: "精简训练",
            duration: `约 ${Math.min(35, state.plan.sessionMinutes)} 分钟`,
            items: ["3–4 个熟悉动作", "每项 2 组 · RIR 3+"],
            reason:
              "身体状态适合保持节奏，但不适合追求训练量。先完成熟悉动作，再决定是否增加轻有氧。",
          }
        : {
            tone: "normal",
            title: "全身力量 + 稳态有氧",
            en: "Full body + steady cardio",
            type: "标准训练",
            duration: `约 ${state.plan.sessionMinutes} 分钟`,
            items: ["复合动作优先", "目标 RIR 2–3"],
            reason:
              "晨间恢复状态允许按本周计划训练。优先完成需要精力与稳定性的复合动作，再安排孤立动作和有氧。",
          };
  const dateRail = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + index - 3);
    const key = todayKey(date.getTime());
    return {
      key,
      day: date.getDate(),
      week: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date),
      isToday: key === today,
      value: state.weights.find((entry) => entry.date === key)?.value,
    };
  });
  const sleepLabels = ["很差", "偏少", "一般", "不错", "很好"];
  const completedSets =
    state.activeSession?.exercises
      .flatMap((exercise) => exercise.sessionSets)
      .filter((set) => set.completedAt).length ?? 0;
  const finishedWorkout = state.workoutHistory.find(
    (entry) => entry.date === today,
  );

  const saveWeight = () => {
    const value = Number(weight);
    if (value < 25 || value > 350) return;
    update(
      (current) => ({
        ...current,
        weights: [
          ...current.weights.filter((entry) => entry.date !== today),
          { id: today, date: today, value, updatedAt: Date.now() },
        ],
      }),
      true,
    );
    setWeight("");
  };

  const addMeal = () => {
    if (!mealNote.trim()) return;
    update((current) => ({
      ...current,
      meals: [
        ...current.meals,
        {
          id: uid(),
          date: today,
          type: mealType,
          note: mealNote.trim(),
          updatedAt: Date.now(),
        },
      ],
    }));
    setMealNote("");
  };

  return (
    <div className="stack today-stack">
      <header className="today-title-row">
        <div>
          <span className="eyebrow">
            {new Intl.DateTimeFormat("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date(now))}
          </span>
          <h2>{state.profile?.nickname}，早上好</h2>
          <p>先看看身体，再决定今天怎样向好一点。</p>
        </div>
        <span className="today-soft-badge">今日 · Today</span>
      </header>

      <div className="today-dashboard">
        <Card className="today-weight-hero">
          <div className="today-date-rail" aria-label="近期体重日期">
            {dateRail.map((date) => (
              <div
                className={date.isToday ? "date-dot active" : "date-dot"}
                key={date.key}
              >
                <span>{date.isToday ? "今天" : date.week}</span>
                <strong>{date.day}</strong>
                <small>{date.value ? date.value.toFixed(1) : "·"}</small>
              </div>
            ))}
          </div>
          <div className="today-weight-copy">
            <span className="eyebrow">今日体重 · TODAY&apos;S WEIGHT</span>
            <div className="today-weight-number">
              {todayWeight ? todayWeight.value.toFixed(1) : "—"}
              <small>kg</small>
            </div>
            <p>
              {todayWeight && weightDelta !== null
                ? `较上次 ${weightDelta > 0 ? "+" : ""}${weightDelta.toFixed(1)} kg · 单日波动不等于脂肪变化`
                : "记录今天的第一条真实数据，趋势会从这里开始。"}
            </p>
          </div>
          <div className="today-status-pills">
            <span>BMI {bmi ? bmi.toFixed(1) : "—"}</span>
            <span>睡眠 {sleepLabels[state.readiness.sleep - 1]}</span>
            <span>疲劳 {state.readiness.fatigue}/5</span>
          </div>
          <div className="today-orange" aria-label="向好小橙子">
            🍊
          </div>
          <div className="today-weight-entry">
            <input
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              inputMode="decimal"
              placeholder={todayWeight ? "更新今日体重 kg" : "输入今日体重 kg"}
            />
            <button onClick={saveWeight}>保存</button>
          </div>
        </Card>

        <Card className={`today-prescription ${plan.tone}`}>
          <SectionHead
            eyebrow="DAILY PRESCRIPTION"
            title="今日可执行计划"
            aside={<span className="step-pill">{plan.type}</span>}
          />
          <div className="prescription-title">
            <h3>{plan.title}</h3>
            <span>{plan.en}</span>
          </div>
          <div className="prescription-feature">
            <div className="prescription-duration">
              <strong>{plan.duration}</strong>
              <small>Estimated duration</small>
            </div>
            <button className="primary" onClick={goWorkout}>
              开始训练 <ChevronRight size={17} />
            </button>
          </div>
          <div className="prescription-items">
            {plan.items.map((item, index) => (
              <div key={item}>
                <strong>{index === 0 ? "A" : "B"}</strong>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="prescription-reason">
            <strong>为什么这样安排？</strong>
            <p>{plan.reason}</p>
          </div>
          <small className="rule-note">
            透明规则，不是医学
            AI：根据晨间自报、计划与已记录训练生成，可随时调整。
          </small>
        </Card>

        <Card className="today-checkin-card">
          <SectionHead
            eyebrow="MORNING CHECK-IN"
            title="晨间状态"
            aside={
              <span className="weather-sticker">
                {readinessScore <= 0 ? "🌧️" : "🌤️"}
              </span>
            }
          />
          <ScoreRow
            label="睡眠恢复"
            value={state.readiness.sleep}
            onChange={(value) =>
              update((current) => ({
                ...current,
                readiness: {
                  ...current.readiness,
                  sleep: value,
                  updatedAt: Date.now(),
                },
              }))
            }
          />
          <ScoreRow
            label="疲劳程度"
            value={state.readiness.fatigue}
            onChange={(value) =>
              update((current) => ({
                ...current,
                readiness: {
                  ...current.readiness,
                  fatigue: value,
                  updatedAt: Date.now(),
                },
              }))
            }
          />
          <ScoreRow
            label="肌肉酸痛"
            value={state.readiness.soreness}
            onChange={(value) =>
              update((current) => ({
                ...current,
                readiness: {
                  ...current.readiness,
                  soreness: value,
                  updatedAt: Date.now(),
                },
              }))
            }
          />
          <div className="today-safety-line">
            <HeartPulse size={17} />
            <span>胸闷、头晕、锐痛、关节痛或异常气短时，请停止训练。</span>
          </div>
        </Card>

        <Card className="today-meal-card">
          <SectionHead
            eyebrow="MEALS & SNACKS"
            title="今天吃了什么？"
            aside={<Utensils size={19} />}
          />
          <div className="today-meal-grid">
            {mealTypes.map((meal) => {
              const entry = [...todayMeals]
                .reverse()
                .find((item) => item.type === meal.type);
              return (
                <button
                  className={entry ? "meal-tile done" : "meal-tile"}
                  key={meal.type}
                  onClick={() => setMealType(meal.type)}
                >
                  <span className="meal-emoji">{meal.emoji}</span>
                  <span className="meal-check">{entry ? "✓" : "+"}</span>
                  <strong>{meal.type}</strong>
                  <small>{entry ? entry.note : meal.en}</small>
                </button>
              );
            })}
          </div>
          <div className="meal-form today-meal-form">
            <select
              value={mealType}
              onChange={(event) => setMealType(event.target.value)}
            >
              {mealTypes.map((meal) => (
                <option key={meal.type}>{meal.type}</option>
              ))}
            </select>
            <input
              value={mealNote}
              onChange={(event) => setMealNote(event.target.value)}
              placeholder={`记录${mealType}，例如：燕麦、鸡蛋、牛奶`}
            />
            <button onClick={addMeal}>
              <Plus size={17} /> 添加
            </button>
          </div>
        </Card>

        <Card className="today-review-card">
          <div className="review-bubble">🫧</div>
          <span className="eyebrow">DAILY REVIEW</span>
          <h2>晚间复盘</h2>
          <p>
            {finishedWorkout
              ? `今天完成了 ${finishedWorkout.exerciseCount} 个动作，共 ${Math.round(finishedWorkout.durationSec / 60)} 分钟。`
              : completedSets
                ? `训练进行中，已经完成 ${completedSets} 组。`
                : "系统会使用今天已有记录生成简短复盘，不重复问你填过的问题。"}
          </p>
          <div className="review-progress">
            <span>{todayWeight ? "✓" : "○"} 体重</span>
            <span>
              {todayMeals.length ? "✓" : "○"} 饮食{" "}
              {Math.min(4, new Set(todayMeals.map((item) => item.type)).size)}/4
            </span>
            <span>{finishedWorkout || completedSets ? "✓" : "○"} 训练</span>
          </div>
          <button className="secondary wide" onClick={goLab}>
            查看今日与趋势
          </button>
        </Card>
      </div>
    </div>
  );
}

function Today({
  state,
  update,
  goWorkout,
  now,
}: {
  state: AppState;
  update: (r: (s: AppState) => AppState, immediate?: boolean) => void;
  goWorkout: () => void;
  now: number;
}) {
  const [weight, setWeight] = useState("");
  const [mealType, setMealType] = useState("早餐");
  const [mealNote, setMealNote] = useState("");
  const today = todayKey(now);
  const todayWeight = state.weights.find((x) => x.date === today);
  const todayMeals = state.meals.filter((x) => x.date === today);
  const readinessScore =
    state.readiness.sleep * 2 -
    state.readiness.fatigue -
    state.readiness.soreness;
  const plan =
    readinessScore <= 0
      ? {
          title: "恢复优先",
          en: "Recovery first",
          detail:
            "建议 15–25 分钟轻松步行与舒缓活动；若有异常不适，今天不训练。",
        }
      : readinessScore <= 3
        ? {
            title: "精简训练",
            en: "Light session",
            detail: "选择 3–4 个动作，每个 2 组，保留 3 次以上余力。",
          }
        : {
            title: "标准训练",
            en: "Standard session",
            detail: `按计划完成约 ${state.plan.sessionMinutes} 分钟，复合动作优先，并保留 2–3 次余力。`,
          };
  const saveWeight = () => {
    const value = Number(weight);
    if (value < 25 || value > 350) return;
    update(
      (s) => ({
        ...s,
        weights: [
          ...s.weights.filter((x) => x.date !== today),
          { id: today, date: today, value, updatedAt: Date.now() },
        ],
      }),
      true,
    );
    setWeight("");
  };
  const addMeal = () => {
    if (!mealNote.trim()) return;
    update((s) => ({
      ...s,
      meals: [
        ...s.meals,
        {
          id: uid(),
          date: today,
          type: mealType,
          note: mealNote.trim(),
          updatedAt: Date.now(),
        },
      ],
    }));
    setMealNote("");
  };
  return (
    <div className="stack">
      <div className="hero greeting">
        <div>
          <span className="eyebrow">
            {new Intl.DateTimeFormat("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date())}
          </span>
          <h2>早上好，{state.profile?.nickname}</h2>
          <p>今天的数据从零开始，只记录你真正完成的事情。</p>
        </div>
        <div className="mascot">
          ◡̈<small>稳稳来</small>
        </div>
      </div>
      <div className="dashboard-grid">
        <Card className="weight-card">
          <SectionHead
            eyebrow="MORNING WEIGHT"
            title="晨间体重"
            aside={<Activity size={20} />}
          />
          {todayWeight ? (
            <div className="big-number">
              {todayWeight.value}
              <span>kg</span>
            </div>
          ) : (
            <div className="empty-mini">
              <strong>今天还没有记录</strong>
              <p>建议在相近条件下记录，关注长期趋势。</p>
            </div>
          )}
          <div className="inline-form">
            <input
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              inputMode="decimal"
              placeholder={todayWeight ? "更新体重 kg" : "输入真实体重 kg"}
            />
            <button onClick={saveWeight}>保存</button>
          </div>
        </Card>
        <Card>
          <SectionHead eyebrow="READINESS" title="今日状态" />
          <ScoreRow
            label="睡眠恢复"
            value={state.readiness.sleep}
            inverse={false}
            onChange={(value) =>
              update((s) => ({
                ...s,
                readiness: {
                  ...s.readiness,
                  sleep: value,
                  updatedAt: Date.now(),
                },
              }))
            }
          />
          <ScoreRow
            label="疲劳程度"
            value={state.readiness.fatigue}
            inverse
            onChange={(value) =>
              update((s) => ({
                ...s,
                readiness: {
                  ...s.readiness,
                  fatigue: value,
                  updatedAt: Date.now(),
                },
              }))
            }
          />
          <ScoreRow
            label="肌肉酸痛"
            value={state.readiness.soreness}
            inverse
            onChange={(value) =>
              update((s) => ({
                ...s,
                readiness: {
                  ...s.readiness,
                  soreness: value,
                  updatedAt: Date.now(),
                },
              }))
            }
          />
        </Card>
      </div>
      <Card className="plan-hero">
        <div>
          <span className="eyebrow">RULE-BASED DAILY PLAN</span>
          <h2>
            {plan.title}
            <small>{plan.en}</small>
          </h2>
          <p>{plan.detail}</p>
          <small className="muted">
            由睡眠、疲劳和酸痛的简单规则生成，不是医学 AI 或诊断。
          </small>
        </div>
        <button className="primary" onClick={goWorkout}>
          去训练 <ChevronRight size={17} />
        </button>
      </Card>
      <Card>
        <SectionHead
          eyebrow="MEAL LOG"
          title="饮食记录"
          aside={<Utensils size={20} />}
        />
        {todayMeals.length === 0 ? (
          <div className="empty-row">
            还没有饮食记录。写下真实吃了什么，不计算虚构热量。
          </div>
        ) : (
          <div className="meal-list">
            {todayMeals.map((m) => (
              <div key={m.id}>
                <span>{m.type}</span>
                <p>{m.note}</p>
                <button
                  onClick={() =>
                    update((s) => ({
                      ...s,
                      meals: s.meals.filter((x) => x.id !== m.id),
                    }))
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="meal-form">
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
          >
            <option>早餐</option>
            <option>午餐</option>
            <option>晚餐</option>
            <option>零食</option>
          </select>
          <input
            value={mealNote}
            onChange={(e) => setMealNote(e.target.value)}
            placeholder="例如：燕麦、鸡蛋、牛奶"
          />
          <button onClick={addMeal}>
            <Plus size={17} /> 添加
          </button>
        </div>
      </Card>
    </div>
  );
}

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  inverse?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="score-row">
      <span>{label}</span>
      <div>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            aria-label={`${label} ${n}分`}
            key={n}
            className={n <= value ? "filled" : ""}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function Plan({
  state,
  update,
}: {
  state: AppState;
  update: (r: (s: AppState) => AppState) => void;
}) {
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const trainingDays = new Set(
    days
      .filter(
        (_, i) => i % Math.max(1, Math.floor(7 / state.plan.weeklyDays)) === 0,
      )
      .slice(0, state.plan.weeklyDays),
  );
  return (
    <div className="stack">
      <div className="hero plan-title">
        <div>
          <span className="eyebrow">LONG → PHASE → WEEK</span>
          <h2>把大目标拆成能执行的一周</h2>
          <p>计划是起点，不是命令；身体状态和安全筛查优先。</p>
        </div>
        <span className="sticker">
          PLAN
          <br />
          GENTLY
        </span>
      </div>
      <div className="dashboard-grid">
        <Card>
          <SectionHead eyebrow="LONG-TERM GOAL" title="长期目标" />
          <label>
            目标类型
            <select
              value={state.profile?.goal}
              onChange={(e) =>
                update((s) => ({
                  ...s,
                  profile: s.profile
                    ? {
                        ...s.profile,
                        goal: e.target.value as Profile["goal"],
                        updatedAt: Date.now(),
                      }
                    : null,
                }))
              }
            >
              <option value="fat_loss">减脂</option>
              <option value="recomp">塑形</option>
              <option value="strength">力量</option>
              <option value="health">健康习惯</option>
            </select>
          </label>
          <label>
            目标备注
            <textarea
              value={state.plan.note}
              onChange={(e) =>
                update((s) => ({
                  ...s,
                  plan: {
                    ...s.plan,
                    note: e.target.value,
                    updatedAt: Date.now(),
                  },
                }))
              }
              placeholder="写下你真正想达到的状态"
            />
          </label>
        </Card>
        <Card>
          <SectionHead eyebrow="CURRENT PHASE" title="当前阶段" />
          <div className="form-grid compact">
            <label>
              每周训练天数
              <input
                type="number"
                min="1"
                max="6"
                value={state.plan.weeklyDays}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    plan: {
                      ...s.plan,
                      weeklyDays: Math.max(
                        1,
                        Math.min(6, Number(e.target.value)),
                      ),
                      updatedAt: Date.now(),
                    },
                  }))
                }
              />
            </label>
            <label>
              单次可用时间
              <input
                type="number"
                min="15"
                max="120"
                value={state.plan.sessionMinutes}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    plan: {
                      ...s.plan,
                      sessionMinutes: Math.max(
                        15,
                        Math.min(120, Number(e.target.value)),
                      ),
                      updatedAt: Date.now(),
                    },
                  }))
                }
              />
            </label>
          </div>
          <p className="phase-copy">
            建议先稳定完成，再逐渐增加训练量；没有记录时不会自动编造进度。
          </p>
        </Card>
      </div>
      <Card>
        <SectionHead
          eyebrow="THIS WEEK"
          title="每周安排"
          aside={<span className="step-pill">可随时调整</span>}
        />
        <div className="week-grid">
          {days.map((day, index) => (
            <div
              className={trainingDays.has(day) ? "day active" : "day"}
              key={day}
            >
              <span>{day}</span>
              <strong>
                {trainingDays.has(day)
                  ? index % 2 === 0
                    ? "全身力量"
                    : "力量 + 有氧"
                  : "恢复 / 步行"}
              </strong>
              <small>
                {trainingDays.has(day)
                  ? `${state.plan.sessionMinutes} 分钟`
                  : "按状态安排"}
              </small>
            </div>
          ))}
        </div>
      </Card>
      <Card className="science-card">
        <SectionHead eyebrow="WHY THIS ORDER" title="默认动作顺序依据" />
        <p>
          默认采用大肌群、多关节、技术要求较高的动作优先，然后是单关节动作与有氧收尾；这样通常能把更需要精力与稳定性的动作放在前面。你仍可完全拖动调整。
        </p>
        <div className="source-links">
          <a
            href="https://chapters.acsm.org/docs/default-source/files-for-resource-library/infographics/inclusive-fitness/acsm-nchpad-anaerobic-programming-for-clients-with-disabilities.pdf"
            target="_blank"
            rel="noreferrer"
          >
            ACSM 动作顺序资料 ↗
          </a>
          <a
            href="https://www.who.int/publications-detail-redirect/9789240015128"
            target="_blank"
            rel="noreferrer"
          >
            WHO 身体活动指南 ↗
          </a>
        </div>
        <small>
          指南提供一般原则，不替代针对个人疾病、伤痛或运动能力的专业评估。
        </small>
      </Card>
    </div>
  );
}

function Workout({
  state,
  update,
  now,
}: {
  state: AppState;
  update: (r: (s: AppState) => AppState, immediate?: boolean) => void;
  now: number;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [body, setBody] = useState("全部");
  const [equipment, setEquipment] = useState("全部");
  const [customOpen, setCustomOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState<Exercise | null>(null);
  const [custom, setCustom] = useState({
    zh: "",
    en: "",
    body: "上肢",
    equipment: "徒手",
    cue: "",
    caution: "",
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const allExercises = [...EXERCISES, ...state.customExercises];
  const filtered = allExercises.filter(
    (x) =>
      (body === "全部" || x.body === body) &&
      (equipment === "全部" || x.equipment === equipment) &&
      `${x.zh} ${x.en}`.toLowerCase().includes(search.toLowerCase()),
  );
  const restLeft = state.activeSession?.rest?.active
    ? Math.max(0, Math.ceil((state.activeSession.rest.endAt - now) / 1000))
    : 0;
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= state.trainingQueue.length) return;
    update((s) => {
      const list = [...s.trainingQueue];
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      return { ...s, trainingQueue: list, queueUpdatedAt: Date.now() };
    }, true);
  };
  const addExercise = (exercise: Exercise) =>
    update((s) => ({
      ...s,
      trainingQueue: [
        ...s.trainingQueue,
        {
          ...exercise,
          queueId: uid(),
          sets: exercise.kind === "有氧" ? 1 : 3,
          reps: exercise.kind === "有氧" ? 20 : 10,
        },
      ],
      queueUpdatedAt: Date.now(),
    }));
  const startSession = () => {
    if (!state.trainingQueue.length) return;
    const at = Date.now();
    update(
      (s) => ({
        ...s,
        activeSession: {
          id: uid(),
          startedAt: at,
          endedAt: null,
          rest: null,
          updatedAt: at,
          exercises: s.trainingQueue.map((item) => ({
            ...item,
            sessionSets: Array.from({ length: item.sets }, () => ({
              id: uid(),
              weightKg: 0,
              reps: item.reps,
              rir: 3,
              quality: "待记录" as const,
              completedAt: null,
            })),
          })),
        },
      }),
      true,
    );
  };
  const setChange = (
    exerciseId: string,
    setId: string,
    patch: Record<string, unknown>,
  ) =>
    update((s) =>
      !s.activeSession
        ? s
        : {
            ...s,
            activeSession: {
              ...s.activeSession,
              updatedAt: Date.now(),
              exercises: s.activeSession.exercises.map((ex) =>
                ex.queueId === exerciseId
                  ? {
                      ...ex,
                      sessionSets: ex.sessionSets.map((set) =>
                        set.id === setId ? { ...set, ...patch } : set,
                      ),
                    }
                  : ex,
              ),
            },
          },
    );
  const toggleComplete = (
    exerciseId: string,
    setId: string,
    completed: boolean,
  ) =>
    update(
      (s) =>
        !s.activeSession
          ? s
          : {
              ...s,
              activeSession: {
                ...s.activeSession,
                updatedAt: Date.now(),
                rest: completed
                  ? {
                      active: true,
                      endAt: Date.now() + 90_000,
                      durationSec: 90,
                    }
                  : s.activeSession.rest,
                exercises: s.activeSession.exercises.map((ex) =>
                  ex.queueId === exerciseId
                    ? {
                        ...ex,
                        sessionSets: ex.sessionSets.map((set) =>
                          set.id === setId
                            ? {
                                ...set,
                                completedAt: completed ? Date.now() : null,
                              }
                            : set,
                        ),
                      }
                    : ex,
                ),
              },
            },
      true,
    );
  const finishSession = () =>
    update((s) => {
      if (!s.activeSession) return s;
      const ended = Date.now();
      const sets = s.activeSession.exercises
        .flatMap((x) => x.sessionSets)
        .filter((x) => x.completedAt);
      const volume = sets.reduce((sum, x) => sum + x.weightKg * x.reps, 0);
      return {
        ...s,
        activeSession: null,
        workoutHistory: [
          ...s.workoutHistory,
          {
            id: s.activeSession.id,
            date: todayKey(),
            durationSec: elapsedSeconds(s.activeSession.startedAt, ended),
            totalVolumeKg: volume,
            exerciseCount: s.activeSession.exercises.length,
            updatedAt: ended,
          },
        ],
      };
    }, true);
  const saveCustom = () => {
    if (!custom.zh.trim() || !custom.en.trim()) return;
    const at = Date.now();
    const value: Exercise = {
      id: editingCustom?.id ?? `custom-${uid()}`,
      zh: custom.zh.trim(),
      en: custom.en.trim(),
      body: custom.body as Exercise["body"],
      equipment: custom.equipment as Exercise["equipment"],
      kind: custom.body === "有氧" ? "有氧" : "复合",
      priority: custom.body === "有氧" ? 70 : 25,
      cue: custom.cue.trim() || "请记录适合自己的动作要点。",
      caution: custom.caution.trim() || "出现疼痛或异常不适时停止。",
      custom: true,
      updatedAt: at,
    };
    update(
      (s) => ({
        ...s,
        customExercises: editingCustom
          ? s.customExercises.map((x) => (x.id === value.id ? value : x))
          : [...s.customExercises, value],
      }),
      true,
    );
    setCustomOpen(false);
    setEditingCustom(null);
    setCustom({
      zh: "",
      en: "",
      body: "上肢",
      equipment: "徒手",
      cue: "",
      caution: "",
    });
  };
  const beginEdit = (x: Exercise) => {
    setEditingCustom(x);
    setCustom({
      zh: x.zh,
      en: x.en,
      body: x.body,
      equipment: x.equipment,
      cue: x.cue,
      caution: x.caution,
    });
    setCustomOpen(true);
  };
  return (
    <div className="stack">
      <div className="hero workout-hero">
        <div>
          <span className="eyebrow">ACTIVE WORKOUT</span>
          <h2>
            {state.activeSession
              ? formatClock(elapsedSeconds(state.activeSession.startedAt, now))
              : "准备开始"}
          </h2>
          <p>
            {state.activeSession
              ? "计时由绝对开始时间计算，切后台或重新打开后仍会恢复真实经过时间。"
              : "添加真实动作，排序后再开始。"}
          </p>
        </div>
        {state.activeSession ? (
          <button className="danger-soft" onClick={finishSession}>
            结束并保存
          </button>
        ) : (
          <button
            className="primary"
            onClick={startSession}
            disabled={!state.trainingQueue.length}
          >
            开始训练
          </button>
        )}
      </div>
      {state.activeSession?.rest?.active && (
        <div className={`rest-banner ${restLeft === 0 ? "done" : ""}`}>
          <Bell size={19} />
          <div>
            <span>组间休息 / Rest</span>
            <strong>
              {restLeft === 0 ? "可以开始下一组" : formatClock(restLeft)}
            </strong>
          </div>
          <button
            onClick={() =>
              update(
                (s) =>
                  !s.activeSession
                    ? s
                    : {
                        ...s,
                        activeSession: {
                          ...s.activeSession,
                          rest: null,
                          updatedAt: Date.now(),
                        },
                      },
                true,
              )
            }
          >
            结束休息
          </button>
        </div>
      )}
      <div className="workout-toolbar">
        <button className="secondary" onClick={() => setLibraryOpen(true)}>
          <Plus size={17} /> 添加动作
        </button>
        <button
          className="ghost"
          onClick={() =>
            update(
              (s) => ({
                ...s,
                trainingQueue: [...s.trainingQueue].sort(
                  (a, b) => a.priority - b.priority,
                ),
                queueUpdatedAt: Date.now(),
              }),
              true,
            )
          }
        >
          <Sparkles size={17} /> 按科学建议排序
        </button>
      </div>
      {state.trainingQueue.length === 0 ? (
        <Card className="empty-state">
          <div className="empty-icon">
            <Dumbbell />
          </div>
          <h3>训练清单还是空的</h3>
          <p>
            从 50+ 个中英双语动作中选择，或创建自己的动作。这里不会预填假训练。
          </p>
          <button className="primary" onClick={() => setLibraryOpen(true)}>
            打开动作库
          </button>
        </Card>
      ) : (
        <div className="queue-list">
          {state.trainingQueue.map((item, index) => (
            <Card
              key={item.queueId}
              className={`queue-item ${dragging === item.queueId ? "dragging" : ""}`}
            >
              <div
                className="drag-handle"
                title="按住拖动"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  dragRef.current = { from: index, to: index };
                  setDragging(item.queueId);
                }}
                onPointerMove={(e) => {
                  if (!dragRef.current) return;
                  const target = document
                    .elementFromPoint(e.clientX, e.clientY)
                    ?.closest("[data-queue-index]") as HTMLElement | null;
                  if (target)
                    dragRef.current.to = Number(target.dataset.queueIndex);
                }}
                onPointerUp={() => {
                  const drag = dragRef.current;
                  dragRef.current = null;
                  setDragging(null);
                  if (drag) reorder(drag.from, drag.to);
                }}
              >
                <GripVertical size={20} />
              </div>
              <div className="queue-main" data-queue-index={index}>
                <span className="exercise-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>
                    {item.zh}
                    <small>{item.en}</small>
                  </h3>
                  <p>
                    {item.equipment} · {item.kind} · {item.sets} 组 ×{" "}
                    {item.reps}
                  </p>
                </div>
              </div>
              <div className="queue-actions">
                <button
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={() => reorder(index, index - 1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  aria-label="下移"
                  disabled={index === state.trainingQueue.length - 1}
                  onClick={() => reorder(index, index + 1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  aria-label="移除"
                  onClick={() =>
                    update(
                      (s) => ({
                        ...s,
                        trainingQueue: s.trainingQueue.filter(
                          (x) => x.queueId !== item.queueId,
                        ),
                        queueUpdatedAt: Date.now(),
                      }),
                      true,
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {state.activeSession && (
                <div className="set-table">
                  <div className="set-head">
                    <span>组</span>
                    <span>重量 kg</span>
                    <span>次数</span>
                    <span>RIR</span>
                    <span>质量</span>
                    <span>完成</span>
                  </div>
                  {state.activeSession.exercises
                    .find((x) => x.queueId === item.queueId)
                    ?.sessionSets.map((set, setIndex) => (
                      <div className="set-row" key={set.id}>
                        <strong>{setIndex + 1}</strong>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={set.weightKg}
                          onChange={(e) =>
                            setChange(item.queueId, set.id, {
                              weightKg: Number(e.target.value),
                            })
                          }
                        />
                        <input
                          type="number"
                          inputMode="numeric"
                          value={set.reps}
                          onChange={(e) =>
                            setChange(item.queueId, set.id, {
                              reps: Number(e.target.value),
                            })
                          }
                        />
                        <select
                          value={set.rir}
                          onChange={(e) =>
                            setChange(item.queueId, set.id, {
                              rir: Number(e.target.value),
                            })
                          }
                        >
                          {[0, 1, 2, 3, 4, 5].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                        <select
                          value={set.quality}
                          onChange={(e) =>
                            setChange(item.queueId, set.id, {
                              quality: e.target.value,
                            })
                          }
                        >
                          <option>待记录</option>
                          <option>稳定</option>
                          <option>勉强</option>
                          <option>需调整</option>
                        </select>
                        <button
                          className={
                            set.completedAt ? "complete checked" : "complete"
                          }
                          onClick={() =>
                            toggleComplete(
                              item.queueId,
                              set.id,
                              !set.completedAt,
                            )
                          }
                        >
                          {set.completedAt ? <Check size={17} /> : "○"}
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <Card className="timer-note">
        <Bell size={18} />
        <div>
          <strong>后台计时边界</strong>
          <p>
            页面不依赖每秒写入：训练使用开始时间戳，休息使用结束时间戳，所以切后台、锁屏或重新打开后能恢复真实时间。Web
            浏览器仍可能暂停代码，通知也取决于系统授权，不能保证像原生 App
            一样常驻。
          </p>
        </div>
      </Card>
      {libraryOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="sheet library-sheet">
            <div className="sheet-head">
              <div>
                <span className="eyebrow">EXERCISE LIBRARY</span>
                <h2>选择动作</h2>
              </div>
              <button onClick={() => setLibraryOpen(false)}>
                <X />
              </button>
            </div>
            <div className="searchbox">
              <Search size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索中文、英文动作名"
              />
            </div>
            <div className="filter-block">
              <span>部位</span>
              <div className="chip-row">
                {BODY_FILTERS.map((x) => (
                  <button
                    className={body === x ? "chip selected" : "chip"}
                    key={x}
                    onClick={() => setBody(x)}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-block">
              <span>器械</span>
              <div className="chip-row">
                {EQUIPMENT_FILTERS.map((x) => (
                  <button
                    className={equipment === x ? "chip selected" : "chip"}
                    key={x}
                    onClick={() => setEquipment(x)}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
            <div className="library-meta">
              <span>{filtered.length} 个动作 · 中英双语</span>
              <button
                onClick={() => {
                  setEditingCustom(null);
                  setCustomOpen(true);
                }}
              >
                <Plus size={16} /> 创建动作
              </button>
            </div>
            <div className="exercise-grid">
              {filtered.map((x) => (
                <article key={x.id} className="exercise-card">
                  <div className="exercise-badge">{x.body.slice(0, 1)}</div>
                  <div>
                    <h3>
                      {x.zh}
                      <small>{x.en}</small>
                    </h3>
                    <p>
                      {x.equipment} · {x.kind}
                    </p>
                    <details>
                      <summary>动作要点</summary>
                      <p>{x.cue}</p>
                      <p className="caution">{x.caution}</p>
                      <small>
                        当前为编辑整理的文字示范；未盲目抓取网络视频。
                      </small>
                    </details>
                  </div>
                  <div className="exercise-actions">
                    {x.custom && (
                      <button
                        className="icon-button"
                        onClick={() => beginEdit(x)}
                      >
                        编辑
                      </button>
                    )}
                    <button
                      className="add-circle"
                      onClick={() => addExercise(x)}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
      {customOpen && (
        <div className="modal-backdrop top" role="dialog" aria-modal="true">
          <div className="sheet small-sheet">
            <div className="sheet-head">
              <h2>{editingCustom ? "编辑自定义动作" : "创建自定义动作"}</h2>
              <button onClick={() => setCustomOpen(false)}>
                <X />
              </button>
            </div>
            <div className="form-grid">
              <label>
                中文名称
                <input
                  value={custom.zh}
                  onChange={(e) => setCustom({ ...custom, zh: e.target.value })}
                />
              </label>
              <label>
                English name
                <input
                  value={custom.en}
                  onChange={(e) => setCustom({ ...custom, en: e.target.value })}
                />
              </label>
              <label>
                部位
                <select
                  value={custom.body}
                  onChange={(e) =>
                    setCustom({ ...custom, body: e.target.value })
                  }
                >
                  {BODY_FILTERS.slice(1).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                器械
                <select
                  value={custom.equipment}
                  onChange={(e) =>
                    setCustom({ ...custom, equipment: e.target.value })
                  }
                >
                  {EQUIPMENT_FILTERS.slice(1).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              动作要点
              <textarea
                value={custom.cue}
                onChange={(e) => setCustom({ ...custom, cue: e.target.value })}
              />
            </label>
            <label>
              安全提示
              <textarea
                value={custom.caution}
                onChange={(e) =>
                  setCustom({ ...custom, caution: e.target.value })
                }
              />
            </label>
            <button className="primary wide" onClick={saveCustom}>
              私有保存到我的动作库
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Lab({ state }: { state: AppState }) {
  const [period, setPeriod] = useState(30);
  const cutoff = Date.now() - period * 86_400_000;
  const weightData = state.weights
    .filter((x) => new Date(`${x.date}T12:00:00`).getTime() >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => ({ date: x.date.slice(5), 体重: x.value }));
  const workoutData = state.workoutHistory
    .filter((x) => new Date(`${x.date}T12:00:00`).getTime() >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => ({
      date: x.date.slice(5),
      运动分钟: Math.round(x.durationSec / 60),
    }));
  const totalMinutes = state.workoutHistory.reduce(
    (sum, x) => sum + x.durationSec / 60,
    0,
  );
  const totalVolume = state.workoutHistory.reduce(
    (sum, x) => sum + x.totalVolumeKg,
    0,
  );
  const latest = [...state.weights].sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0];
  const first = [...state.weights].sort((a, b) =>
    a.date.localeCompare(b.date),
  )[0];
  return (
    <div className="stack">
      <div className="hero lab-hero">
        <div>
          <span className="eyebrow">PROGRESS LAB</span>
          <h2>努力应该被看见，不被编造</h2>
          <p>图表只使用你的真实记录；没有数据时就保持空白。</p>
        </div>
        <div className="period-switch">
          {[7, 30, 90].map((x) => (
            <button
              className={period === x ? "active" : ""}
              key={x}
              onClick={() => setPeriod(x)}
            >
              {x}天
            </button>
          ))}
        </div>
      </div>
      <div className="stat-grid">
        <Card>
          <span>当前体重</span>
          <strong>{latest ? `${latest.value} kg` : "—"}</strong>
          <small>{latest ? latest.date : "尚无记录"}</small>
        </Card>
        <Card>
          <span>累计训练</span>
          <strong>{Math.round(totalMinutes)} min</strong>
          <small>{state.workoutHistory.length} 次已完成</small>
        </Card>
        <Card>
          <span>累计训练容量</span>
          <strong>{Math.round(totalVolume)} kg</strong>
          <small>仅按已完成组估算</small>
        </Card>
        <Card>
          <span>体重变化</span>
          <strong>
            {latest && first
              ? `${latest.value - first.value > 0 ? "+" : ""}${(latest.value - first.value).toFixed(1)} kg`
              : "—"}
          </strong>
          <small>首条到最新记录</small>
        </Card>
      </div>
      <div className="chart-grid">
        <Card>
          <SectionHead eyebrow={`${period} DAYS`} title="体重趋势" />
          {weightData.length < 2 ? (
            <EmptyChart text="至少记录两天体重后显示趋势" />
          ) : (
            <Chart data={weightData} dataKey="体重" color="#76a98a" />
          )}
        </Card>
        <Card>
          <SectionHead eyebrow={`${period} DAYS`} title="运动量" />
          {workoutData.length < 1 ? (
            <EmptyChart text="完成一次训练后显示运动量" />
          ) : (
            <Chart data={workoutData} dataKey="运动分钟" color="#ef9d6a" />
          )}
        </Card>
      </div>
      <Card className="fun-card">
        <SectionHead eyebrow="FUN, NOT COMPENSATION" title="趣味累计换算" />
        <p>
          {totalVolume > 0
            ? `你累计移动了约 ${Math.round(totalVolume)} kg 的训练负荷。`
            : "完成训练后，这里会把训练容量换成易理解的趣味量级。"}
        </p>
        <small>
          所有换算都是粗略比喻，不代表真实能量消耗，也不应用来“抵消”食物。
        </small>
      </Card>
    </div>
  );
}

function Chart({
  data,
  dataKey,
  color,
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  color: string;
}) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="#ece8df" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#a6a094" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="#a6a094"
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{ borderRadius: 16, border: "1px solid #e8e1d5" }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={3}
            dot={{ r: 4, fill: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function EmptyChart({ text }: { text: string }) {
  return (
    <div className="empty-chart">
      <BarChart3 size={28} />
      <span>{text}</span>
    </div>
  );
}

function Me({
  state,
  update,
  user,
  signOutUrl,
  sync,
  version,
  cacheKey,
  onReset,
}: {
  state: AppState;
  update: (r: (s: AppState) => AppState, immediate?: boolean) => void;
  user: User;
  signOutUrl: string;
  sync: SyncStatus;
  version: number;
  cacheKey: string;
  onReset: () => void;
}) {
  const profile = state.profile!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const requestNotifications = async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    update(
      (s) => ({ ...s, notificationsEnabled: permission === "granted" }),
      true,
    );
  };
  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mellow-fit-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const reset = async () => {
    if (
      !window.confirm("确定删除当前账号的全部云端健身数据吗？此操作无法撤销。")
    )
      return;
    const response = await fetch("/api/state", { method: "DELETE" });
    if (response.ok) {
      localStorage.removeItem(cacheKey);
      onReset();
      window.location.reload();
    }
  };
  return (
    <div className="stack">
      <div className="profile-hero">
        <div className="profile-avatar">{profile.nickname.slice(0, 1)}</div>
        <div>
          <span className="eyebrow">MY PROFILE</span>
          <h2>{profile.nickname}</h2>
          <p>{user.email}</p>
        </div>
        <button
          className="secondary"
          onClick={() => {
            setDraft(profile);
            setEditing(!editing);
          }}
        >
          {editing ? "取消" : "编辑档案"}
        </button>
      </div>
      <Card>
        <SectionHead
          eyebrow="ACCOUNT & SYNC"
          title="账号与同步"
          aside={<SyncPill status={sync} version={version} />}
        />
        <div className="settings-list">
          <div>
            <Cloud size={18} />
            <span>
              托管云端数据库<small>同一 ChatGPT 账号跨设备同步</small>
            </span>
            <strong>v{version}</strong>
          </div>
          <div>
            <UserRound size={18} />
            <span>
              账户隔离<small>每次读写都按稳定用户 ID 过滤</small>
            </span>
            <strong>已保护</strong>
          </div>
          <div>
            <Bell size={18} />
            <span>
              休息通知<small>受浏览器与系统后台策略限制</small>
            </span>
            <button onClick={requestNotifications}>
              {state.notificationsEnabled ? "已授权" : "去授权"}
            </button>
          </div>
        </div>
      </Card>
      {editing && (
        <Card>
          <SectionHead eyebrow="EDIT PROFILE" title="编辑个人档案" />
          <div className="form-grid">
            <label>
              昵称
              <input
                value={draft.nickname}
                onChange={(e) =>
                  setDraft({ ...draft, nickname: e.target.value })
                }
              />
            </label>
            <label>
              年龄
              <input
                type="number"
                value={draft.age}
                onChange={(e) =>
                  setDraft({ ...draft, age: Number(e.target.value) })
                }
              />
            </label>
            <label>
              身高 cm
              <input
                type="number"
                value={draft.heightCm}
                onChange={(e) =>
                  setDraft({ ...draft, heightCm: Number(e.target.value) })
                }
              />
            </label>
            <label>
              建档体重 kg
              <input
                type="number"
                value={draft.startingWeightKg}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    startingWeightKg: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label>
            疾病与健康情况
            <textarea
              value={draft.healthNotes}
              onChange={(e) =>
                setDraft({ ...draft, healthNotes: e.target.value })
              }
            />
          </label>
          <label>
            运动禁忌与既往伤痛
            <textarea
              value={draft.contraindications}
              onChange={(e) =>
                setDraft({ ...draft, contraindications: e.target.value })
              }
            />
          </label>
          <button
            className="primary"
            onClick={() => {
              update(
                (s) => ({ ...s, profile: { ...draft, updatedAt: Date.now() } }),
                true,
              );
              setEditing(false);
            }}
          >
            保存档案
          </button>
        </Card>
      )}
      <Card>
        <SectionHead
          eyebrow="MY EXERCISES"
          title="我的自定义动作"
          aside={<Library size={19} />}
        />
        {state.customExercises.length === 0 ? (
          <div className="empty-row">
            还没有自定义动作。请到「训练 → 添加动作 → 创建动作」添加。
          </div>
        ) : (
          <div className="custom-list">
            {state.customExercises.map((x) => (
              <div key={x.id}>
                <strong>
                  {x.zh}
                  <small>{x.en}</small>
                </strong>
                <span>
                  {x.body} · {x.equipment}
                </span>
                <button
                  onClick={() =>
                    update(
                      (s) => ({
                        ...s,
                        customExercises: s.customExercises.filter(
                          (y) => y.id !== x.id,
                        ),
                      }),
                      true,
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <SectionHead eyebrow="DATA CONTROL" title="数据与隐私" />
        <div className="button-row">
          <button className="secondary" onClick={exportData}>
            导出我的 JSON 数据
          </button>
          <a className="secondary button-link" href={signOutUrl} target="_top">
            <LogOut size={17} /> 退出账号
          </a>
          <button className="danger-soft" onClick={reset}>
            <Trash2 size={17} /> 删除全部云端数据
          </button>
        </div>
        <p className="privacy-note">
          应用不保存账户密码；邮箱仅用于显示与当前托管账户关联。健康记录不会与其他账号共享。
        </p>
      </Card>
    </div>
  );
}
