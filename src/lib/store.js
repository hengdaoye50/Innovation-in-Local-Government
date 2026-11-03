/** 轻量全局状态 */

const listeners = new Set();

const state = {
  user: null,
  authChecked: false,
  cases: [],
  casesLoaded: false,
  provinces: [],
  stats: { total: 0, provinces: 0, contributors: 0 },
  domains: [],
  posts: [],
  slides: [],
};

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function ensureUser(loader) {
  if (state.authChecked) return state.user;
  try {
    const user = await loader();
    setState({ user, authChecked: true });
  } catch {
    setState({ user: null, authChecked: true });
  }
  return state.user;
}

/** 领域标签的展示顺序与配色分组 */
/** 角色中文名：后台与个人页共用一套叫法 */
export const ROLE_LABEL = {
  student: "学生",
  teacher: "教师",
  observer: "观察员",
  admin: "管理员",
};

export const DOMAIN_ORDER = [
  "数字治理",
  "营商环境",
  "基层治理",
  "公共服务",
  "生态治理",
  "乡村振兴",
  "社会组织",
  "政务公开",
  "应急管理",
  "城市更新",
];

export function domainLabel(value) {
  return value || "其他";
}
