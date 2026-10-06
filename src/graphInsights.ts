// 그래프 모양에서 "이 저장 지점에서 무슨 일이 있었는지"를 쉬운 말로 뽑아낸다.
// 데모 그래프와 실제 저장소 그래프가 함께 쓴다.

export interface InsightInput {
  hash: string;
  parents: string[];
  subject: string;
  lane: number;
}

export interface Insight {
  /** 이 지점에서 일어난 일 (합치기, 갈라짐, 첫 저장 등) */
  events: string[];
  /** 몇 번째 저장 지점인지 */
  position: string;
}

/**
 * @param rows   최신이 앞인 저장 지점 목록 (레인 정보 포함)
 * @param names  저장 지점 → 그 지점을 가리키는 갈래 이름들
 * @param head   지금 작업 중인 저장 지점
 * @param mainName 기준 갈래 이름 (보통 main)
 */
export function buildInsights(
  rows: InsightInput[],
  names: Map<string, string[]>,
  head: string | null,
  mainName: string,
): Map<string, Insight> {
  const byHash = new Map(rows.map((r) => [r.hash, r]));
  const children = new Map<string, string[]>();
  for (const r of rows) for (const p of r.parents) if (byHash.has(p)) (children.get(p) ?? children.set(p, []).get(p)!).push(r.hash);
  // 목록이 잘려서(최근 N개만) 부모가 빠져 있는지
  const truncated = rows.some((r) => r.parents.some((p) => !byHash.has(p)));

  // 기준 갈래의 줄기: head(없으면 맨 위)에서 첫 부모만 따라 내려간 길
  const mainline: string[] = [];
  for (let h: string | undefined = head && byHash.has(head) ? head : rows[0]?.hash; h && byHash.has(h); h = byHash.get(h)!.parents[0]) {
    mainline.push(h);
  }
  const mainIndex = new Map(mainline.map((h, i) => [h, i]));

  // 줄기 밖의 저장 지점은 "갈라진 지점 + 레인"으로 묶어 하나의 갈래로 본다
  const groupOf = new Map<string, { key: string; step: number; fork: string | null }>();
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    if (mainIndex.has(r.hash)) continue;
    let step = 0;
    let cur: string | undefined = r.hash;
    while (cur && byHash.has(cur) && !mainIndex.has(cur)) {
      step++;
      cur = byHash.get(cur)!.parents[0];
    }
    const fork = cur && mainIndex.has(cur) ? cur : null;
    const key = `${fork}:${r.lane}`;
    groupOf.set(r.hash, { key, step, fork });
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r.hash);
  }
  const groupName = (key: string) => {
    for (const h of groups.get(key) ?? []) {
      const n = names.get(h)?.[0];
      if (n) return n;
    }
    return null;
  };

  /** from 에서 부모를 따라 닿을 수 있는 저장 지점들 */
  const reach = (from: string) => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const h = stack.pop()!;
      if (seen.has(h) || !byHash.has(h)) continue;
      seen.add(h);
      stack.push(...byHash.get(h)!.parents);
    }
    return seen;
  };

  const out = new Map<string, Insight>();
  for (const r of rows) {
    const events: string[] = [];

    if (r.hash === head) events.push("지금 작업 중인 위치예요");
    if (r.parents.length === 0) events.push("프로젝트의 첫 저장 지점이에요");

    if (r.parents.length > 1) {
      // 합치기: 두 번째 부모 쪽에서만 닿는 저장 지점 = 이번에 합쳐 들어온 것
      const base = reach(r.parents[0]);
      const merged = [...reach(r.parents[1])].filter((h) => !base.has(h)).length;
      const g = groupOf.get(r.parents[1]);
      const fromSubject = /Merge branch '([^']+)'/.exec(r.subject)?.[1];
      const name = (g && groupName(g.key)) ?? fromSubject ?? "다른 갈래";
      events.push(`‘${name}’ 갈래의 저장 지점 ${merged}개를 합쳤어요`);
    }

    const kids = (children.get(r.hash) ?? []).filter((c) => byHash.get(c)!.parents[0] === r.hash);
    const branchesOut = kids
      .filter((c) => !mainIndex.has(c))
      .map((c) => {
        const g = groupOf.get(c);
        return (g && groupName(g.key)) ?? "새 갈래";
      });
    if (branchesOut.length) events.push(`여기서 ${[...new Set(branchesOut)].map((n) => `‘${n}’`).join(", ")} 갈래가 갈라져 나갔어요`);

    let position: string;
    const mi = mainIndex.get(r.hash);
    if (mi != null) {
      const total = mainline.length;
      position = `${mainName}의 ${total - mi}번째 저장 지점 · 지금까지 ${total}개`;
    } else {
      const g = groupOf.get(r.hash)!;
      const name = groupName(g.key) ?? "이름 없는 갈래";
      const size = groups.get(g.key)!.length;
      position = `‘${name}’ 갈래의 ${g.step}번째 저장 지점 · 이 갈래 ${size}개`;
    }
    if (truncated) position += " (불러온 기록 기준)";

    out.set(r.hash, { events, position });
  }
  return out;
}
