// helper used both for D3 join key + selection identity
export function linkKey(d) {
  const s = d.source?.id ?? d.source;
  const t = d.target?.id ?? d.target;
  return `${s}->${t}`;
}

export function parseNodeId(nodeId) {
  const [kind, ...rest] = String(nodeId).split('-');
  return { kind, raw: rest.join('-') };
}

export function getNodeId(ref) {
  return typeof ref === 'object' && ref !== null ? ref.id : ref;
}

export function makeSnapshot(state) {
  return JSON.stringify({
    concepts: (state.concepts ?? []).map((c) => [c.id, c.name, c.type]).sort(),
    relations: (state.relations ?? []).map((r) => [r.from_concept, r.to_concept]).sort(),
    works: (state.works ?? []).map((w) => [w.id, w.title ?? '', w.media_path ?? '']).sort(),
    workConcepts: (state.workConcepts ?? []).map((wc) => [wc.work, wc.concept]).sort(),
  });
}

export function hasConceptRelation(state, from_concept, to_concept) {
  return state.relations.some(
    (r) =>
      String(r.from_concept) === String(from_concept) &&
      String(r.to_concept) === String(to_concept),
  );
}

export function hasWorkConceptRelation(state, work, concept) {
  return state.workConcepts.some(
    (r) => String(r.work) === String(work) && String(r.concept) === String(concept),
  );
}
