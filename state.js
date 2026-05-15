export const state = {
  concepts: [],
  relations: [],
  works: [],
  workConcepts: [],
  nodes: [],
  links: [],
};

export const editorState = {
  enabled: false,
  selectedNode: null,
  selectedLinkKey: null,
  addedLinkKeys: new Set(),
  removedLinkKeys: new Set(),
};
