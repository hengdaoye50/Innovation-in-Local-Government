/** 课程与学期：材料提交、教师批阅与后台共用一套口径 */

export const COURSES = ["地方政府创新", "公共政策分析"];

export const TERMS = ["2026 秋", "2026 春", "2025 秋", "2025 春", "2024 秋", "2024 春"];

/** 材料类型：值写进 D1，标签只在前端用 */
export const WORK_KINDS = [
  { value: "case-report", label: "案例分析报告", hint: "针对一个地方案例的分析报告" },
  { value: "slides", label: "课堂展示课件", hint: "汇报用的课件，建议另存一份 PDF" },
  { value: "reading-report", label: "读书报告", hint: "一本或一章书的读后报告" },
  { value: "lit-review", label: "文献评析", hint: "围绕一个问题的文献梳理与评析" },
  { value: "other", label: "其他材料", hint: "不属于以上几类的课程材料" },
];
