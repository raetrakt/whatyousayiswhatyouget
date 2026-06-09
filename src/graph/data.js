import graphData from './graph.json';

const IMAGE_BASE = '/assets/images/works/';

// Loads the static graph data (bundled at build time) into `state`, expanding
// the compact JSON shape back into the row-like structures the rest of the
// app expects. Async only to keep the previous call signature.
export async function loadData(state) {
  try {
    state.concepts = (graphData.concepts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
    }));

    state.works = (graphData.works ?? []).map((w) => ({
      id: w.id,
      title: w.title ?? '',
      media_path: w.image ? `${IMAGE_BASE}${w.image}` : '',
      author: w.author ?? '',
      year: w.year ?? null,
      source_url: w.source_url ?? '',
    }));

    state.relations = (graphData.conceptRelations ?? []).map(([from_concept, to_concept]) => ({
      from_concept,
      to_concept,
    }));

    state.workConcepts = (graphData.workConceptRelations ?? []).map(([work, concept]) => ({
      work,
      concept,
    }));

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
