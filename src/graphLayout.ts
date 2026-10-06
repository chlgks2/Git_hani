// 저장 기록 그래프의 레인(세로 줄) 배치.
// 위(최신)에서 아래로 내려가며 "각 레인이 다음에 만날 저장 지점"을 기억해 두고,
// 저장 지점이 나타나면 그 레인에 놓은 뒤 부모들에게 레인을 넘겨준다.

export interface LayoutInput {
  hash: string;
  parents: string[];
}

export interface LayoutEdge {
  fromRow: number;
  /** 부모가 목록 밖(더 오래된 기록)이면 null — 아래 끝까지 이어 그린다 */
  toRow: number | null;
  fromLane: number;
  toLane: number;
  /** 두 저장 지점 사이를 지나가는 레인 */
  viaLane: number;
}

export interface Layout {
  lanes: number[]; // 행마다 노드가 놓인 레인
  edges: LayoutEdge[];
  laneCount: number;
}

export function layoutGraph(rows: LayoutInput[]): Layout {
  const active: (string | null)[] = []; // 레인 i 가 다음에 기다리는 저장 지점
  const laneOf: number[] = [];
  const rowOf = new Map(rows.map((r, i) => [r.hash, i]));
  const pending: { fromRow: number; parent: string; via: number }[] = [];
  let laneCount = 0;

  const freeLane = () => {
    const i = active.indexOf(null);
    if (i >= 0) return i;
    active.push(null);
    return active.length - 1;
  };

  rows.forEach((row, i) => {
    // 이 저장 지점을 기다리던 레인이 있으면 그 자리에, 없으면(갈래 끝) 빈 레인에 놓는다
    let lane = active.indexOf(row.hash);
    if (lane < 0) lane = freeLane();
    // 같은 저장 지점을 기다리던 다른 레인들은 여기서 합쳐지므로 비운다
    for (let j = 0; j < active.length; j++) if (j !== lane && active[j] === row.hash) active[j] = null;
    laneOf[i] = lane;

    if (row.parents.length === 0) active[lane] = null;
    row.parents.forEach((p, k) => {
      if (k === 0) {
        // 첫 부모는 같은 레인으로 이어 내려간다
        active[lane] = p;
        pending.push({ fromRow: i, parent: p, via: lane });
      } else {
        // 합친(merge) 부모: 이미 그 부모를 기다리는 레인이 있으면 그쪽으로, 없으면 새 레인
        let via = active.indexOf(p);
        if (via < 0) {
          via = freeLane();
          active[via] = p;
        }
        pending.push({ fromRow: i, parent: p, via });
      }
    });

    while (active.length && active[active.length - 1] === null) active.pop();
    laneCount = Math.max(laneCount, active.length, lane + 1);
  });

  const edges = pending.map(({ fromRow, parent, via }) => {
    const toRow = rowOf.get(parent) ?? null;
    return {
      fromRow,
      toRow,
      fromLane: laneOf[fromRow],
      toLane: toRow == null ? via : laneOf[toRow],
      viaLane: via,
    };
  });

  return { lanes: laneOf, edges, laneCount: Math.max(laneCount, 1) };
}
