// Design Lab: the 10 UI styles from the reference sheet, wired as swappable skins.
//
// Skin CSS lives in app/skins/*.css as plain global stylesheets, NOT in
// page.module.css. Global CSS cannot see hashed CSS-module class names, so the
// page exposes stable `data-ui` hooks and every skin rule is written as
// `[data-skin-scope="<id>"] [data-ui="<hook>"]`. That keeps page.module.css
// untouched and sidesteps the CSS-modules pure-selector rule entirely.

export type SkinId =
  | "classic"
  | "mix"
  | "skeuo"
  | "neo"
  | "glass"
  | "clay"
  | "minimal"
  | "maximal"
  | "brutal"
  | "liquid"
  | "bento"
  | "spatial";

export type SkinZone =
  | "header"
  | "hero"
  | "search"
  | "dest"
  | "resultIntro"
  | "resultCore"
  | "ledger"
  | "handoff"
  | "alt"
  | "coverage"
  | "how"
  | "cta"
  | "footer";

export type SkinDef = {
  id: SkinId;
  no: string;
  name: string;
  blurb: string;
};

export const SKINS: SkinDef[] = [
  { id: "mix", no: "00", name: "全部盛り", blurb: "10スタイルを区画ごとに全部載せた状態" },
  { id: "classic", no: "--", name: "Classic", blurb: "着せ替える前のまま。見比べる基準" },
  { id: "skeuo", no: "01", name: "Skeuomorphism", blurb: "紙や革の質感で、本物のモノに寄せる" },
  { id: "neo", no: "02", name: "Neomorphism", blurb: "背景と同じ色のまま、影だけで凹凸を出す" },
  { id: "glass", no: "03", name: "Glassmorphism", blurb: "すりガラス越しに背景が透ける" },
  { id: "clay", no: "04", name: "Claymorphism", blurb: "粘土みたいにぷっくり丸い" },
  { id: "minimal", no: "05", name: "Minimalism", blurb: "線と余白だけ残して、飾りを外す" },
  { id: "maximal", no: "06", name: "Maximalism", blurb: "色も柄も、足せるだけ足す" },
  { id: "brutal", no: "07", name: "Brutalism", blurb: "黒枠と直角。ずらした影をそのまま見せる" },
  { id: "liquid", no: "08", name: "Liquid Glass", blurb: "反射まで乗った、濡れたガラス" },
  { id: "bento", no: "09", name: "Bento Grid", blurb: "弁当箱のように、大小のマスで並べる" },
  { id: "spatial", no: "10", name: "Spatial UI", blurb: "暗い空間にパネルが浮いている" },
];

export const SKIN_BY_ID: Record<SkinId, SkinDef> = SKINS.reduce(
  (map, skin) => {
    map[skin.id] = skin;
    return map;
  },
  {} as Record<SkinId, SkinDef>,
);

// 全部盛り: one style per zone, each placed where it has something to say.
export const MIX_MAP: Record<SkinZone, SkinId | undefined> = {
  header: "glass",
  hero: "spatial",
  search: "neo",
  dest: "clay",
  resultIntro: "liquid",
  resultCore: "liquid",
  ledger: "bento",
  handoff: "skeuo",
  alt: "brutal",
  coverage: "maximal",
  how: "minimal",
  cta: undefined,
  footer: undefined,
};

export const SKIN_STORAGE_KEY = "maison-passage:skin";
export const DEFAULT_SKIN: SkinId = "mix";

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === "string" && SKINS.some((skin) => skin.id === value);
}

export function skinTag(id: SkinId | undefined): string | undefined {
  if (!id) return undefined;
  const def = SKIN_BY_ID[id];
  return def ? `${def.no} ${def.name}` : undefined;
}
