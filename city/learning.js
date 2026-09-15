// Tabular Q-learning in the stimulus adapter, not biological synaptic plasticity.
export const actions = [
  { speed: 1, bias: 0, name: "标准刺激" },
  { speed: 0.55, bias: 0, name: "低速刺激" },
  { speed: 0.8, bias: -0.35, name: "左偏刺激" },
  { speed: 0.8, bias: 0.35, name: "右偏刺激" },
  { speed: 0, bias: 0, name: "抑制前进" },
];
export class Learner {
  constructor(saved = {}) {
    this.q = saved.q || {};
    this.updates = saved.updates || 0;
    this.episodes = saved.episodes || [];
    this.visits = saved.visits || {};
  }
  state({ hazard, turn, speed }) {
    return `${hazard ? "danger" : "clear"}:${turn < -0.15 ? "left" : turn > 0.15 ? "right" : "straight"}:${speed < 0.3 ? "slow" : "fast"}`;
  }
  values(state) {
    return this.q[state] ?? (this.q[state] = actions.map(() => 0));
  }
  choose(state, train = true, random = Math.random) {
    const q = this.values(state);
    const epsilon = train ? Math.max(0.08, 0.3 / (1 + this.updates / 150)) : 0;
    const action =
      random() < epsilon
        ? Math.floor(random() * actions.length)
        : q.indexOf(Math.max(...q));
    return { action, epsilon, ...actions[action] };
  }
  update(state, action, reward, nextState, terminal = false) {
    const q = this.values(state);
    q[action] +=
      0.18 *
      (reward +
        (terminal ? 0 : 0.85 * Math.max(...this.values(nextState))) -
        q[action]);
    this.visits[state] = (this.visits[state] || 0) + 1;
    this.updates++;
  }
  episode(reward, success) {
    this.episodes.push({
      reward: Number(reward.toFixed(2)),
      success,
      time: new Date().toISOString(),
    });
    this.episodes = this.episodes.slice(-200);
  }
  snapshot() {
    return {
      q: this.q,
      updates: this.updates,
      episodes: this.episodes,
      visits: this.visits,
    };
  }
}
export function rewardFor({
  progress,
  lateral,
  collision = false,
  blocked = false,
  departure = false,
  arrived = false,
  redViolation = false,
}) {
  return (
    Math.max(-2, Math.min(2, progress / 20)) -
    Math.min(2, lateral / 12) -
    (collision ? 12 : 0) -
    (blocked ? 8 : 0) -
    (departure ? 8 : 0) -
    (redViolation ? 5 : 0) +
    (arrived ? 15 : 0) -
    0.05
  );
}
