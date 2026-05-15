export async function loadData(supabase, state) {
  const { data: c, error: conceptError } = await supabase.from('concepts').select('id, name, type');
  const { data: r, error: relationError } = await supabase
    .from('concept_relations')
    .select('from_concept, to_concept');
  const { data: w, error: workError } = await supabase
    .from('works')
    .select('id, media_path, title, author, year, source_url');
  const { data: wc, error: workConceptError } = await supabase
    .from('work_concept_relations')
    .select('work, concept');

  if (conceptError || relationError || workError || workConceptError) {
    console.error(conceptError || relationError || workError || workConceptError);
    return false;
  }

  state.concepts = c ?? [];
  state.relations = r ?? [];
  state.works = w ?? [];
  state.workConcepts = wc ?? [];
  return true;
}
